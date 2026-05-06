import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { ArrowLeft } from 'lucide-react';

interface TicTacToeProps {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

export default function TicTacToe({ game, userMap, onBack }: TicTacToeProps) {
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

    if (winnerData) {
      newStatus = 'finished';
      winner = game.state.players[winnerData.winner];
    } else if (!newBoard.includes(null)) {
      newStatus = 'finished'; // Draw
    }

    await updateDoc(doc(db, 'games', game.id), {
      'state.board': newBoard,
      'state.xIsNext': !game.state.xIsNext,
      status: newStatus,
      winner: winner
    });
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
        <ArrowLeft className="w-4 h-4" /> Back to Arcade
      </button>

      {/* Players */}
      <div className="flex justify-between items-center w-full max-w-sm mb-8 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        <div className={`flex flex-col items-center ${game.state.xIsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="text-2xl font-bold text-blue-500 mb-1">X</div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.X ? userMap[game.state.players.X]?.name : 'Waiting...'}
          </div>
        </div>
        
        <div className="text-sm font-bold text-zinc-300 dark:text-zinc-700">VS</div>

        <div className={`flex flex-col items-center ${!game.state.xIsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="text-2xl font-bold text-red-500 mb-1">O</div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.O ? userMap[game.state.players.O]?.name : 'Waiting...'}
          </div>
        </div>
      </div>

      {/* Game Status Message */}
      <div className="mb-6 h-8 flex items-center justify-center">
        {game.status === 'waiting' && mySymbol === 'X' && (
          <p className="text-zinc-500 font-medium animate-pulse">Waiting for an opponent to join...</p>
        )}
        {game.status === 'waiting' && !mySymbol && (
          <button onClick={handleJoin} className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-full font-bold shadow-md hover:shadow-lg transition-all">
            Join Game as O
          </button>
        )}
        {game.status === 'playing' && (
          <p className={`font-bold text-lg ${isMyTurn() ? 'text-primary' : 'text-zinc-500'}`}>
            {isMyTurn() ? "It's your turn!" : "Waiting for opponent..."}
          </p>
        )}
        {game.status === 'finished' && (
          <p className="font-bold text-xl text-emerald-500">
            {game.winner ? `${userMap[game.winner]?.name} Wins!` : "It's a Draw!"}
          </p>
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
                <span className={`transform transition-transform ${cell ? 'scale-100' : 'scale-0'} 
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
