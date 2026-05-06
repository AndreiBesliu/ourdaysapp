import { useState, useEffect } from 'react';
import { X, Gamepad2, Play, Clock, Trash2 } from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import TicTacToe from './TicTacToe';
import RummyGame from './rummy/RummyGame';
import { format } from 'date-fns';

interface GamesHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  userMap: Record<string, any>;
  selectedDate: Date | null;
}

export default function GamesHubModal({ isOpen, onClose, groupId, groupName, userMap, selectedDate }: GamesHubModalProps) {
  const [activeGames, setActiveGames] = useState<any[]>([]);
  const [playingGameId, setPlayingGameId] = useState<string | null>(null);
  const [view, setView] = useState<'arcade' | 'leaderboard'>('arcade');
  const [leaderboard, setLeaderboard] = useState<{uid: string, wins: number}[]>([]);

  // Daily Games Query
  useEffect(() => {
    if (!isOpen || !groupId || !selectedDate) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const q = query(
      collection(db, 'games'),
      where('groupId', '==', groupId),
      where('date', '==', dateStr)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setActiveGames(games.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
    });

    return () => unsubscribe();
  }, [isOpen, groupId, selectedDate]);

  // Leaderboard Query
  useEffect(() => {
    if (!isOpen || !groupId || view !== 'leaderboard') return;

    const q = query(collection(db, 'games'), where('groupId', '==', groupId), where('status', '==', 'finished'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => d.data());
      const winsMap: Record<string, number> = {};
      
      games.forEach(g => {
        if (g.winner) {
          winsMap[g.winner] = (winsMap[g.winner] || 0) + 1;
        }
      });

      const sortedLeaderboard = Object.entries(winsMap)
        .map(([uid, wins]) => ({ uid, wins }))
        .sort((a, b) => b.wins - a.wins);

      setLeaderboard(sortedLeaderboard);
    });

    return () => unsubscribe();
  }, [isOpen, groupId, view]);

  const handleCreateGame = async (gameType: string) => {
    if (!auth.currentUser || !selectedDate) return;
    
    try {
      let initialState = {};
      let playerIds = [auth.currentUser.uid];

      if (gameType === 'tic-tac-toe') {
        initialState = {
          board: Array(9).fill(null),
          xIsNext: true,
          players: { X: auth.currentUser.uid, O: null }
        };
      } else if (gameType === 'rummy-45') {
        initialState = {
          players: {
            [auth.currentUser.uid]: { uid: auth.currentUser.uid, hand: [], hasMelded: false, score: 0 }
          },
          playerIds: playerIds,
          turnIndex: 0,
          deck: [],
          discardPile: [],
          melds: [],
          status: 'waiting',
          winner: null
        };
      }

      const docRef = await addDoc(collection(db, 'games'), {
        groupId,
        date: format(selectedDate, 'yyyy-MM-dd'),
        gameType,
        status: 'waiting', // waiting, playing, finished
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
        state: initialState,
        winner: null
      });

      setView('arcade');
      setPlayingGameId(docRef.id);
    } catch (error) {
      console.error("Error creating game:", error);
    }
  };

  const handleCancelGame = async (gameId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'games', gameId));
      if (playingGameId === gameId) setPlayingGameId(null);
    } catch (err) {
      console.error("Error deleting game:", err);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If playing a game, don't close the whole modal, just exit game view? 
        // Actually, let's just close the modal.
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeGame = activeGames.find(g => g.id === playingGameId);

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col h-[80vh] overflow-hidden border border-zinc-200 dark:border-zinc-800 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg text-zinc-900 dark:text-white">
              {playingGameId ? "Playing Game" : `${groupName} Arcade`}
            </h3>
          </div>
          <button 
            onClick={() => playingGameId ? setPlayingGameId(null) : onClose()} 
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col relative bg-zinc-50 dark:bg-zinc-950">
          {playingGameId && activeGame ? (
            <div className="flex-1 flex flex-col">
              {activeGame.gameType === 'tic-tac-toe' && (
                <TicTacToe game={activeGame} userMap={userMap} onBack={() => setPlayingGameId(null)} />
              )}
              {activeGame.gameType === 'rummy-45' && (
                <RummyGame game={activeGame} userMap={userMap} onBack={() => setPlayingGameId(null)} />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              
              {/* Tabs */}
              <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl w-fit mx-auto">
                <button 
                  onClick={() => setView('arcade')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${view === 'arcade' ? 'bg-white dark:bg-zinc-700 shadow-sm text-primary' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                >
                  Arcade
                </button>
                <button 
                  onClick={() => setView('leaderboard')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${view === 'leaderboard' ? 'bg-white dark:bg-zinc-700 shadow-sm text-primary' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                >
                  Leaderboard
                </button>
              </div>

              {view === 'arcade' && (
                <>
                  {/* Game Catalog */}
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Start a New Game</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Tic Tac Toe Card */}
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => handleCreateGame('tic-tac-toe')}>
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 text-blue-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                          <div className="text-xl font-bold font-mono">X O</div>
                        </div>
                        <h5 className="font-bold text-zinc-900 dark:text-zinc-100 text-lg mb-1">Tic-Tac-Toe</h5>
                        <p className="text-sm text-zinc-500">A classic 2-player game. First to get 3 in a row wins!</p>
                      </div>

                      {/* Rummy 45 Card */}
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => handleCreateGame('rummy-45')}>
                        <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                          <div className="text-xl font-bold font-mono">45</div>
                        </div>
                        <h5 className="font-bold text-zinc-900 dark:text-zinc-100 text-lg mb-1">Rummy 45</h5>
                        <p className="text-sm text-zinc-500">The ultimate family card game. Form runs and sets to win.</p>
                      </div>
                    </div>
                  </div>

                  {/* Active/Past Games */}
                  {activeGames.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                        Games on {selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'this day'}
                      </h4>
                      <div className="flex flex-col gap-3">
                        {activeGames.map((game) => (
                          <div key={game.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500">
                                <Gamepad2 className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="font-bold text-zinc-900 dark:text-zinc-100 capitalize">
                                  {game.gameType.replace(/-/g, ' ')}
                                </p>
                                <p className="text-xs text-zinc-500 flex items-center gap-1">
                                  {game.status === 'finished' ? (
                                    <>Winner: {game.winner ? userMap[game.winner]?.name : 'Draw'}</>
                                  ) : (
                                    <><Clock className="w-3 h-3" /> {game.status === 'waiting' ? 'Waiting for opponent' : 'In Progress'}</>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {game.status === 'waiting' && game.createdBy === auth.currentUser?.uid && (
                                <button 
                                  onClick={(e) => handleCancelGame(game.id, e)}
                                  className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                  title="Cancel Game"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              <button 
                                onClick={() => setPlayingGameId(game.id)}
                                className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                              >
                                {game.status === 'finished' ? 'View' : <><Play className="w-4 h-4" /> Join</>}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {view === 'leaderboard' && (
                <div className="flex flex-col gap-4">
                  <div className="text-center mb-4">
                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">All-Time Leaderboard</h2>
                    <p className="text-sm text-zinc-500">Who rules the arcade in {groupName}?</p>
                  </div>

                  {leaderboard.length === 0 ? (
                    <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                      <p className="text-zinc-500">No games have been completed yet.</p>
                      <p className="text-zinc-400 text-sm mt-1">Start playing to get on the board!</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {leaderboard.map((entry, index) => {
                        const user = userMap[entry.uid] || { name: 'Unknown' };
                        return (
                          <div key={entry.uid} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg
                                ${index === 0 ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-500' : 
                                  index === 1 ? 'bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400' :
                                  index === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-600' :
                                  'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}
                              `}>
                                #{index + 1}
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden">
                                  {user.photoURL ? (
                                    <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-sm font-bold text-zinc-500">{user.name?.charAt(0) || '?'}</span>
                                  )}
                                </div>
                                <p className="font-bold text-zinc-900 dark:text-zinc-100">{user.name}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-primary">{entry.wins}</p>
                              <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Wins</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
