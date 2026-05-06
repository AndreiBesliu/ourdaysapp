export interface RummyCard {
  id: string; // Unique ID for Drag and Drop (e.g., 'H-5_1')
  code: string; // The face value (e.g., 'H-5')
  suit?: 'H' | 'D' | 'C' | 'S';
  value?: string;
  isJoker: boolean;
}

export interface PlayerState {
  uid: string;
  hand: RummyCard[];
  hasMelded: boolean;
  score: number;
}

export interface GameState {
  players: Record<string, PlayerState>;
  playerIds: string[]; // Order of play
  turnIndex: number;
  turnPhase: 'draw' | 'play';
  deck: RummyCard[];
  discardPile: RummyCard[];
  melds: { id: string, playerId: string, cards: RummyCard[] }[];
  status: 'waiting' | 'playing' | 'finished';
  winner: string | null;
}

const SUITS = ['H', 'D', 'C', 'S'] as const;
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const createDeck = (): RummyCard[] => {
  const deck: RummyCard[] = [];
  
  // Create 2 standard decks
  for (let deckNum = 1; deckNum <= 2; deckNum++) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        deck.push({
          id: `${suit}-${value}_${deckNum}`,
          code: `${suit}-${value}`,
          suit,
          value,
          isJoker: false
        });
      }
    }
  }

  // Add 2 Jokers
  deck.push({ id: 'JOKER_1', code: 'JOKER', isJoker: true });
  deck.push({ id: 'JOKER_2', code: 'JOKER', isJoker: true });

  return deck;
};

export const shuffleDeck = (deck: RummyCard[]): RummyCard[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

export const initializeGame = (playerUids: string[]): GameState => {
  let deck = shuffleDeck(createDeck());
  const players: Record<string, PlayerState> = {};
  
  // Deal cards
  playerUids.forEach((uid, index) => {
    // First player gets 15 cards, others get 14
    const numCards = index === 0 ? 15 : 14;
    const hand = deck.splice(0, numCards);
    players[uid] = {
      uid,
      hand,
      hasMelded: false,
      score: 0
    };
  });

  // Start discard pile with 1 card (first player has 15 so they don't draw on turn 1, they just discard. Wait! Actually in Rummy 45, the first player has 15 cards and does NOT draw on their first turn, they just discard. Thus, discard pile starts empty!)
  // In some rules, a card is flipped and first player draws anyway. Let's stick to: First player has 15 cards, no flipped card initially. They just discard to start the pile.
  
  return {
    players,
    playerIds: playerUids,
    turnIndex: 0,
    turnPhase: 'play', // First player starts with 15 cards, so they skip drawing!
    deck,
    discardPile: [],
    melds: [],
    status: 'playing',
    winner: null
  };
};
