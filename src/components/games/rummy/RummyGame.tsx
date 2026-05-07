import { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../../firebase';
import { ArrowLeft, Play } from 'lucide-react';
import { initializeGame } from './RummyEngine';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

interface RummyGameProps {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

import { validateMeld, canAttachToMeld, calculatePenaltyPoints } from './RummyEngine';

export default function RummyGame({ game, userMap, onBack }: RummyGameProps) {
  const [localHand, setLocalHand] = useState<any[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [stagedMelds, setStagedMelds] = useState<{cards: any[], type: 'set'|'run', points: number}[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOwner = game.createdBy === auth.currentUser?.uid;
  const isJoined = game.state.playerIds.includes(auth.currentUser?.uid);

  useEffect(() => {
    if (auth.currentUser && game.state.players[auth.currentUser.uid]?.hand) {
      setLocalHand(game.state.players[auth.currentUser.uid].hand);
    }
  }, [game]);

  const handleJoin = async () => {
    if (!auth.currentUser || isJoined) return;
    if (game.state.playerIds.length >= 4) return; // Max 4 players

    const newPlayerIds = [...game.state.playerIds, auth.currentUser.uid];
    const newPlayers = {
      ...game.state.players,
      [auth.currentUser.uid]: { uid: auth.currentUser.uid, hand: [], hasMelded: false, score: 0 }
    };

    await updateDoc(doc(db, 'games', game.id), {
      'state.playerIds': newPlayerIds,
      'state.players': newPlayers
    });
  };

  const handleStartGame = async () => {
    if (!isOwner || game.state.playerIds.length < 2) return;

    // Initialize game with shuffled deck and dealt hands
    const newGameState = initializeGame(game.state.playerIds);
    
    await updateDoc(doc(db, 'games', game.id), {
      state: newGameState,
      status: 'playing'
    });
  };

  const onDragEnd = async (result: any) => {
    if (!result.destination || !auth.currentUser) return;

    // Local re-ordering of hand
    if (result.source.droppableId === 'my-hand' && result.destination.droppableId === 'my-hand') {
      const items = Array.from(localHand);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);
      
      setLocalHand(items);
      // We also need to save this sorting to Firestore to persist it across reloads
      await updateDoc(doc(db, 'games', game.id), {
        [`state.players.${auth.currentUser.uid}.hand`]: items
      });
      return;
    }

    // Discarding a card
    if (result.source.droppableId === 'my-hand' && result.destination.droppableId === 'discard-pile') {
      const isMyTurn = game.state.playerIds[game.state.turnIndex] === auth.currentUser.uid;
      const isPlayPhase = game.state.turnPhase === 'play';
      
      if (!isMyTurn || !isPlayPhase) return;
      if (stagedMelds.length > 0) {
        setErrorMsg("Please play or cancel your staged melds before discarding.");
        return;
      }

      const items = Array.from(localHand);
      const [discardedCard] = items.splice(result.source.index, 1);
      
      setLocalHand(items); // Optimistic UI

      const isWin = items.length === 0;
      const nextTurnIndex = (game.state.turnIndex + 1) % game.state.playerIds.length;

      const updates: any = {
        [`state.players.${auth.currentUser.uid}.hand`]: items,
        'state.discardPile': [...game.state.discardPile, discardedCard]
      };

      if (isWin) {
        updates.status = 'finished';
        updates.winner = auth.currentUser.uid;

        // Calculate penalty points for all players
        game.state.playerIds.forEach((uid: string) => {
          if (uid === auth.currentUser!.uid) {
            updates[`state.players.${uid}.score`] = 0; // Winner has 0 penalty
          } else {
            const loserHand = uid === auth.currentUser!.uid ? items : game.state.players[uid].hand;
            updates[`state.players.${uid}.score`] = calculatePenaltyPoints(loserHand);
          }
        });
      } else {
        updates['state.turnIndex'] = nextTurnIndex;
        updates['state.turnPhase'] = 'draw';
      }

      await updateDoc(doc(db, 'games', game.id), updates);
      return;
    }

    // Attaching a card to a meld
    if (result.source.droppableId === 'my-hand' && result.destination.droppableId.startsWith('meld-')) {
      const isMyTurn = game.state.playerIds[game.state.turnIndex] === auth.currentUser.uid;
      const isPlayPhase = game.state.turnPhase === 'play';
      
      if (!isMyTurn || !isPlayPhase) return;
      if (stagedMelds.length > 0) {
        setErrorMsg("Please play or cancel your staged melds before attaching.");
        return;
      }

      const playerState = game.state.players[auth.currentUser.uid];
      if (!playerState.hasMelded) {
        setErrorMsg("You must play your initial 45-point meld before attaching cards.");
        return;
      }

      const items = Array.from(localHand);
      if (items.length === 1) {
        setErrorMsg("You cannot attach your last card. You must keep one card to discard (Inchidere).");
        return;
      }

      const meldId = result.destination.droppableId.replace('meld-', '');
      const meldIndex = game.state.melds.findIndex((m: any) => m.id === meldId);
      if (meldIndex === -1) return;

      const targetMeld = game.state.melds[meldIndex];
      const cardToAttach = items[result.source.index];

      const attachCheck = canAttachToMeld(targetMeld.cards, cardToAttach);
      if (!attachCheck.isValid) {
        setErrorMsg("That card cannot be attached to this meld.");
        return;
      }

      // Valid attachment!
      items.splice(result.source.index, 1);
      setLocalHand(items); // Optimistic UI
      setErrorMsg(null);

      const updatedMelds = [...game.state.melds];
      updatedMelds[meldIndex] = { ...targetMeld, cards: attachCheck.newCards };

      const updates: any = {
        [`state.players.${auth.currentUser.uid}.hand`]: items,
        'state.melds': updatedMelds
      };

      await updateDoc(doc(db, 'games', game.id), updates);
      return;
    }
  };

  const handleDrawFromDeck = async () => {
    if (!auth.currentUser) return;
    const isMyTurn = game.state.playerIds[game.state.turnIndex] === auth.currentUser.uid;
    const isDrawPhase = game.state.turnPhase === 'draw';
    
    if (!isMyTurn || !isDrawPhase || game.state.deck.length === 0) return;

    const deck = [...game.state.deck];
    const drawnCard = deck.shift();
    if (!drawnCard) return;

    const newHand = [...localHand, drawnCard];
    setLocalHand(newHand); // Optimistic UI

    await updateDoc(doc(db, 'games', game.id), {
      'state.deck': deck,
      [`state.players.${auth.currentUser.uid}.hand`]: newHand,
      'state.turnPhase': 'play'
    });
  };

  const handleDrawFromDiscard = async () => {
    if (!auth.currentUser) return;
    const isMyTurn = game.state.playerIds[game.state.turnIndex] === auth.currentUser.uid;
    const isDrawPhase = game.state.turnPhase === 'draw';
    
    if (!isMyTurn || !isDrawPhase || game.state.discardPile.length === 0) return;

    const discardPile = [...game.state.discardPile];
    const drawnCard = discardPile.pop(); // Take the top card
    if (!drawnCard) return;

    const newHand = [...localHand, drawnCard];
    setLocalHand(newHand); // Optimistic UI

    await updateDoc(doc(db, 'games', game.id), {
      'state.discardPile': discardPile,
      [`state.players.${auth.currentUser.uid}.hand`]: newHand,
      'state.turnPhase': 'play'
    });
  };

  const toggleCardSelection = (cardId: string) => {
    if (selectedCards.includes(cardId)) {
      setSelectedCards(selectedCards.filter(id => id !== cardId));
    } else {
      setSelectedCards([...selectedCards, cardId]);
    }
    setErrorMsg(null);
  };

  const stageMeld = () => {
    const cardsToMeld = localHand.filter(c => selectedCards.includes(c.id));
    const result = validateMeld(cardsToMeld);
    
    if (!result.isValid) {
      setErrorMsg(result.error || "Invalid meld.");
      setSelectedCards([]);
      return;
    }

    setStagedMelds([...stagedMelds, { cards: cardsToMeld, type: result.type!, points: result.points }]);
    setLocalHand(localHand.filter(c => !selectedCards.includes(c.id)));
    setSelectedCards([]);
    setErrorMsg(null);
  };

  const cancelStagedMelds = () => {
    const returningCards = stagedMelds.flatMap(m => m.cards);
    setLocalHand([...localHand, ...returningCards]);
    setStagedMelds([]);
    setErrorMsg(null);
  };

  const playMeldsToBoard = async () => {
    if (!auth.currentUser) return;
    const player = game.state.players[auth.currentUser.uid];

    if (!player.hasMelded) {
      const totalPoints = stagedMelds.reduce((sum, m) => sum + m.points, 0);
      const hasRun = stagedMelds.some(m => m.type === 'run');
      
      if (totalPoints < 45 || !hasRun) {
        setErrorMsg(`Initial meld requires 45 points and at least 1 run. You have ${totalPoints} pts.`);
        return;
      }
    }

    const newMelds = stagedMelds.map(m => ({
      id: Math.random().toString(36).substr(2, 9),
      playerId: auth.currentUser!.uid,
      cards: m.cards
    }));

    const updates: any = {
      [`state.players.${auth.currentUser.uid}.hand`]: localHand,
      [`state.players.${auth.currentUser.uid}.hasMelded`]: true,
      'state.melds': [...game.state.melds, ...newMelds]
    };

    if (localHand.length === 0) {
      updates.status = 'finished';
      updates.winner = auth.currentUser.uid;
    }

    await updateDoc(doc(db, 'games', game.id), updates);
    setStagedMelds([]);
    setErrorMsg(null);
  };

  const isMyTurn = game.status === 'playing' && game.state.playerIds[game.state.turnIndex] === auth.currentUser?.uid;
  const turnPhase = game.state.turnPhase;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-emerald-800 rounded-xl relative">
      {/* Top Bar */}
      <div className="bg-emerald-900/80 p-2 sm:p-3 flex items-center justify-between shrink-0 z-10 border-b border-emerald-900">
        <button onClick={onBack} className="text-emerald-100 hover:text-white flex items-center gap-1 text-sm font-medium transition-colors">
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
        <div className="flex items-center gap-2">
          {game.state.playerIds.map((uid: string) => (
            <div key={uid} className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-500 bg-zinc-800 flex items-center justify-center overflow-hidden">
                {userMap[uid]?.photoURL ? (
                  <img src={userMap[uid].photoURL} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-white">{userMap[uid]?.name?.charAt(0) || '?'}</span>
                )}
              </div>
              <span className="text-[10px] text-emerald-100 mt-0.5">
                {game.state.players[uid]?.hand?.length || 0} cards
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Lobby / Waiting Screen */}
      {game.status === 'waiting' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-emerald-900/50 p-8 rounded-3xl backdrop-blur-sm border border-emerald-500/30 max-w-sm w-full">
            <h2 className="text-2xl font-bold text-white mb-2">Rummy 45</h2>
            <p className="text-emerald-200 mb-6 text-sm">
              Waiting for players to join... ({game.state.playerIds.length}/4)
            </p>
            
            <div className="flex flex-col gap-3">
              {!isJoined && (
                <button onClick={handleJoin} className="w-full py-3 bg-white text-emerald-900 font-bold rounded-xl hover:bg-emerald-50 transition-colors">
                  Join Game
                </button>
              )}
              {isOwner && (
                <button 
                  onClick={handleStartGame} 
                  disabled={game.state.playerIds.length < 2}
                  className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" /> Start Game
                </button>
              )}
              {isJoined && !isOwner && (
                <p className="text-emerald-300 text-sm italic">Waiting for host to start...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active Game Board */}
      {game.status === 'playing' && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex-1 flex flex-col relative">
            
            {/* Turn Indicator */}
            <div className="bg-emerald-950 text-center py-2 text-sm font-bold shadow-md z-10 flex items-center justify-center gap-2">
              {isMyTurn ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                  <span className="text-white">Your Turn! ({turnPhase === 'draw' ? 'Draw a card' : 'Meld or Discard'})</span>
                </>
              ) : (
                <>
                  <span className="text-emerald-300">
                    Waiting for {userMap[game.state.playerIds[game.state.turnIndex]]?.name}...
                  </span>
                </>
              )}
            </div>

            {/* Play Area (Table) */}
            <div className="flex-1 p-4 flex flex-col">
              {/* Deck & Discard */}
              <div className="flex justify-center gap-6 mb-8 mt-2">
                {/* Deck */}
                <div className="flex flex-col items-center">
                  <div 
                    onClick={handleDrawFromDeck}
                    className={`w-16 h-24 sm:w-20 sm:h-28 bg-emerald-900 border-2 border-emerald-700 rounded-xl shadow-lg flex items-center justify-center text-emerald-500 transition-colors ${isMyTurn && turnPhase === 'draw' ? 'ring-4 ring-green-400 cursor-pointer hover:bg-emerald-800 animate-pulse' : 'opacity-80'}`}
                  >
                    <span className="font-bold text-sm text-center px-1">{isMyTurn && turnPhase === 'draw' ? 'Click to Draw' : 'Deck'}</span>
                  </div>
                  <span className="text-emerald-200 text-xs mt-2">{game.state.deck?.length} left</span>
                </div>
                
                {/* Discard Pile */}
                <div className="flex flex-col items-center">
                  <Droppable droppableId="discard-pile">
                    {(provided, snapshot) => (
                      <div 
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        onClick={handleDrawFromDiscard}
                        className={`w-16 h-24 sm:w-20 sm:h-28 bg-emerald-900/30 border-2 rounded-xl flex items-center justify-center transition-all ${snapshot.isDraggingOver ? 'bg-emerald-800 border-green-400 scale-105 shadow-[0_0_15px_rgba(74,222,128,0.5)]' : isMyTurn && turnPhase === 'play' ? 'border-dashed border-yellow-400 ring-2 ring-yellow-400/50' : isMyTurn && turnPhase === 'draw' && game.state.discardPile?.length > 0 ? 'border-green-400 ring-4 ring-green-400/50 cursor-pointer animate-pulse' : 'border-dashed border-emerald-500/50'}`}
                      >
                        {game.state.discardPile?.length > 0 ? (
                          <div className="w-full h-full p-1 pointer-events-none">
                            <Card face={game.state.discardPile[game.state.discardPile.length - 1]} />
                          </div>
                        ) : (
                          <span className="text-emerald-500/50 text-xs text-center px-2">
                            {snapshot.isDraggingOver ? 'Drop to Discard' : 'Discard'}
                          </span>
                        )}
                        {/* Hidden placeholder to satisfy dnd library */}
                        <div className="hidden">{provided.placeholder}</div>
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
              
              {/* Melds Area (The Board) */}
              <div className="flex-1 bg-emerald-900/20 rounded-xl border border-emerald-700/50 p-4 overflow-y-auto flex flex-col gap-4">
                {game.state.melds.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-emerald-500/50 text-sm font-medium">
                    No melds on the board yet.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {game.state.melds.map((meld: any) => (
                      <Droppable key={meld.id} droppableId={`meld-${meld.id}`} direction="horizontal">
                        {(provided, snapshot) => (
                          <div 
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`bg-emerald-800/30 p-2 rounded-lg border transition-colors ${snapshot.isDraggingOver ? 'bg-emerald-700/50 border-yellow-400 ring-2 ring-yellow-400/50' : 'border-emerald-700/30'}`}
                          >
                            <div className="text-[10px] text-emerald-400/70 mb-1 uppercase tracking-wider font-bold">
                              {userMap[meld.playerId]?.name}
                            </div>
                            <div className="flex -space-x-8 sm:-space-x-12 hover:space-x-1 transition-all">
                              {meld.cards.map((c: any, i: number) => (
                                <div key={c.id} className="relative shadow-md h-16 sm:h-20 shrink-0" style={{ zIndex: i }}>
                                  <Card face={c} />
                                </div>
                              ))}
                              <div className="hidden">{provided.placeholder}</div>
                            </div>
                          </div>
                        )}
                      </Droppable>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Staged Melds Area */}
            {stagedMelds.length > 0 && isMyTurn && turnPhase === 'play' && (
              <div className="bg-indigo-950 border-t-2 border-indigo-500 p-3 shadow-lg z-20 shrink-0">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-indigo-300 font-bold text-sm">Staged Melds ({stagedMelds.reduce((sum, m) => sum + m.points, 0)} pts)</span>
                  <div className="flex gap-2">
                    <button onClick={cancelStagedMelds} className="px-3 py-1 bg-zinc-800 text-white text-xs rounded shadow hover:bg-zinc-700">Cancel</button>
                    <button onClick={playMeldsToBoard} className="px-3 py-1 bg-indigo-500 text-white font-bold text-xs rounded shadow hover:bg-indigo-400">Play Melds to Board</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  {stagedMelds.map((meld, idx) => (
                    <div key={idx} className="flex -space-x-8 sm:-space-x-12">
                      {meld.cards.map((c, i) => (
                        <div key={c.id} className="relative shadow-sm h-16 sm:h-20 shrink-0" style={{ zIndex: i }}>
                          <Card face={c} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="absolute bottom-40 left-4 right-4 bg-red-500 text-white p-2 rounded text-center text-sm font-bold shadow-xl z-50 animate-in fade-in slide-in-from-bottom-2">
                {errorMsg}
              </div>
            )}

            {/* Current Player Hand */}
            {isJoined && (
              <div className="h-32 sm:h-40 bg-emerald-950/80 p-2 sm:p-4 overflow-x-auto overflow-y-hidden border-t border-emerald-900 shrink-0 relative">
                {isMyTurn && turnPhase === 'play' && selectedCards.length >= 3 && (
                  <div className="absolute top-0 left-0 right-0 flex justify-center -mt-6 z-30">
                    <button 
                      onClick={stageMeld}
                      className="px-6 py-2 bg-yellow-500 text-yellow-950 font-black rounded-full shadow-[0_0_15px_rgba(234,179,8,0.5)] animate-bounce text-sm"
                    >
                      Meld {selectedCards.length} Cards
                    </button>
                  </div>
                )}
                <Droppable droppableId="my-hand" direction="horizontal">
                  {(provided) => (
                    <div 
                      ref={provided.innerRef} 
                      {...provided.droppableProps}
                      className="flex gap-1.5 sm:gap-2 h-full min-w-min px-2 pt-2"
                    >
                      {localHand.map((card: any, index: number) => (
                        <Draggable key={card.id} draggableId={card.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`h-full transition-transform ${snapshot.isDragging ? 'z-50 scale-105' : ''} ${selectedCards.includes(card.id) ? '-translate-y-3' : ''}`}
                            >
                              <Card 
                                face={card} 
                                isSelected={selectedCards.includes(card.id)}
                                onClick={() => {
                                  if (isMyTurn && turnPhase === 'play') toggleCardSelection(card.id);
                                }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

// Sub-component for rendering a card
function Card({ face, isSelected, onClick }: { face: any, isSelected?: boolean, onClick?: () => void }) {
  const isRed = face.suit === 'H' || face.suit === 'D';
  const colorClass = face.isJoker ? 'text-purple-600' : (isRed ? 'text-red-600' : 'text-slate-900');
  
  let SuitIcon = '';
  if (face.suit === 'H') SuitIcon = '♥';
  if (face.suit === 'D') SuitIcon = '♦';
  if (face.suit === 'C') SuitIcon = '♣';
  if (face.suit === 'S') SuitIcon = '♠';

  return (
    <div 
      onClick={onClick}
      className={`w-12 sm:w-16 h-full bg-white rounded-lg shadow-md border ${isSelected ? 'border-yellow-400 ring-4 ring-yellow-400/50' : 'border-zinc-200'} flex flex-col items-center justify-center select-none cursor-pointer ${colorClass}`}
    >
      {face.isJoker ? (
        <div className="font-bold text-center flex flex-col items-center">
          <span className="text-xs uppercase">Joker</span>
          <span className="text-2xl mt-1">🤡</span>
        </div>
      ) : (
        <>
          <div className="text-lg sm:text-xl font-bold -mb-1">{face.value}</div>
          <div className="text-2xl sm:text-3xl">{SuitIcon}</div>
        </>
      )}
    </div>
  );
}
