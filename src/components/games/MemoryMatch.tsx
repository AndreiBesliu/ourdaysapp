import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { ArrowLeft, Gamepad2, Rocket, Star, Heart, Flame, Zap, Camera, Music, Trophy } from 'lucide-react';
import { playTone } from '../../utils/sounds';
import { triggerHaptic } from '../../utils/haptics';

interface MemoryMatchProps {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Gamepad2: <Gamepad2 className="w-8 h-8 sm:w-10 sm:h-10" />,
  Rocket: <Rocket className="w-8 h-8 sm:w-10 sm:h-10" />,
  Star: <Star className="w-8 h-8 sm:w-10 sm:h-10" />,
  Heart: <Heart className="w-8 h-8 sm:w-10 sm:h-10" />,
  Flame: <Flame className="w-8 h-8 sm:w-10 sm:h-10" />,
  Zap: <Zap className="w-8 h-8 sm:w-10 sm:h-10" />,
  Camera: <Camera className="w-8 h-8 sm:w-10 sm:h-10" />,
  Music: <Music className="w-8 h-8 sm:w-10 sm:h-10" />
};

export const ICONS_LIST = Object.keys(ICON_MAP);

export default function MemoryMatch({ game, userMap, onBack }: MemoryMatchProps) {
  const [processing, setProcessing] = useState(false);

  const isMyTurn = () => {
    if (game.status === 'finished') return false;
    const { p1IsNext, players } = game.state;
    if (p1IsNext && players.P1 === auth.currentUser?.uid) return true;
    if (!p1IsNext && players.P2 === auth.currentUser?.uid) return true;
    return false;
  };

  const handleJoin = async () => {
    if (!auth.currentUser || game.state.players.P2) return;
    await updateDoc(doc(db, 'games', game.id), {
      'state.players.P2': auth.currentUser.uid,
      status: 'playing'
    });
  };

  const handleCardClick = async (index: number) => {
    if (!isMyTurn() || game.status !== 'playing' || !auth.currentUser || processing) return;
    const { board, flippedIndices, p1IsNext, players, scores } = game.state;

    // Invalid clicks
    if (board[index].isMatched || flippedIndices.includes(index) || flippedIndices.length >= 2) return;

    setProcessing(true);
    playTone('flip');
    triggerHaptic('light');

    const newFlipped = [...flippedIndices, index];
    
    // First card flip
    if (newFlipped.length === 1) {
      await updateDoc(doc(db, 'games', game.id), {
        'state.flippedIndices': newFlipped
      });
      setProcessing(false);
      return;
    }

    // Second card flip
    const idx1 = newFlipped[0];
    const idx2 = newFlipped[1];
    const isMatch = board[idx1].iconName === board[idx2].iconName;

    // Show the flip to the user temporarily before evaluating
    await updateDoc(doc(db, 'games', game.id), {
      'state.flippedIndices': newFlipped
    });

    setTimeout(async () => {
      const newBoard = [...board];
      let newScores = { ...scores };
      let nextTurn = p1IsNext;
      let newStatus = 'playing';
      let winner = null;

      if (isMatch) {
        newBoard[idx1].isMatched = true;
        newBoard[idx2].isMatched = true;
        
        const currentPlayerKey = p1IsNext ? 'P1' : 'P2';
        newScores[currentPlayerKey] += 1;
        
        playTone('meld');
        triggerHaptic('success');

        // Check if game is over
        if (newScores.P1 + newScores.P2 === 8) {
          newStatus = 'finished';
          if (newScores.P1 > newScores.P2) winner = players.P1;
          else if (newScores.P2 > newScores.P1) winner = players.P2;
          else winner = 'draw'; // draw
          
          if (winner === auth.currentUser?.uid) {
            playTone('success');
          } else {
            playTone('error');
          }
        }
      } else {
        // No match, switch turns
        nextTurn = !p1IsNext;
        playTone('error');
        triggerHaptic('medium');
      }

      await updateDoc(doc(db, 'games', game.id), {
        'state.board': newBoard,
        'state.flippedIndices': [],
        'state.p1IsNext': nextTurn,
        'state.scores': newScores,
        status: newStatus,
        winner: winner === 'draw' ? null : winner // We handle draw by just keeping winner null if finished
      });
      
      setProcessing(false);
    }, 1200);
  };

  // Helper to shuffle cards for next round
  const generateBoard = () => {
    const icons = [...ICONS_LIST, ...ICONS_LIST];
    // Fisher-Yates shuffle
    for (let i = icons.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [icons[i], icons[j]] = [icons[j], icons[i]];
    }
    return icons.map((icon, idx) => ({ id: idx, iconName: icon, isMatched: false }));
  };

  const handleNextRound = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'games', game.id), {
      'state.board': generateBoard(),
      'state.flippedIndices': [],
      'state.scores': { P1: 0, P2: 0 },
      status: 'playing',
      winner: null
    });
    playTone('success');
  };

  const { players, p1IsNext, board, flippedIndices, scores } = game.state;
  const p1 = userMap[players.P1];
  const p2 = players.P2 ? userMap[players.P2] : null;

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">Memory Match</h2>
        <div className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center">
        
        {/* Players Scoreboard */}
        <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm border border-zinc-200 dark:border-zinc-800 mb-8 flex justify-between items-center relative">
          {/* P1 */}
          <div className={`flex flex-col items-center gap-2 p-2 rounded-xl transition-colors ${p1IsNext && game.status === 'playing' ? 'bg-primary/10 ring-2 ring-primary/50' : 'opacity-50'}`}>
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden border-2 border-primary shrink-0">
              {p1?.photoURL ? (
                <img src={p1.photoURL} alt="P1" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-bold text-zinc-500">
                  {p1?.name?.[0] || '?'}
                </div>
              )}
            </div>
            <div className="text-center">
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">{p1?.name?.split(' ')[0] || 'Player 1'}</span>
              <span className="text-lg font-bold text-primary">{scores?.P1 || 0}</span>
            </div>
          </div>

          <span className="text-xl font-black text-zinc-300 dark:text-zinc-700 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">VS</span>

          {/* P2 */}
          <div className={`flex flex-col items-center gap-2 p-2 rounded-xl transition-colors ${!p1IsNext && game.status === 'playing' ? 'bg-red-500/10 ring-2 ring-red-500/50' : 'opacity-50'}`}>
            {players.P2 ? (
              <>
                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden border-2 border-red-500 shrink-0">
                  {p2?.photoURL ? (
                    <img src={p2.photoURL} alt="P2" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-zinc-500">
                      {p2?.name?.[0] || '?'}
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <span className="text-[10px] font-bold uppercase text-zinc-500 block">{p2?.name?.split(' ')[0] || 'Player 2'}</span>
                  <span className="text-lg font-bold text-red-500">{scores?.P2 || 0}</span>
                </div>
              </>
            ) : (
              <div className="w-20 flex flex-col items-center justify-center">
                <button
                  onClick={handleJoin}
                  className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-full hover:bg-primary/90 transition-all shadow-md active:scale-95"
                >
                  Join Game
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Board */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3 w-full max-w-sm">
          {board?.map((card: any, idx: number) => {
            const isFlipped = flippedIndices.includes(idx) || card.isMatched;
            return (
              <button
                key={idx}
                onClick={() => handleCardClick(idx)}
                disabled={isFlipped || game.status !== 'playing' || !players.P2}
                className="relative w-full aspect-square perspective-1000"
              >
                <div className={`w-full h-full transition-all duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                  {/* Front (Hidden) */}
                  <div className="absolute inset-0 backface-hidden bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl shadow-sm hover:border-primary/50 dark:hover:border-primary/50 transition-colors flex items-center justify-center">
                    <div className="w-1/3 h-1/3 bg-zinc-100 dark:bg-zinc-700 rounded-full" />
                  </div>
                  
                  {/* Back (Revealed) */}
                  <div className={`absolute inset-0 backface-hidden rotate-y-180 rounded-xl shadow-md flex items-center justify-center ${card.isMatched ? 'bg-green-100 dark:bg-green-900/40 border-2 border-green-500 text-green-600 dark:text-green-400 opacity-50' : 'bg-primary/10 border-2 border-primary text-primary'}`}>
                    {ICON_MAP[card.iconName]}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Game Over Screen */}
        {game.status === 'finished' && (
          <div className="mt-8 flex flex-col items-center animate-in slide-in-from-bottom-4 fade-in duration-500">
            <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500 rounded-full flex items-center justify-center mb-4">
              <Trophy className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">
              {game.winner ? (
                userMap[game.winner]?.uid === auth.currentUser?.uid ? 'You Won!' : `${userMap[game.winner]?.name?.split(' ')[0]} Won!`
              ) : 'It\'s a Draw!'}
            </h3>
            <button
              onClick={handleNextRound}
              className="mt-4 px-8 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
            >
              Play Again
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
