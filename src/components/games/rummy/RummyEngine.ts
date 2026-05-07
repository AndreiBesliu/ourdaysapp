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

// --- PHASE 3: MELD VALIDATION & SCORING ---

const VALUE_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const validateMeld = (cards: RummyCard[]): { isValid: boolean; type?: 'set' | 'run'; points: number; error?: string } => {
  if (cards.length < 3) return { isValid: false, points: 0, error: 'Meld must have at least 3 cards.' };

  if (cards.length < 3) return { isValid: false, points: 0, error: 'Meld must have at least 3 cards.' };
  const naturalCards = cards.filter(c => !c.isJoker);

  if (naturalCards.length < 2) return { isValid: false, points: 0, error: 'Meld must have at least 2 natural cards.' };

  // Check if SET (same value, different suits)
  const isSet = naturalCards.every(c => c.value === naturalCards[0].value);
  if (isSet) {
    // Suits must be unique
    const suits = new Set(naturalCards.map(c => c.suit));
    if (suits.size !== naturalCards.length) return { isValid: false, points: 0, error: 'Sets must have distinct suits.' };
    if (cards.length > 4) return { isValid: false, points: 0, error: 'Sets cannot have more than 4 cards.' };
    
    // Valid SET
    return { isValid: true, type: 'set', points: calculateMeldPoints(cards, 'set') };
  }

  // Check if RUN (same suit, consecutive values)
  const isSameSuit = naturalCards.every(c => c.suit === naturalCards[0].suit);
  if (isSameSuit) {
    // Try to form a run. Since users might place them out of order if we don't sort, we should assume the array is the exact order they intended, OR we sort it. Let's assume the cards array is ordered by the user.
    // Actually, checking consecutive order with Jokers is tricky. Let's just map them to their indexes.
    // For simplicity, we expect the user to provide them in order.
    let currentIdx = -1;
    let validRun = true;
    let hasAceAtStart = false;

    // Check if first card is an Ace (A-2-3)
    if (!cards[0].isJoker && cards[0].value === 'A') {
      hasAceAtStart = true;
      currentIdx = -1; // Ace acts as "1" here. 2 is index 0.
    } else if (!cards[0].isJoker) {
      currentIdx = VALUE_ORDER.indexOf(cards[0].value!);
    } else {
      // First card is Joker. We deduce its value from the next natural card.
      const firstNaturalIdx = cards.findIndex(c => !c.isJoker);
      const firstNaturalValueIdx = VALUE_ORDER.indexOf(cards[firstNaturalIdx].value!);
      currentIdx = firstNaturalValueIdx - firstNaturalIdx;
      if (currentIdx < -1) validRun = false; // Cannot go below Ace(1)
    }

    if (validRun) {
      for (let i = hasAceAtStart ? 1 : 1; i < cards.length; i++) {
        const c = cards[i];
        currentIdx++;
        if (!c.isJoker) {
          // If we hit an Ace at the END, currentIdx should be 12 (which is 'A').
          const expectedVal = VALUE_ORDER[currentIdx];
          if (c.value !== expectedVal) {
            // Special case: we can wrap A around? No, standard rummy: Q-K-A is valid, A-2-3 is valid, but K-A-2 is NOT.
            validRun = false;
            break;
          }
        }
        if (currentIdx > 12) {
          validRun = false; // Exceeded Ace
          break;
        }
      }
    }

    if (validRun) {
      return { isValid: true, type: 'run', points: calculateMeldPoints(cards, 'run', hasAceAtStart) };
    }
  }

  return { isValid: false, points: 0, error: 'Cards do not form a valid Set or Run.' };
};

const calculateMeldPoints = (cards: RummyCard[], type: 'set' | 'run', aceAsOne: boolean = false): number => {
  let pts = 0;
  for (const c of cards) {
    if (c.isJoker) {
      pts += 50;
    } else if (c.value === 'A') {
      if (type === 'set') pts += 25;
      else if (aceAsOne) pts += 5;
      else pts += 10;
    } else {
      const idx = VALUE_ORDER.indexOf(c.value!);
      if (idx >= 0 && idx <= 7) pts += 5; // 2-9
      else pts += 10; // 10-K
    }
  }
  return pts;
};

export const canAttachToMeld = (meldCards: RummyCard[], card: RummyCard): { isValid: boolean; newCards?: RummyCard[] } => {
  // Test adding to end
  const appendTest = validateMeld([...meldCards, card]);
  if (appendTest.isValid) {
    return { isValid: true, newCards: [...meldCards, card] };
  }
  // Test adding to start
  const prependTest = validateMeld([card, ...meldCards]);
  if (prependTest.isValid) {
    return { isValid: true, newCards: [card, ...meldCards] };
  }
  return { isValid: false };
};

export const calculatePenaltyPoints = (hand: RummyCard[]): number => {
  let pts = 0;
  for (const c of hand) {
    if (c.isJoker) {
      pts -= 50;
    } else if (c.value === 'A') {
      pts -= 25;
    } else {
      const idx = VALUE_ORDER.indexOf(c.value!);
      if (idx >= 0 && idx <= 7) pts -= 5; // 2-9
      else pts -= 10; // 10-K
    }
  }
  return pts;
};
