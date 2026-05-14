import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { ArrowLeft } from 'lucide-react';
import { playTone } from '../../utils/sounds';
import { triggerHaptic } from '../../utils/haptics';

interface Connect4Props {
  game: any;
  userMap: Record<string, any>;
  onBack: () => void;
}

const ROWS = 6;
const COLS = 7;

export default function Connect4({ game, userMap, onBack }: Connect4Props) {
  const isMyTurn = () => {
    if (game.status === 'finished') return false;
    const { p1IsNext, players } = game.state;
    if (p1IsNext && players.P1 === auth.currentUser?.uid) return true;
    if (!p1IsNext && players.P2 === auth.currentUser?.uid) return true;
    return false;
  };

  const handleJoin = async () => {
    if (!auth.currentUser) return;
    if (game.state.players.P2 || game.state.players.P1 === auth.currentUser.uid) return;
    
    // Join as player 2
    await updateDoc(doc(db, 'games', game.id), {
      'state.players.P2': auth.currentUser.uid,
      status: 'playing'
    });
  };

  const handleClick = async (colIndex: number) => {
    if (!isMyTurn() || game.status !== 'playing' || !auth.currentUser) return;

    const newBoard = JSON.parse(JSON.stringify(game.state.board));
    
    // Find lowest empty slot in the column
    let rowIndex = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!newBoard[r][colIndex]) {
        rowIndex = r;
        break;
      }
    }

    if (rowIndex === -1) return; // Column is full

    const mySymbol = game.state.players.P1 === auth.currentUser.uid ? 'P1' : 'P2';
    newBoard[rowIndex][colIndex] = mySymbol;

    const winnerData = calculateWinner(newBoard);
    let newStatus = game.status;
    let winner = game.winner;

    let newScores = game.state.scores || { P1: 0, P2: 0 };
    
    // Check for draw
    let isDraw = false;
    if (!winnerData) {
      isDraw = true;
      for (let c = 0; c < COLS; c++) {
        if (!newBoard[0][c]) {
          isDraw = false;
          break;
        }
      }
    }

    if (winnerData && winnerData.winner) {
      newStatus = 'finished';
      winner = game.state.players[winnerData.winner];
      const winnerKey = winnerData.winner as 'P1' | 'P2';
      newScores = { ...newScores, [winnerKey]: (newScores[winnerKey] || 0) + 1 };
    } else if (isDraw) {
      newStatus = 'finished';
    }

    await updateDoc(doc(db, 'games', game.id), {
      'state.board': newBoard,
      'state.p1IsNext': !game.state.p1IsNext,
      'state.scores': newScores,
      'state.winningCells': winnerData ? winnerData.cells : null,
      status: newStatus,
      winner: winner
    });

    if (newStatus === 'finished') {
      if (winner === auth.currentUser.uid) {
        playTone('success');
        triggerHaptic('success');
      } else {
        playTone('error');
        triggerHaptic('heavy');
      }
    } else {
      playTone('click');
      triggerHaptic('light');
    }
  };

  const handleNextRound = async () => {
    if (!auth.currentUser) return;
    const emptyBoard = {
      0: Array(COLS).fill(null),
      1: Array(COLS).fill(null),
      2: Array(COLS).fill(null),
      3: Array(COLS).fill(null),
      4: Array(COLS).fill(null),
      5: Array(COLS).fill(null)
    };
    await updateDoc(doc(db, 'games', game.id), {
      'state.board': emptyBoard,
      'state.winningCells': null,
      status: 'playing',
      winner: null
    });
  };

  const calculateWinner = (board: (string | null)[][]) => {
    // Horizontal
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 3; c++) {
        if (board[r][c] && board[r][c] === board[r][c+1] && board[r][c] === board[r][c+2] && board[r][c] === board[r][c+3]) {
          return { winner: board[r][c], cells: [[r, c], [r, c+1], [r, c+2], [r, c+3]] };
        }
      }
    }
    // Vertical
    for (let r = 0; r < ROWS - 3; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] && board[r][c] === board[r+1][c] && board[r][c] === board[r+2][c] && board[r][c] === board[r+3][c]) {
          return { winner: board[r][c], cells: [[r, c], [r+1, c], [r+2, c], [r+3, c]] };
        }
      }
    }
    // Diagonal right-down
    for (let r = 0; r < ROWS - 3; r++) {
      for (let c = 0; c < COLS - 3; c++) {
        if (board[r][c] && board[r][c] === board[r+1][c+1] && board[r][c] === board[r+2][c+2] && board[r][c] === board[r+3][c+3]) {
          return { winner: board[r][c], cells: [[r, c], [r+1, c+1], [r+2, c+2], [r+3, c+3]] };
        }
      }
    }
    // Diagonal right-up
    for (let r = 3; r < ROWS; r++) {
      for (let c = 0; c < COLS - 3; c++) {
        if (board[r][c] && board[r][c] === board[r-1][c+1] && board[r][c] === board[r-2][c+2] && board[r][c] === board[r-3][c+3]) {
          return { winner: board[r][c], cells: [[r, c], [r-1, c+1], [r-2, c+2], [r-3, c+3]] };
        }
      }
    }
    return null;
  };

  const mySymbol = auth.currentUser ? (game.state.players.P1 === auth.currentUser.uid ? 'P1' : (game.state.players.P2 === auth.currentUser.uid ? 'P2' : null)) : null;
  const isWinningCell = (r: number, c: number) => {
    if (!game.state.winningCells) return false;
    return game.state.winningCells.some((cell: [number, number]) => cell[0] === r && cell[1] === c);
  };

  return (
    <div className="flex flex-col items-center flex-1 py-4">
      <button onClick={onBack} className="self-start mb-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Arcade
      </button>

      {/* Players */}
      <div className="flex justify-between items-center w-full max-w-sm mb-8 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        <div className={`flex flex-col items-center ${game.state.p1IsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="w-6 h-6 rounded-full bg-red-500 mb-2 shadow-inner border border-red-600"></div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.P1 ? userMap[game.state.players.P1]?.name : 'Waiting...'}
          </div>
          <div className="text-xs font-bold text-zinc-500 mt-1">Score: {game.state.scores?.P1 || 0}</div>
        </div>
        
        <div className="text-sm font-bold text-zinc-300 dark:text-zinc-700">VS</div>

        <div className={`flex flex-col items-center ${!game.state.p1IsNext && game.status !== 'finished' ? 'opacity-100 scale-110' : 'opacity-50'} transition-all`}>
          <div className="w-6 h-6 rounded-full bg-yellow-400 mb-2 shadow-inner border border-yellow-500"></div>
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {game.state.players.P2 ? userMap[game.state.players.P2]?.name : 'Waiting...'}
          </div>
          <div className="text-xs font-bold text-zinc-500 mt-1">Score: {game.state.scores?.P2 || 0}</div>
        </div>
      </div>

      {/* Game Status Message */}
      <div className="mb-6 h-8 flex items-center justify-center">
        {game.status === 'waiting' && mySymbol === 'P1' && (
          <p className="text-zinc-500 font-medium animate-pulse">Waiting for an opponent to join...</p>
        )}
        {game.status === 'waiting' && !mySymbol && (
          <button onClick={handleJoin} className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-full font-bold shadow-md hover:shadow-lg transition-all">
            Join Game as P2
          </button>
        )}
        {game.status === 'playing' && (
          <p className={`font-bold text-lg ${isMyTurn() ? 'text-primary' : 'text-zinc-500'}`}>
            {isMyTurn() ? "It's your turn!" : "Waiting for opponent..."}
          </p>
        )}
        {game.status === 'finished' && (
          <div className="flex items-center gap-4">
            <p className="font-bold text-xl text-emerald-500">
              {game.winner ? `${userMap[game.winner]?.name} Wins!` : "It's a Draw!"}
            </p>
            <button onClick={handleNextRound} className="px-4 py-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full text-sm font-bold transition-colors">
              Next Round
            </button>
          </div>
        )}
      </div>

      {/* Board Container */}
      <div className="bg-blue-600 p-2 sm:p-4 rounded-xl shadow-xl border-b-8 border-blue-800 max-w-full overflow-x-auto">
        <div className="flex gap-2">
          {Array(COLS).fill(0).map((_, c) => (
            <div 
              key={`col-${c}`} 
              className="flex flex-col gap-2 cursor-pointer group relative"
              onClick={() => handleClick(c)}
            >
              {/* Hover indicator */}
              <div className={`absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full transition-opacity
                ${isMyTurn() && game.status === 'playing' ? 'group-hover:opacity-100 opacity-0' : 'opacity-0'}
                ${game.state.p1IsNext ? 'bg-red-500' : 'bg-yellow-400'}
              `} />
              
              {Array(ROWS).fill(0).map((_, r) => {
                const cell = game.state.board[r][c];
                const winning = isWinningCell(r, c);
                return (
                  <div 
                    key={`cell-${r}-${c}`}
                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-300
                      ${!cell ? 'bg-zinc-900 shadow-inner border-2 border-blue-800/30' : ''}
                      ${cell === 'P1' ? 'bg-red-500 shadow-[inset_0_-4px_0_rgba(0,0,0,0.2)]' : ''}
                      ${cell === 'P2' ? 'bg-yellow-400 shadow-[inset_0_-4px_0_rgba(0,0,0,0.2)]' : ''}
                      ${winning ? 'ring-4 ring-white animate-pulse' : ''}
                    `}
                  >
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
