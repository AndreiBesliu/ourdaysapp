import { useState, useEffect } from 'react';
import { X, Gamepad2, Play, Clock, Trash2, Info } from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import TicTacToe from './TicTacToe';
import Connect4 from './Connect4';
import RummyGame from './rummy/RummyGame';
import { format } from 'date-fns';
import { useThemeStore } from '../../store';

interface GamesHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  userMap: Record<string, any>;
  selectedDate: Date | null;
}

const getGameRules = (lang: string = 'en-US'): Record<string, { title: string, rules: string[] }> => {
  const translations: Record<string, Record<string, { title: string, rules: string[] }>> = {
    'en-US': {
      'tic-tac-toe': {
        title: 'Tic-Tac-Toe',
        rules: [
          'The game is played on a grid that is 3 squares by 3 squares.',
          'You are X, your friend is O. Players take turns putting their marks in empty squares.',
          'The first player to get 3 of their marks in a row (up, down, across, or diagonally) is the winner.',
          'When all 9 squares are full, the game is over. If no player has 3 marks in a row, the game ends in a tie.'
        ]
      },
      'connect-4': {
        title: 'Connect 4',
        rules: [
          'The game is played on a vertical board with 7 columns and 6 rows.',
          'Players take turns dropping their colored discs from the top into a column.',
          'The disc will fall straight down, occupying the lowest available space within the column.',
          'The objective of the game is to be the first to form a horizontal, vertical, or diagonal line of four of your own discs.'
        ]
      },
      'rummy-45': {
        title: 'Rummy 45',
        rules: [
          'The goal is to meld all your cards into sets (same value, different suits) or runs (consecutive cards in the same suit).',
          'On your turn, you must draw a card from the deck or the discard pile.',
          'To play your first melds to the board, their combined value must be at least 45 points AND must include at least one run.',
          'Card values: 2-9 are 5 pts, 10-K are 10 pts, Aces are 25 pts, Jokers are 50 pts.',
          'After your initial 45pt meld, you can attach cards to any existing meld on the board.',
          'You can swap a Joker from the board if you have the exact card the Joker represents.',
          'To win the round (Inchidere), you must meld all your cards EXCEPT one, which must be discarded.'
        ]
      }
    },
    'ro-RO': {
      'tic-tac-toe': {
        title: 'X și 0',
        rules: [
          'Jocul se joacă pe o grilă de 3x3.',
          'Tu ești X, oponentul tău este O. Jucătorii își pun pe rând semnele în pătratele goale.',
          'Primul jucător care aliniază 3 semne (orizontal, vertical sau diagonal) câștigă.',
          'Când toate cele 9 pătrate sunt pline, jocul se termină. Dacă niciun jucător nu are 3 semne la rând, este remiză.'
        ]
      },
      'connect-4': {
        title: 'Conectează 4',
        rules: [
          'Jocul se desfășoară pe o tablă verticală cu 7 coloane și 6 rânduri.',
          'Jucătorii introduc pe rând discuri colorate prin partea de sus a unei coloane.',
          'Discul va cădea drept în jos, ocupând cel mai de jos spațiu disponibil.',
          'Obiectivul este de a fi primul care formează o linie orizontală, verticală sau diagonală din patru discuri.'
        ]
      },
      'rummy-45': {
        title: 'Remi 45',
        rules: [
          'Scopul este de a etala toate cărțile în suite (valori identice, culori diferite) sau terțe (cărți consecutive de aceeași culoare).',
          'La rândul tău, trebuie să tragi o carte din pachet sau din teancul de decartare.',
          'Pentru a face prima etalare, valoarea combinată trebuie să fie de minim 45 de puncte ȘI să conțină cel puțin o terță curată.',
          'Valori: 2-9 au 5 pct, 10-K au 10 pct, Așii au 25 pct, Jokerii au 50 pct.',
          'După etalarea inițială de 45 de puncte, poți lipi cărți la orice etalare existentă pe masă.',
          'Poți schimba un Joker de pe masă dacă ai cartea exactă pe care Jokerul o înlocuiește.',
          'Pentru a câștiga runda (Inchidere), trebuie să etalezi/lipești toate cărțile CU EXCEPȚIA uneia, care trebuie decartată.'
        ]
      }
    },
    'fr-FR': {
      'tic-tac-toe': {
        title: 'Morpion',
        rules: [
          'Le jeu se joue sur une grille de 3 cases sur 3.',
          'Vous êtes X, votre ami est O. Les joueurs placent à tour de rôle leurs marques dans des cases vides.',
          'Le premier joueur à aligner 3 de ses marques (horizontalement, verticalement ou diagonalement) est le gagnant.',
          'Quand les 9 cases sont pleines, le jeu est terminé. S\'il n\'y a pas d\'alignement, c\'est un match nul.'
        ]
      },
      'connect-4': {
        title: 'Puissance 4',
        rules: [
          'Le jeu se joue sur un plateau vertical de 7 colonnes et 6 rangées.',
          'Les joueurs font tomber tour à tour un de leurs jetons de couleur dans la colonne de leur choix.',
          'Le jeton tombe vers le bas, occupant le premier espace disponible.',
          'L\'objectif est d\'être le premier à aligner quatre jetons de sa couleur.'
        ]
      },
      'rummy-45': {
        title: 'Rami 45',
        rules: [
          'Le but est de poser toutes vos cartes en brelans (même valeur, couleurs différentes) ou en suites (cartes consécutives de même couleur).',
          'À votre tour, vous devez piocher une carte dans le talon ou la défausse.',
          'Pour votre première pose, la valeur combinée doit être d\'au moins 45 points ET inclure au moins une suite.',
          'Valeurs: 2-9 = 5 pts, 10-K = 10 pts, As = 25 pts, Jokers = 50 pts.',
          'Après la pose de 45 pts, vous pouvez ajouter des cartes aux combinaisons existantes sur le plateau.',
          'Vous pouvez remplacer un Joker sur le plateau si vous avez la carte exacte qu\'il représente.',
          'Pour gagner, vous devez poser toutes vos cartes SAUF une, qui doit être défaussée.'
        ]
      }
    },
    'es-ES': {
      'tic-tac-toe': {
        title: 'Tres en Raya',
        rules: [
          'El juego se desarrolla en una cuadrícula de 3x3.',
          'Tú eres X, tu amigo es O. Los jugadores se turnan para poner sus marcas en casillas vacías.',
          'El primer jugador en conseguir 3 de sus marcas en fila (arriba, abajo, a través, o en diagonal) es el ganador.',
          'Cuando las 9 casillas están llenas, el juego termina. Si ningún jugador tiene 3 en raya, hay un empate.'
        ]
      },
      'connect-4': {
        title: 'Conecta 4',
        rules: [
          'El juego se juega en un tablero vertical con 7 columnas y 6 filas.',
          'Los jugadores se turnan para dejar caer sus fichas de colores por una columna.',
          'La ficha caerá hacia abajo, ocupando el espacio disponible más bajo.',
          'El objetivo del juego es ser el primero en formar una línea de cuatro de tus propias fichas.'
        ]
      },
      'rummy-45': {
        title: 'Rummy 45',
        rules: [
          'El objetivo es combinar todas tus cartas en tríos (mismo valor, diferentes palos) o escaleras (cartas consecutivas del mismo palo).',
          'En tu turno, debes robar una carta del mazo o de la pila de descartes.',
          'Para tu primera combinación, el valor total debe ser de al menos 45 puntos Y debe incluir al menos una escalera.',
          'Valores: 2-9 son 5 pts, 10-K son 10 pts, Ases son 25 pts, Comodines son 50 pts.',
          'Después de tu combinación de 45 pts, puedes añadir cartas a cualquier combinación existente en la mesa.',
          'Puedes intercambiar un comodín de la mesa si tienes la carta exacta que representa.',
          'Para ganar la ronda, debes combinar todas tus cartas EXCEPTO una, que debe ser descartada.'
        ]
      }
    },
    'it-IT': {
      'tic-tac-toe': {
        title: 'Tris',
        rules: [
          'Il gioco si svolge su una griglia di 3 quadrati per 3.',
          'Tu sei X, il tuo amico è O. I giocatori fanno a turno per mettere i loro segni nei quadrati vuoti.',
          'Il primo giocatore ad ottenere 3 dei suoi segni in fila vince.',
          'Quando tutti e 9 i quadrati sono pieni, la partita è finita. Se nessun giocatore ha 3 segni di fila, c\'è un pareggio.'
        ]
      },
      'connect-4': {
        title: 'Forza 4',
        rules: [
          'Il gioco si svolge su una tavola verticale con 7 colonne e 6 righe.',
          'I giocatori, a turno, lasciano cadere i loro dischi colorati in una colonna.',
          'Il disco cadrà verso il basso, occupando lo spazio disponibile più basso.',
          'L\'obiettivo è essere il primo a formare una linea di quattro dei propri dischi.'
        ]
      },
      'rummy-45': {
        title: 'Ramino 45',
        rules: [
          'L\'obiettivo è combinare tutte le tue carte in tris o scale.',
          'Al tuo turno, devi pescare una carta dal mazzo o dagli scarti.',
          'Per la tua prima combinazione, il valore deve essere di almeno 45 punti E includere una scala.',
          'Valori: 2-9 sono 5 punti, 10-K sono 10 punti, Assi 25, Jolly 50.',
          'Dopo l\'apertura da 45 punti, puoi attaccare le carte alle combinazioni sul tavolo.',
          'Puoi scambiare un jolly se hai la carta esatta che sostituisce.',
          'Per chiudere e vincere, devi combinare o attaccare tutte le carte TRANNE una da scartare.'
        ]
      }
    },
    'de-DE': {
      'tic-tac-toe': {
        title: 'Tic-Tac-Toe',
        rules: [
          'Das Spiel wird auf einem Raster von 3x3 Feldern gespielt.',
          'Du bist X, dein Freund ist O. Die Spieler setzen abwechselnd ihre Markierungen in leere Felder.',
          'Der erste Spieler, der 3 seiner Markierungen in einer Reihe (horizontal, vertikal oder diagonal) hat, gewinnt.',
          'Wenn alle 9 Felder voll sind, ist das Spiel beendet. Ohne 3 in einer Reihe gibt es ein Unentschieden.'
        ]
      },
      'connect-4': {
        title: 'Vier Gewinnt',
        rules: [
          'Das Spiel wird auf einem senkrechten Brett mit 7 Spalten und 6 Reihen gespielt.',
          'Die Spieler werfen abwechselnd ihre farbigen Scheiben von oben in eine Spalte.',
          'Die Scheibe fällt nach unten und besetzt den untersten verfügbaren Platz.',
          'Ziel ist es, als Erster eine Linie aus vier eigenen Scheiben zu bilden.'
        ]
      },
      'rummy-45': {
        title: 'Rommé 45',
        rules: [
          'Das Ziel ist es, alle Karten in Sätzen (gleicher Wert, verschiedene Farben) oder Folgen (gleiche Farbe, fortlaufend) auszulegen.',
          'Bist du an der Reihe, ziehst du eine Karte vom Stapel oder Ablagestapel.',
          'Für deine erste Auslage muss der kombinierte Wert mindestens 45 Punkte betragen UND mindestens eine Folge enthalten.',
          'Kartenwerte: 2-9 = 5 Pkt, 10-K = 10 Pkt, Asse = 25 Pkt, Joker = 50 Pkt.',
          'Nach den 45 Pkt kannst du Karten an bestehende Auslagen anlegen.',
          'Du kannst einen Joker austauschen, wenn du die genaue Karte hast.',
          'Um die Runde zu gewinnen, musst du alle Karten bis auf eine ablegen, welche abgeworfen wird.'
        ]
      }
    }
  };

  return translations[lang] || translations['en-US'];
};

export default function GamesHubModal({ isOpen, onClose, groupId, groupName, userMap, selectedDate }: GamesHubModalProps) {
  const [activeGames, setActiveGames] = useState<any[]>([]);
  const [playingGameId, setPlayingGameId] = useState<string | null>(null);
  const [view, setView] = useState<'arcade' | 'leaderboard'>('arcade');
  const [leaderboard, setLeaderboard] = useState<{uid: string, wins: number, points?: number}[]>([]);
  const [showRulesFor, setShowRulesFor] = useState<string | null>(null);
  const { language } = useThemeStore();
  const gameRules = getGameRules(language);

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
      const statsMap: Record<string, { wins: number; points: number }> = {};
      
      games.forEach(g => {
        if (g.winner) {
          if (!statsMap[g.winner]) statsMap[g.winner] = { wins: 0, points: 0 };
          statsMap[g.winner].wins += 1;
        }

        if (g.gameType === 'rummy-45' && g.state && g.state.players) {
          Object.values(g.state.players).forEach((p: any) => {
             if (p.score !== undefined) {
               if (!statsMap[p.uid]) statsMap[p.uid] = { wins: 0, points: 0 };
               statsMap[p.uid].points += p.score;
             }
          });
        }
      });

      const sortedLeaderboard = Object.entries(statsMap)
        .map(([uid, stats]) => ({ uid, ...stats }))
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
          players: { X: auth.currentUser.uid, O: null },
          scores: { X: 0, O: 0 }
        };
      } else if (gameType === 'connect-4') {
        initialState = {
          board: Array(6).fill(null).map(() => Array(7).fill(null)),
          p1IsNext: true,
          players: { P1: auth.currentUser.uid, P2: null },
          scores: { P1: 0, P2: 0 },
          winningCells: null
        };
      } else if (gameType === 'rummy-45') {
        initialState = {
          players: {
            [auth.currentUser.uid]: { uid: auth.currentUser.uid, hand: [], hasMelded: false, score: 0 }
          },
          playerIds: playerIds,
          turnIndex: 0,
          turnPhase: 'draw',
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
          <div className="flex items-center gap-2">
            {playingGameId && activeGame && (
              <button
                onClick={() => setShowRulesFor(activeGame.gameType)}
                className="p-1.5 text-zinc-400 hover:text-blue-500 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors mr-2"
                title="How to play"
              >
                <Info className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => playingGameId ? setPlayingGameId(null) : onClose()} 
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col relative bg-zinc-50 dark:bg-zinc-950">
          {playingGameId && activeGame ? (
            <div className="flex-1 flex flex-col">
              {activeGame.gameType === 'tic-tac-toe' && (
                <TicTacToe game={activeGame} userMap={userMap} onBack={() => setPlayingGameId(null)} />
              )}
              {activeGame.gameType === 'connect-4' && (
                <Connect4 game={activeGame} userMap={userMap} onBack={() => setPlayingGameId(null)} />
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
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-primary/50 transition-colors group flex flex-col h-full relative">
                        <button onClick={(e) => { e.stopPropagation(); setShowRulesFor('tic-tac-toe'); }} className="absolute top-3 right-3 p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-full transition-colors z-10" title="How to play">
                          <Info className="w-4 h-4" />
                        </button>
                        <div className="cursor-pointer flex flex-col flex-1" onClick={() => handleCreateGame('tic-tac-toe')}>
                          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 text-blue-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <div className="text-xl font-bold font-mono">X O</div>
                          </div>
                          <h5 className="font-bold text-zinc-900 dark:text-zinc-100 text-lg mb-1">Tic-Tac-Toe</h5>
                          <p className="text-sm text-zinc-500 flex-1">A classic 2-player game. First to get 3 in a row wins!</p>
                        </div>
                      </div>

                      {/* Connect 4 Card */}
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-primary/50 transition-colors group flex flex-col h-full relative">
                        <button onClick={(e) => { e.stopPropagation(); setShowRulesFor('connect-4'); }} className="absolute top-3 right-3 p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-full transition-colors z-10" title="How to play">
                          <Info className="w-4 h-4" />
                        </button>
                        <div className="cursor-pointer flex flex-col flex-1" onClick={() => handleCreateGame('connect-4')}>
                          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform flex-wrap p-2 gap-1">
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                            <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                          </div>
                          <h5 className="font-bold text-zinc-900 dark:text-zinc-100 text-lg mb-1">Connect 4</h5>
                          <p className="text-sm text-zinc-500 flex-1">Drop discs to get 4 in a row. Strategic and fast-paced!</p>
                        </div>
                      </div>

                      {/* Rummy 45 Card */}
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 hover:border-primary/50 transition-colors group flex flex-col h-full relative">
                        <button onClick={(e) => { e.stopPropagation(); setShowRulesFor('rummy-45'); }} className="absolute top-3 right-3 p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-full transition-colors z-10" title="How to play">
                          <Info className="w-4 h-4" />
                        </button>
                        <div className="cursor-pointer flex flex-col flex-1" onClick={() => handleCreateGame('rummy-45')}>
                          <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <div className="text-xl font-bold font-mono">45</div>
                          </div>
                          <h5 className="font-bold text-zinc-900 dark:text-zinc-100 text-lg mb-1">Rummy 45</h5>
                          <p className="text-sm text-zinc-500">The ultimate family card game. Form runs and sets to win.</p>
                        </div>
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
                              {entry.points !== undefined && entry.points < 0 && (
                                 <p className="text-xs font-bold text-red-500 mt-1">{entry.points} pts</p>
                              )}
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

      {/* Rules Modal Overlay */}
      {showRulesFor && gameRules[showRulesFor] && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={() => setShowRulesFor(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-2xl flex flex-col border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-blue-50 dark:bg-blue-900/20 rounded-t-2xl">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <Info className="w-5 h-5" />
                <h3 className="font-bold text-lg">{gameRules[showRulesFor].title}</h3>
              </div>
              <button onClick={() => setShowRulesFor(null)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-white dark:bg-zinc-800 rounded-full transition-colors shadow-sm">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <ul className="space-y-3">
                {gameRules[showRulesFor].rules.map((rule, idx) => (
                  <li key={idx} className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs mt-0.5">{idx + 1}</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-2xl flex justify-end">
              <button onClick={() => setShowRulesFor(null)} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
