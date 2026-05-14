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

import { validateMeld, canAttachToMeld, calculatePenaltyPoints, canSwapJoker, VALUE_ORDER } from './RummyEngine';

export default function RummyGame({ game, userMap, onBack }: RummyGameProps) {
  const [localHand, setLocalHand] = useState<any[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [stagedMelds, setStagedMelds] = useState<{cards: any[], type: 'set'|'run', points: number}[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOwner = game.createdBy === auth.currentUser?.uid;
  const isJoined = game.state.playerIds.includes(auth.currentUser?.uid);

  useEffect(() => {
    if (auth.currentUser && game.state.players[auth.currentUser.uid]?.hand) {
      const dbHand = game.state.players[auth.currentUser.uid].hand;
      const paddedHand = Array(30).fill(null);
      for (let i = 0; i < dbHand.length && i < 30; i++) {
        paddedHand[i] = dbHand[i];
      }
      setLocalHand(paddedHand);
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

  const sortHand = async () => {
    if (!auth.currentUser) return;
    const items = localHand.filter(c => c !== null);
    
    items.sort((a, b) => {
      if (a.isJoker && !b.isJoker) return 1;
      if (!a.isJoker && b.isJoker) return -1;
      if (a.isJoker && b.isJoker) return 0;
      
      const suitOrder = ['H', 'S', 'D', 'C'];
      if (a.suit !== b.suit) return suitOrder.indexOf(a.suit!) - suitOrder.indexOf(b.suit!);
      
      return VALUE_ORDER.indexOf(a.value!) - VALUE_ORDER.indexOf(b.value!);
    });

    const newHand = Array(30).fill(null);
    for (let i = 0; i < items.length; i++) {
      newHand[i] = items[i];
    }

    setLocalHand(newHand);
    await updateDoc(doc(db, 'games', game.id), {
      [`state.players.${auth.currentUser.uid}.hand`]: newHand
    });
  };

  const onDragEnd = async (result: any) => {
    if (!result.destination || !auth.currentUser) return;

    // Local re-ordering of hand
    if (result.source.droppableId.startsWith('my-hand-') && result.destination.droppableId.startsWith('my-hand-')) {
      const sourceIdx = parseInt(result.source.droppableId.split('-')[2]);
      const destIdx = parseInt(result.destination.droppableId.split('-')[2]);
      
      const items = [...localHand];
      const itemToMove = items[sourceIdx];
      const itemAtDest = items[destIdx];
      
      items[destIdx] = itemToMove;
      items[sourceIdx] = itemAtDest;
      
      setLocalHand(items);
      await updateDoc(doc(db, 'games', game.id), {
        [`state.players.${auth.currentUser.uid}.hand`]: items
      });
      return;
    }

    // Discarding a card
    if (result.source.droppableId.startsWith('my-hand-') && result.destination.droppableId === 'discard-pile') {
      const isMyTurn = game.state.playerIds[game.state.turnIndex] === auth.currentUser.uid;
      const isPlayPhase = game.state.turnPhase === 'play';
      
      if (!isMyTurn || !isPlayPhase) return;
      if (stagedMelds.length > 0) {
        setErrorMsg("Please play or cancel your staged melds before discarding.");
        return;
      }

      const items = [...localHand];
      const sourceIdx = parseInt(result.source.droppableId.split('-')[2]);
      const discardedCard = items[sourceIdx];
      items[sourceIdx] = null;
      
      setLocalHand(items); // Optimistic UI

      const isWin = items.filter(c => c !== null).length === 0;
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
    if (result.source.droppableId.startsWith('my-hand-') && result.destination.droppableId.startsWith('meld-')) {
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

      const items = [...localHand];
      const nonNulls = items.filter(c => c !== null);
      if (nonNulls.length === 1) {
        setErrorMsg("You cannot attach your last card. You must keep one card to discard (Inchidere).");
        return;
      }

      const meldId = result.destination.droppableId.replace('meld-', '');
      const meldIndex = game.state.melds.findIndex((m: any) => m.id === meldId);
      if (meldIndex === -1) return;

      const targetMeld = game.state.melds[meldIndex];
      const sourceIdx = parseInt(result.source.droppableId.split('-')[2]);
      const cardToAttach = items[sourceIdx];

      const attachCheck = canAttachToMeld(targetMeld.cards, cardToAttach);
      const swapCheck = canSwapJoker(targetMeld.cards, cardToAttach);

      if (!attachCheck.isValid && !swapCheck.isValid) {
        setErrorMsg("That card cannot be attached or swapped to this meld.");
        return;
      }

      let updatedMeldCards = targetMeld.cards;
      if (swapCheck.isValid) {
        updatedMeldCards = swapCheck.newMeldCards!;
        items[sourceIdx] = null;
        const originalJoker = targetMeld.cards.find((c: any) => c.isJoker && !updatedMeldCards.includes(c));
        if (originalJoker) {
           const emptyIdx = items.findIndex(c => c === null);
           if (emptyIdx !== -1) items[emptyIdx] = originalJoker;
        }
      } else {
        updatedMeldCards = attachCheck.newCards!;
        items[sourceIdx] = null;
      }

      setLocalHand(items); // Optimistic UI
      setErrorMsg(null);

      const updatedMelds = [...game.state.melds];
      updatedMelds[meldIndex] = { ...targetMeld, cards: updatedMeldCards };

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

    const newHand = [...localHand];
    const emptyIdx = newHand.findIndex(c => c === null);
    if (emptyIdx !== -1) newHand[emptyIdx] = drawnCard;
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

    const newHand = [...localHand];
    const emptyIdx = newHand.findIndex(c => c === null);
    if (emptyIdx !== -1) newHand[emptyIdx] = drawnCard;
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
    setLocalHand(localHand.map(c => c && selectedCards.includes(c.id) ? null : c));
    setSelectedCards([]);
    setErrorMsg(null);
  };

  const cancelStagedMelds = () => {
    const returningCards = stagedMelds.flatMap(m => m.cards);
    const newHand = [...localHand];
    returningCards.forEach(c => {
      const emptyIdx = newHand.findIndex(item => item === null);
      if (emptyIdx !== -1) newHand[emptyIdx] = c;
    });
    setLocalHand(newHand);
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

    if (localHand.filter(c => c !== null).length === 0) {
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
    <div className="flex flex-col h-full overflow-hidden rounded-xl relative" style={{ background: 'linear-gradient(180deg, #1a4d3a 0%, #14532d 50%, #0f3d22 100%)' }}>
      {/* Top Bar */}
      <div className="bg-black/20 backdrop-blur-sm p-2 sm:p-3 flex items-center justify-between shrink-0 z-10 border-b border-emerald-900/50">
        <button onClick={onBack} className="text-emerald-200 hover:text-white flex items-center gap-1 text-sm font-medium transition-colors">
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
        <div className="flex items-center gap-3">
          {game.state.playerIds.map((uid: string) => {
            const isActive = game.status === 'playing' && game.state.playerIds[game.state.turnIndex] === uid;
            const cardCount = game.state.players[uid]?.hand?.filter((c: any) => c !== null).length || 0;
            return (
              <div key={uid} className={`flex flex-col items-center transition-all ${isActive ? 'scale-110' : 'opacity-70'}`}>
                <div className={`w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden transition-all ${isActive ? 'ring-2 ring-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)]' : 'border border-emerald-600/50'}`}>
                  {userMap[uid]?.photoURL ? (
                    <img src={userMap[uid].photoURL} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-white">{userMap[uid]?.name?.charAt(0) || '?'}</span>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'text-yellow-300' : 'text-emerald-300'}`}>
                  {cardCount}
                </span>
              </div>
            );
          })}
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
            <div className="text-center py-2 text-sm font-bold z-10 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
              {isMyTurn ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-white">{turnPhase === 'draw' ? 'Draw a card' : 'Meld or Discard'}</span>
                </>
              ) : (
                <span className="text-emerald-400/70">
                  Waiting for {userMap[game.state.playerIds[game.state.turnIndex]]?.name}...
                </span>
              )}
            </div>

            {/* Play Area (Table) */}
            <div className="flex-1 p-4 flex flex-col">
              {/* Deck & Discard */}
              <div className="flex justify-center gap-8 mb-6 mt-2">
                {/* Deck */}
                <div className="flex flex-col items-center gap-1.5">
                  <div 
                    onClick={handleDrawFromDeck}
                    className={`w-14 h-20 sm:w-16 sm:h-24 rounded-lg flex items-center justify-center transition-all ${isMyTurn && turnPhase === 'draw' ? 'cursor-pointer hover:scale-105 ring-2 ring-green-400 shadow-[0_0_12px_rgba(74,222,128,0.3)]' : 'opacity-70'}`}
                    style={{ background: 'linear-gradient(135deg, #1e3a5f, #0f2744)', border: '2px solid #2a5a8a' }}
                  >
                    <span className="font-bold text-[10px] sm:text-xs text-center px-1 text-blue-200">{isMyTurn && turnPhase === 'draw' ? 'DRAW' : 'DECK'}</span>
                  </div>
                  <span className="text-emerald-300/70 text-[10px] font-medium">{game.state.deck?.length} left</span>
                </div>
                
                {/* Discard Pile */}
                <div className="flex flex-col items-center gap-1.5">
                  <Droppable droppableId="discard-pile">
                    {(provided: any, snapshot: any) => (
                      <div 
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        onClick={handleDrawFromDiscard}
                        className={`w-14 h-20 sm:w-16 sm:h-24 rounded-lg flex items-center justify-center transition-all ${snapshot.isDraggingOver ? 'scale-105 ring-2 ring-green-400 shadow-[0_0_12px_rgba(74,222,128,0.4)]' : isMyTurn && turnPhase === 'draw' && game.state.discardPile?.length > 0 ? 'ring-2 ring-green-400 cursor-pointer shadow-[0_0_8px_rgba(74,222,128,0.3)]' : isMyTurn && turnPhase === 'play' ? 'border-2 border-dashed border-yellow-500/60' : 'border-2 border-dashed border-emerald-600/40'}`}
                        style={{ background: snapshot.isDraggingOver ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.15)' }}
                      >
                        {game.state.discardPile?.length > 0 ? (
                          <div className="w-full h-full p-0.5 pointer-events-none">
                            <Card face={game.state.discardPile[game.state.discardPile.length - 1]} />
                          </div>
                        ) : (
                          <span className="text-emerald-500/40 text-[10px] text-center px-1 font-medium">
                            {snapshot.isDraggingOver ? 'DROP' : 'DISCARD'}
                          </span>
                        )}
                        <div className="hidden">{provided.placeholder}</div>
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
              
              {/* Melds Area (The Board) */}
              <div className="flex-1 rounded-xl p-3 overflow-y-auto flex flex-col gap-3" style={{ background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(16,185,129,0.15)' }}>
                {game.state.melds.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-emerald-600/40 text-sm font-medium">
                    No melds on the board yet.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {game.state.melds.map((meld: any) => (
                      <Droppable key={meld.id} droppableId={`meld-${meld.id}`} direction="horizontal">
                        {(provided: any, snapshot: any) => (
                          <div 
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`p-2 rounded-lg transition-all ${snapshot.isDraggingOver ? 'ring-2 ring-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.2)]' : ''}`}
                            style={{ background: snapshot.isDraggingOver ? 'rgba(250,204,21,0.08)' : 'rgba(0,0,0,0.1)', border: snapshot.isDraggingOver ? '1px solid rgba(250,204,21,0.4)' : '1px solid rgba(16,185,129,0.1)' }}
                          >
                            <div className="text-[9px] text-emerald-400/50 mb-1 uppercase tracking-widest font-bold">
                              {userMap[meld.playerId]?.name}
                            </div>
                            <div className="flex -space-x-6 sm:-space-x-8 hover:space-x-0.5 transition-all duration-200">
                              {meld.cards.map((c: any, i: number) => (
                                <div key={c.id} className="relative h-14 sm:h-18 shrink-0" style={{ zIndex: i }}>
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
              <div className="h-32 sm:h-40 p-2 sm:p-3 overflow-x-auto overflow-y-hidden shrink-0 relative" style={{ background: 'rgba(0,0,0,0.25)', borderTop: '1px solid rgba(16,185,129,0.15)' }}>
                <button onClick={sortHand} className="absolute top-2 right-2 z-40 px-3 py-1 text-emerald-300 text-[10px] font-bold rounded-md transition-colors hover:bg-white/10" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  Sort
                </button>
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
                <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] grid-rows-2 gap-1.5 sm:gap-2 h-full w-max px-2 pt-2 pb-2">
                  {localHand.map((card: any, index: number) => (
                    <Droppable key={`my-hand-${index}`} droppableId={`my-hand-${index}`}>
                      {(provided: any, snapshot: any) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`w-10 sm:w-12 h-16 sm:h-20 rounded-xl transition-colors ${snapshot.isDraggingOver ? 'bg-white/20 ring-2 ring-white/50' : 'bg-black/20'}`}
                        >
                          {card && (
                            <Draggable draggableId={card.id} index={0}>
                              {(provided: any, snapshot: any) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`h-full transition-all ${snapshot.isDragging ? 'z-50 scale-105' : ''} ${selectedCards.includes(card.id) ? '-translate-y-3' : ''}`}
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
                          )}
                          <div className="hidden">{provided.placeholder}</div>
                        </div>
                      )}
                    </Droppable>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DragDropContext>
      )}

      {/* Game Over Screen */}
      {game.status === 'finished' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-black/30 backdrop-blur-sm p-8 rounded-2xl border border-emerald-500/20 max-w-sm w-full">
            <div className="text-4xl mb-3">🏆</div>
            <h2 className="text-xl font-bold text-white mb-1">Game Over!</h2>
            <p className="text-emerald-300 text-sm mb-6">
              {userMap[game.winner]?.name || 'Someone'} wins!
            </p>
            
            <div className="space-y-2 mb-6">
              {game.state.playerIds
                .sort((a: string, b: string) => (game.state.players[a]?.score || 0) - (game.state.players[b]?.score || 0))
                .map((uid: string, idx: number) => {
                  const score = game.state.players[uid]?.score || 0;
                  const isWinner = uid === game.winner;
                  return (
                    <div key={uid} className={`flex items-center justify-between p-3 rounded-xl transition-all ${isWinner ? 'bg-yellow-500/15 border border-yellow-500/30' : 'bg-white/5 border border-white/5'}`}>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${isWinner ? 'text-yellow-400' : 'text-emerald-400/60'}`}>#{idx + 1}</span>
                        <div className={`w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ${isWinner ? 'ring-2 ring-yellow-400' : ''}`}>
                          {userMap[uid]?.photoURL ? (
                            <img src={userMap[uid].photoURL} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-white">{userMap[uid]?.name?.charAt(0) || '?'}</span>
                          )}
                        </div>
                        <span className={`text-sm font-medium ${isWinner ? 'text-white' : 'text-emerald-200/70'}`}>{userMap[uid]?.name || uid.slice(0,6)}</span>
                      </div>
                      <span className={`text-sm font-bold ${isWinner ? 'text-yellow-400' : 'text-red-400'}`}>
                        {isWinner ? '👑 0' : score} pts
                      </span>
                    </div>
                  );
                })}
            </div>

            <button onClick={onBack} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors">
              Back to Arcade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component for rendering a Rummy Tile
const VALUE_MAP: Record<string, string> = {
  'A': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 'J': '11', 'Q': '12', 'K': '13'
};

const SUIT_COLORS: Record<string, { text: string; dot: string; glow: string }> = {
  'H': { text: 'text-red-600', dot: 'bg-red-500', glow: 'shadow-red-500/30' },
  'D': { text: 'text-amber-500', dot: 'bg-amber-400', glow: 'shadow-amber-400/30' },
  'C': { text: 'text-sky-600', dot: 'bg-sky-500', glow: 'shadow-sky-500/30' },
  'S': { text: 'text-zinc-800', dot: 'bg-zinc-700', glow: 'shadow-zinc-700/30' },
};

function Card({ face, isSelected, onClick }: { face: any, isSelected?: boolean, onClick?: () => void }) {
  if (!face) return <div className="w-10 sm:w-12 h-full opacity-0" />;

  const suitStyle = face.isJoker ? null : SUIT_COLORS[face.suit] || SUIT_COLORS['S'];
  const displayValue = face.isJoker ? '' : (VALUE_MAP[face.value] || face.value);

  return (
    <div 
      onClick={onClick}
      className={`w-10 sm:w-12 h-full rounded-lg relative overflow-hidden select-none cursor-pointer transition-all duration-150
        ${isSelected 
          ? 'ring-2 ring-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.4)]' 
          : 'shadow-[1px_2px_4px_rgba(0,0,0,0.25)]'
        }`}
      style={{ 
        background: 'linear-gradient(145deg, #faf8f4, #f0ece4)',
        borderBottom: isSelected ? '3px solid #facc15' : '3px solid #d4cfc5',
        borderRight: isSelected ? '1px solid #facc15' : '1px solid #e0dbd3',
      }}
    >
      {face.isJoker ? (
        <div className="h-full flex flex-col items-center justify-center gap-0.5">
          <span className="text-lg sm:text-xl">🃏</span>
          <span className="text-[7px] font-black uppercase tracking-wider text-purple-500">Joker</span>
        </div>
      ) : (
        <div className="h-full flex flex-col items-center justify-center relative">
          {/* Suit dot - top left */}
          <div className={`absolute top-1 left-1 w-2 h-2 rounded-full ${suitStyle!.dot} shadow-sm ${suitStyle!.glow}`} />
          {/* Number */}
          <span className={`text-xl sm:text-2xl font-black leading-none ${suitStyle!.text}`} style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
            {displayValue}
          </span>
          {/* Suit dot - bottom right */}
          <div className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${suitStyle!.dot} shadow-sm ${suitStyle!.glow}`} />
        </div>
      )}
    </div>
  );
}
