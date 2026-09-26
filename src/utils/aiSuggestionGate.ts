// src/utils/aiSuggestionGate.ts
//
// Whether a piece of text is worth spending an AI call on.
//
// The asset suggester fired on three events — the title losing focus, every checklist item added,
// and every checklist item losing focus — with nothing in between. Blurring an item you did not
// edit asked the model the same question again, so a six-item list sent roughly thirteen calls,
// about half of them identical to one already answered.
//
// That was cheap on gemini-2.5-flash-lite. On gemini-3.8-flash an output token cost 9.4 times as
// much, and on Claude Opus 5.5 (since 26.09.2026) it costs 50 times as much, so the same habit is
// the most expensive thing the app does by accident.
//
// The timing half of the fix (a debounce) belongs to the component; this is the half that can be
// decided without a clock, so it is the half that gets tested.

/**
 * The identity of a question, so two spellings of the same one are recognised as the same.
 *
 * Case and surrounding space do not change what is being asked. Inner runs of whitespace are
 * collapsed because a textarea that has been edited and re-edited collects them, and "milk  bread"
 * is not a different question from "milk bread".
 */
export function askKey(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Below this, there is nothing to match an asset against. Asking costs the same as asking about
 * something real, and the answer is noise.
 */
export const MIN_ASK_LENGTH = 3;

/**
 * Should we spend a call on this text?
 *
 * `alreadyAsked` holds keys from `askKey`. The set is per open modal: the same words typed for a
 * different event are a fair question again, while the same words blurred four times are not.
 */
export function shouldAskFor(text: unknown, alreadyAsked: ReadonlySet<string>): boolean {
  const key = askKey(text);
  if (key.length < MIN_ASK_LENGTH) return false;
  return !alreadyAsked.has(key);
}

/** How long to wait for the person to stop, before asking. */
export const ASK_DEBOUNCE_MS = 700;

/**
 * A scheduler that asks at most once per distinct question, and only after a pause.
 *
 * Holds the two things that have to agree — what has been asked, and what is waiting to be asked —
 * so they cannot drift apart in a component. Everything here is decidable with a fake clock, which
 * is the point: the coalescing and the second check are the subtle parts, and asserting them in a
 * comment is not the same as running them.
 */
export interface AskScheduler {
  /** Queue a question. Replaces any pending one — see `request` below for why that is right. */
  request(text: unknown): void;
  /** Drop anything pending without asking it. */
  cancel(): void;
  /** Forget what has been asked, and drop anything pending. A new event is a new set of questions. */
  reset(): void;
  /** For tests and for reasoning: how many distinct questions have actually been sent. */
  askedCount(): number;
}

export function createAskScheduler(
  ask: (text: string) => void,
  delayMs: number = ASK_DEBOUNCE_MS,
): AskScheduler {
  let asked = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    request(text: unknown) {
      if (!shouldAskFor(text, asked)) return;
      clear();
      // Only the LATEST text survives, which is right rather than merely cheap: the feature picks
      // ONE asset, so the freshest thing typed is the one worth asking about. A normal pause
      // between items is longer than the delay, so they are still asked about one by one; only a
      // genuine burst collapses into a single call.
      const pending = String(text);
      timer = setTimeout(() => {
        timer = null;
        // Checked again on the way out, not only on the way in: another path may have asked this
        // exact question while this one was waiting.
        if (!shouldAskFor(pending, asked)) return;
        asked.add(askKey(pending));
        ask(pending);
      }, delayMs);
    },
    cancel: clear,
    reset() {
      clear();
      asked = new Set();
    },
    askedCount: () => asked.size,
  };
}
