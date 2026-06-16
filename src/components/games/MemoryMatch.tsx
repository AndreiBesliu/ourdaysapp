import { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import {
  ArrowLeft, Trophy, Clock, Footprints, Flame,
  Gamepad2, Rocket, Star, Heart, Zap, Camera, Music,
  Cat, Dog, Bird, Fish, Rabbit, Turtle, Snail, Bug,
  Apple, Cherry, Carrot, Pizza, Cake, Coffee, Egg, Cookie,
  Plane, Car, Ship, Train, Bike, Anchor, Tent, Compass,
  Sun, Moon, Cloud, Umbrella, Snowflake, Droplet, Wind, Rainbow,
} from 'lucide-react';
import { playTone } from '../../utils/sounds';
import { triggerHaptic } from '../../utils/haptics';
import { useThemeStore } from '../../store';
import { t } from '../../utils/i18n';
import { finalizeGameUpdate } from './gameResult';
import { buildMemoryBoard, DEFAULT_THEME, THEME_PACKS } from './memoryThemes';

interface MemoryMatchProps {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

// All icons used across every theme pack, resolved by name from the stored board.
const ICON_COMPONENTS: Record<string, React.ComponentType<{ className?: string }>> = {
  Gamepad2, Rocket, Star, Heart, Flame, Zap, Camera, Music,
  Cat, Dog, Bird, Fish, Rabbit, Turtle, Snail, Bug,
  Apple, Cherry, Carrot, Pizza, Cake, Coffee, Egg, Cookie,
  Plane, Car, Ship, Train, Bike, Anchor, Tent, Compass,
  Sun, Moon, Cloud, Umbrella, Snowflake, Droplet, Wind, Rainbow,
};

const renderIcon = (name: string) => {
  const Icon = ICON_COMPONENTS[name] || Gamepad2;
  return <Icon className="w-8 h-8 sm:w-10 sm:h-10" />;
};

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function MemoryMatch({ game, userMap, onBack }: MemoryMatchProps) {
  const { language } = useThemeStore();
  const [processing, setProcessing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick the elapsed-time display once a second while the game is in progress.
  useEffect(() => {
    if (game.status !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [game.status]);

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
      'state.startedAt': Date.now(), // start the clock when the 2nd player joins
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
      const newBoard = board.map((c: any) => ({ ...c }));
      let newScores = { ...scores };
      const currentPlayerKey = p1IsNext ? 'P1' : 'P2';
      let nextTurn = p1IsNext;
      let newStatus = 'playing';
      let winner: string | null = null;
      let newStreak = game.state.streak || 0;
      const updates: any = {};

      if (isMatch) {
        newBoard[idx1].isMatched = true;
        newBoard[idx2].isMatched = true;

        // Streak bonus: each consecutive match in your turn is worth one more
        // point than the last (1, 2, 3, …). A miss resets the streak.
        newStreak = newStreak + 1;
        newScores[currentPlayerKey] += newStreak;

        playTone('meld');
        triggerHaptic('success');

        // Game over when every card is matched (scores now carry streak bonuses,
        // so we can't infer the end from the score total).
        if (newBoard.every((c: any) => c.isMatched)) {
          newStatus = 'finished';
          if (newScores.P1 > newScores.P2) winner = players.P1;
          else if (newScores.P2 > newScores.P1) winner = players.P2;
          else winner = null; // draw
          updates['state.finishedAt'] = Date.now();

          if (winner === auth.currentUser?.uid) {
            playTone('success');
          } else {
            playTone('error');
          }
        }
      } else {
        // No match: switch turns and reset the streak
        nextTurn = !p1IsNext;
        newStreak = 0;
        playTone('error');
        triggerHaptic('medium');
      }

      await updateDoc(doc(db, 'games', game.id), {
        ...updates,
        'state.board': newBoard,
        'state.flippedIndices': [],
        'state.p1IsNext': nextTurn,
        'state.scores': newScores,
        'state.streak': newStreak,
        'state.moves': (game.state.moves || 0) + 1,
        status: newStatus,
        winner: winner
      });

      setProcessing(false);
    }, 1200);
  };

  const handleNextRound = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'games', game.id), {
      'state.board': buildMemoryBoard(game.state.theme || DEFAULT_THEME),
      'state.flippedIndices': [],
      'state.scores': { P1: 0, P2: 0 },
      'state.moves': 0,
      'state.streak': 0,
      'state.startedAt': Date.now(),
      'state.finishedAt': null,
      status: 'playing',
      winner: null
    });
    playTone('success');
  };

  const handleEndGame = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'games', game.id), finalizeGameUpdate(game));
  };

  const { players, p1IsNext, board, flippedIndices, scores } = game.state;
  const p1 = userMap[players.P1];
  const p2 = players.P2 ? userMap[players.P2] : null;

  const moves = game.state.moves || 0;
  const streak = game.state.streak || 0;
  const startedAt = game.state.startedAt;
  // Elapsed ticks live while playing; freezes at finishedAt once the game ends.
  const elapsedMs = startedAt ? (game.state.finishedAt || now) - startedAt : 0;

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between shrink-0">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center leading-tight">
          <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{t('gameMemoryMatch', language)}</h2>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">
            {t(THEME_PACKS[game.state.theme || DEFAULT_THEME]?.labelKey || 'memThemeClassic', language)}
          </span>
        </div>
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
              <span className="text-[10px] font-bold uppercase text-zinc-500 block">{p1?.name?.split(' ')[0] || t('player1', language)}</span>
              <span className="text-lg font-bold text-primary">{scores?.P1 || 0}</span>
            </div>
          </div>

          <span className="text-xl font-black text-zinc-300 dark:text-zinc-700 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{t('vs', language)}</span>

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
                  <span className="text-[10px] font-bold uppercase text-zinc-500 block">{p2?.name?.split(' ')[0] || t('player2', language)}</span>
                  <span className="text-lg font-bold text-red-500">{scores?.P2 || 0}</span>
                </div>
              </>
            ) : (
              <div className="w-20 flex flex-col items-center justify-center">
                <button
                  onClick={handleJoin}
                  className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-full hover:bg-primary/90 transition-all shadow-md active:scale-95"
                >
                  {t('joinGame', language)}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats bar: time / moves / current streak */}
        {players.P2 && (
          <div className="w-full max-w-sm flex items-center justify-center gap-5 mb-6">
            <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-bold tabular-nums">{formatTime(elapsedMs)}</span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400 hidden sm:inline">{t('timeLabel', language)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <Footprints className="w-4 h-4" />
              <span className="text-sm font-bold tabular-nums">{moves}</span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400 hidden sm:inline">{t('movesLabel', language)}</span>
            </div>
            {streak >= 2 && game.status === 'playing' && (
              <div className="flex items-center gap-1 text-amber-500 font-bold animate-in fade-in">
                <Flame className="w-4 h-4" />
                <span className="text-sm tabular-nums">×{streak}</span>
              </div>
            )}
          </div>
        )}

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
                    {renderIcon(card.iconName)}
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
                userMap[game.winner]?.uid === auth.currentUser?.uid ? t('youWon', language) : `${userMap[game.winner]?.name?.split(' ')[0]} ${t('wonSuffix', language)}`
              ) : t('itsADraw', language)}
            </h3>
            <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {formatTime(elapsedMs)}</span>
              <span className="flex items-center gap-1.5"><Footprints className="w-4 h-4" /> {moves} {t('movesLabel', language)}</span>
            </div>
            {game.finalized ? (
              <span className="mt-4 text-sm font-bold text-zinc-400 flex items-center gap-1">🏁 {t('gameEnded', language)}</span>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={handleNextRound}
                  className="px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
                >
                  {t('playAgain', language)}
                </button>
                <button
                  onClick={handleEndGame}
                  className="px-6 py-3 bg-red-500/90 hover:bg-red-600 text-white font-bold rounded-xl transition-all"
                >
                  {t('endGame', language)}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
