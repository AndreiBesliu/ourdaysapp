import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { ArrowLeft } from 'lucide-react';
import { useThemeStore } from '../../store';
import { t } from '../../utils/i18n';
import { finalizeGameUpdate } from './gameResult';

interface TicTacToeProps {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

export default function TicTacToe({ game, userMap, onBack }: TicTacToeProps) {
  const { language } = useThemeStore();
  const isMyTurn = () => {
    if (game.status === 'finished') return false;
    const { xIsNext, players } = game.state;
    if (xIsNext && players.X === auth.currentUser?.uid) return true;
    if (!xIsNext && players.O === auth.currentUser?.uid) return true;
    return false;
  };

  const handleJoin = async () => {
    if (!auth.currentUser) return;
    if (game.state.players.O || game.state.players.X === auth.currentUser.uid) return;
    
    // Join as player O
    await updateDoc(doc(db, 'games', game.id), {
      'state.players.O': auth.currentUser.uid,
      status: 'playing'
    });
  };

  const handleClick = async (i: number) => {
    if (!isMyTurn() || game.status !== 'playing' || !auth.currentUser) return;
    if (game.state.board[i]) return; // Cell already filled

    const newBoard = [...game.state.board];
    const mySymbol = game.state.players.X === auth.currentUser.uid ? 'X' : 'O';
    newBoard[i] = mySymbol;

    const winnerData = calculateWinner(newBoard);
    let newStatus = game.status;
    let winner = game.winner;

    let newScores = game.state.scores || { X: 0, O: 0 };
    if (winnerData) {
      newStatus = 'finished';
      winner = game.state.players[winnerData.winner];
      newScores = { ...newScores, [winnerData.winner]: (newScores[winnerData.winner as 'X' | 'O'] || 0) + 1 };
    } else if (!newBoard.includes(null)) {
      newStatus = 'finished'; // Draw
    }

    await updateDoc(doc(db, 'games', game.id), {
      'state.board': newBoard,
      'state.xIsNext': !game.state.xIsNext,
      'state.scores': newScores,
      status: newStatus,
      winner: winner
    });
  };

  const handleNextRound = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'games', game.id), {
      'state.board': Array(9).fill(null),
      status: 'playing',
      winner: null
    });
  };

  const handleEndGame = async () => {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'games', game.id), finalizeGameUpdate(game));
  };

  const calculateWinner = (squares: (string | null)[]) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diags
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { winner: squares[a], line: lines[i] };
      }
    }
    return null;
  };

  const winData = calculateWinner(game.state.board);
  const mySymbol = auth.currentUser ? (game.state.players.X === auth.currentUser.uid ? 'X' : (game.state.players.O === auth.currentUser.uid ? 'O' : null)) : null;

  return (
    <div className="flex flex-col items-center flex-1 py-4">
      <button onClick={onBack} className="self-start mb-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" /> {t('backToArcade', language)}
      </button>

      {/* Players */}
      <div className="flex justify-between items-center w-full max-w-sm mb-8 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        <div className={`flex flex-col items-center ${game.state.xIsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="text-2xl font-bold text-blue-500 mb-1">X</div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.X ? userMap[game.state.players.X]?.name : t('waitingEllipsis', language)}
          </div>
          <div className="text-xs font-bold text-zinc-500 mt-1">{t('score', language)}: {game.state.scores?.X || 0}</div>
        </div>
        
        <div className="text-sm font-bold text-zinc-300 dark:text-zinc-700">{t('vs', language)}</div>

        <div className={`flex flex-col items-center ${!game.state.xIsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="text-2xl font-bold text-red-500 mb-1">O</div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.O ? userMap[game.state.players.O]?.name : t('waitingEllipsis', language)}
          </div>
          <div className="text-xs font-bold text-zinc-500 mt-1">{t('score', language)}: {game.state.scores?.O || 0}</div>
        </div>
      </div>

      {/* Game Status Message */}
      <div className="mb-6 h-8 flex items-center justify-center">
        {game.status === 'waiting' && mySymbol === 'X' && (
          <p className="text-zinc-500 font-medium animate-pulse">{t('waitingForOpponentJoin', language)}</p>
        )}
        {game.status === 'waiting' && !mySymbol && (
          <button onClick={handleJoin} className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-full font-bold shadow-md hover:shadow-lg transition-all">
            {t('joinGameAs', language)} O
          </button>
        )}
        {game.status === 'playing' && (
          <p className={`font-bold text-lg ${isMyTurn() ? 'text-primary' : 'text-zinc-500'}`}>
            {isMyTurn() ? t('yourTurn', language) : t('waitingForOpponent', language)}
          </p>
        )}
        {game.status === 'finished' && (
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <p className="font-bold text-xl text-emerald-500">
              {game.winner ? `${userMap[game.winner]?.name} ${t('winsSuffix', language)}` : t('itsADraw', language)}
            </p>
            {game.finalized ? (
              <span className="text-xs font-bold text-zinc-400 flex items-center gap-1">🏁 {t('gameEnded', language)}</span>
            ) : (
              <>
                <button onClick={handleNextRound} className="px-4 py-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full text-sm font-bold transition-colors">
                  {t('nextRound', language)}
                </button>
                <button onClick={handleEndGame} className="px-4 py-1.5 bg-red-500/90 hover:bg-red-600 text-white rounded-full text-sm font-bold transition-colors">
                  {t('endGame', language)}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Board */}
      <div className="bg-white dark:bg-zinc-800 p-2 sm:p-4 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-700">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {game.state.board.map((cell: string | null, idx: number) => {
            const isWinningCell = winData?.line.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => handleClick(idx)}
                disabled={game.status !== 'playing' || !isMyTurn() || cell !== null}
                className={`w-20 h-20 sm:w-24 sm:h-24 rounded-xl flex items-center justify-center text-4xl sm:text-5xl font-bold font-mono transition-all
                  ${!cell && isMyTurn() && game.status === 'playing' ? 'hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer' : ''}
                  ${!cell && (!isMyTurn() || game.status !== 'playing') ? 'cursor-default' : ''}
                  ${cell ? 'bg-zinc-50 dark:bg-zinc-900 cursor-default shadow-inner' : 'bg-zinc-50 dark:bg-zinc-900'}
                  ${isWinningCell ? 'bg-emerald-100 dark:bg-emerald-500/20 shadow-none' : ''}
                `}
              >
                <span className={`transform transition-all ${cell ? 'scale-100' : 'scale-0'} 
                  ${cell === 'X' ? 'text-blue-500' : 'text-red-500'}
                  ${isWinningCell ? 'text-emerald-500' : ''}
                `}>
                  {cell}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
