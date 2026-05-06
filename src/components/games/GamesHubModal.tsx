import { useState, useEffect } from 'react';
import { X, Gamepad2, Play, Clock } from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import TicTacToe from './TicTacToe';

interface GamesHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  userMap: Record<string, any>;
}

export default function GamesHubModal({ isOpen, onClose, groupId, groupName, userMap }: GamesHubModalProps) {
  const [activeGames, setActiveGames] = useState<any[]>([]);
  const [playingGameId, setPlayingGameId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !groupId) return;

    const q = query(
      collection(db, 'games'),
      where('groupId', '==', groupId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setActiveGames(games.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
    });

    return () => unsubscribe();
  }, [isOpen, groupId]);

  const handleCreateGame = async (gameType: string) => {
    if (!auth.currentUser) return;
    
    try {
      let initialState = {};
      if (gameType === 'tic-tac-toe') {
        initialState = {
          board: Array(9).fill(null),
          xIsNext: true,
          players: { X: auth.currentUser.uid, O: null }
        };
      }

      const docRef = await addDoc(collection(db, 'games'), {
        groupId,
        gameType,
        status: 'waiting', // waiting, playing, finished
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
        state: initialState,
        winner: null
      });

      setPlayingGameId(docRef.id);
    } catch (error) {
      console.error("Error creating game:", error);
    }
  };

  if (!isOpen) return null;

  const activeGame = activeGames.find(g => g.id === playingGameId);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col h-[80vh] overflow-hidden border border-zinc-200 dark:border-zinc-800 relative">
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
            </div>
          ) : (
            <div className="flex flex-col gap-8">
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

                  {/* Rummy 45 Card (Coming Soon) */}
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 opacity-70 relative overflow-hidden">
                    <div className="absolute top-3 right-3 bg-zinc-200 dark:bg-zinc-800 text-xs px-2 py-1 rounded font-semibold text-zinc-600 dark:text-zinc-400">
                      Coming Soon
                    </div>
                    <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center mb-3">
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
                  <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Ongoing & Past Games</h4>
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
                        <button 
                          onClick={() => setPlayingGameId(game.id)}
                          className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors"
                        >
                          {game.status === 'finished' ? 'View' : <><Play className="w-4 h-4" /> Join</>}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
