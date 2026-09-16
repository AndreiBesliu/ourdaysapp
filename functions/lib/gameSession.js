"use strict";
// src/utils/gameSession.ts
//
// Who won a game session, and when a session has been abandoned.
//
// ⚠ BYTE-IDENTICAL COPY at functions/src/gameSession.ts, enforced by
// src/utils/gameSessionServerCopy.test.ts. Both sides answer the same two questions — the End
// button in the arcade and the scheduled sweep that closes forgotten games — and if they ever
// disagreed, a game would be banked to the leaderboard one way by a person and another way by the
// server, for the same board.
//
// It therefore imports NOTHING. Not the client SDK, not the Admin SDK, not a date library. Both
// runtimes hand it plain data and it hands back plain answers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAMPED_FROM_MS = exports.SERVER_OWNED_GAME = exports.IDLE_MS = void 0;
exports.getSessionWinner = getSessionWinner;
exports.activityMs = activityMs;
exports.nextRoundsWon = nextRoundsWon;
exports.lastActivityMs = lastActivityMs;
exports.expiryRefusal = expiryRefusal;
exports.shouldExpire = shouldExpire;
exports.closedSessionFields = closedSessionFields;
/** How long a session may sit untouched before it counts as abandoned. Andrei's call, 16.09.2026. */
exports.IDLE_MS = 24 * 60 * 60 * 1000;
/** Warlord battles share the `games` collection but are server-owned and have their own forfeit. */
exports.SERVER_OWNED_GAME = 'warlord-battle';
/**
 * The moment moves started being timestamped.
 *
 * Every game made before this has no `lastMoveAt`, so the only date on it is `createdAt` — and
 * `createdAt` cannot tell "nobody has touched it since it was made" from "played every evening
 * for a week, none of which was recorded". Judging those by creation alone would close games that
 * are in active play: measured on live, all eighteen games in the database were made months ago
 * and not one carries a timestamp.
 *
 * So a game with no `lastMoveAt` is judged from this floor instead, which gives every one of them
 * a full idle window in which an actual move stamps it properly and settles the question. What is
 * still untouched after that really has not been touched.
 */
exports.STAMPED_FROM_MS = Date.parse('2026-09-16T00:00:00.000Z');
/**
 * Determine the WINNER OF THE SESSION (not just the last round). Round-loop games (Tic-Tac-Toe,
 * Connect 4, Memory Match) accumulate per-round wins in `state.scores`, so the session leader is
 * whoever has the higher score — the `winner` field on the doc only reflects the most recent
 * round. Rummy is a single hand, so its `winner` is already the session result.
 */
function getSessionWinner(game) {
    const s = (game === null || game === void 0 ? void 0 : game.state) || {};
    const players = s.players || {};
    const scores = s.scores || {};
    switch (game === null || game === void 0 ? void 0 : game.gameType) {
        case 'tic-tac-toe': {
            const x = scores.X || 0, o = scores.O || 0;
            if (x === o)
                return null; // tie or no rounds won
            return (x > o ? players.X : players.O) || null;
        }
        case 'connect-4': {
            // `scores` here ARE rounds won: Connect4 increments them once per round and never resets.
            const p1 = scores.P1 || 0, p2 = scores.P2 || 0;
            if (p1 === p2)
                return null;
            return (p1 > p2 ? players.P1 : players.P2) || null;
        }
        case 'memory-match': {
            // Memory Match is the exception, and it needed a field of its own. Its `scores` are PAIRS
            // AND STREAK BONUSES for the current round — `handleNextRound` resets both to zero — so
            // reading them as a session result credited whoever led the LAST round, however the rest
            // had gone. Andrei asked for the counter, 16.09.2026.
            const won = s.roundsWon || {};
            const r1 = won.P1 || 0, r2 = won.P2 || 0;
            if (r1 + r2 > 0) {
                if (r1 === r2)
                    return null;
                return (r1 > r2 ? players.P1 : players.P2) || null;
            }
            // Nothing counted yet, so fall back to the per-round points — which is what this function
            // has always returned for this game. Deliberate, and not merely for old documents: a
            // session already in progress starts counting rounds only from the next one it finishes,
            // and reporting "nobody won" for a game with two rounds behind it would be a worse answer
            // than the imprecise one it gave yesterday. Every session started from here counts properly
            // from its first round.
            const p1 = scores.P1 || 0, p2 = scores.P2 || 0;
            if (p1 === p2)
                return null;
            return (p1 > p2 ? players.P1 : players.P2) || null;
        }
        case 'rummy-45': {
            // Multi-round: the session winner is the LEAST-penalised player. Penalties are stored
            // NEGATIVE (calculatePenaltyPoints), so the least penalty is the HIGHEST cumulative
            // (closest to 0) → pick the max. If no multi-round totals exist (single hand), fall back to
            // the hand winner.
            const ids = s.playerIds || [];
            const multiRound = ids.some((id) => { var _a; return ((_a = players[id]) === null || _a === void 0 ? void 0 : _a.totalScore) !== undefined; });
            if (multiRound && ids.length > 0) {
                let best = null;
                let bestTotal = -Infinity;
                ids.forEach((id) => {
                    var _a, _b;
                    const total = (((_a = players[id]) === null || _a === void 0 ? void 0 : _a.totalScore) || 0) + (((_b = players[id]) === null || _b === void 0 ? void 0 : _b.score) || 0);
                    if (total > bestTotal) {
                        bestTotal = total;
                        best = id;
                    }
                });
                return best;
            }
            return (game === null || game === void 0 ? void 0 : game.winner) || null;
        }
        default:
            return (game === null || game === void 0 ? void 0 : game.winner) || null;
    }
}
/**
 * When this game was last touched, in epoch milliseconds, or null if it cannot be told.
 *
 * Four shapes, because the same document is read through three SDKs and one of them is the
 * author's own JSON: a client `Timestamp` and an Admin `Timestamp` both carry `toMillis()`, a
 * decoded one carries `seconds` (or `_seconds`), and a test fixture is simply a number or an ISO
 * string. Anything else is null — NOT zero, which would read as 1970 and expire the game instantly.
 */
function activityMs(value) {
    if (value == null)
        return null;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isNaN(ms) ? null : ms;
    }
    const v = value;
    if (typeof v.toMillis === 'function') {
        const ms = v.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    const seconds = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null;
}
/**
 * The rounds-won tally after a round ends, or null when nothing should change.
 *
 * Here rather than inline in the component for the usual reason — a decision that can be RUN gets
 * run — and the move earned its keep immediately. The inline version read
 * `winner === players.P1 ? 'P1' : 'P2'`, which credits P2 for ANY winner that is not P1, including
 * one that is neither player. This returns null instead, so a uid nobody recognises changes
 * nothing rather than handing a round to the wrong person.
 *
 * A draw increments neither, the same rule the other round-loop games follow.
 */
function nextRoundsWon(state, winnerUid) {
    if (!winnerUid)
        return null;
    const players = (state === null || state === void 0 ? void 0 : state.players) || {};
    const key = winnerUid === players.P1 ? 'P1' : winnerUid === players.P2 ? 'P2' : null;
    if (!key)
        return null;
    const base = Object.assign({ P1: 0, P2: 0 }, ((state === null || state === void 0 ? void 0 : state.roundsWon) || {}));
    return Object.assign(Object.assign({}, base), { [key]: (base[key] || 0) + 1 });
}
/**
 * The end of the calendar day a game was created FOR, if it has one.
 *
 * A game carries the day it belongs to (`date`, "yyyy-MM-dd") and that day can be in the future:
 * the arcade is opened from a date in the calendar, so "a game for Saturday" is an ordinary thing
 * to make on Wednesday. Such a game is not idle before its own day is over, however long it has
 * been sitting there — without this it would be closed the day after it was created, before the
 * evening it was made for. Parsed as UTC, which is up to fourteen hours out somewhere; against a
 * twenty-four hour window that is slack in the safe direction.
 */
function dayEndMs(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))
        return null;
    const ms = Date.parse(`${day}T23:59:59.999Z`);
    return Number.isNaN(ms) ? null : ms;
}
/**
 * The last moment anything happened in this game — or the last moment from which it is fair to
 * start counting, which is not always the same thing.
 *
 * Three sources, in order of how much they actually know:
 *   1. `lastMoveAt`, written by every move since 16.09.2026. The real answer.
 *   2. `STAMPED_FROM_MS` for games older than that, because their `createdAt` says nothing about
 *      whether anyone has played them recently — see the constant.
 *   3. the end of the day the game was made FOR, so a game booked for next Saturday is not
 *      abandoned on Thursday.
 */
function lastActivityMs(game) {
    const stamped = activityMs(game === null || game === void 0 ? void 0 : game.lastMoveAt);
    const base = stamped !== null && stamped !== void 0 ? stamped : (activityMs(game === null || game === void 0 ? void 0 : game.createdAt) === null ? null : exports.STAMPED_FROM_MS);
    const day = dayEndMs(game === null || game === void 0 ? void 0 : game.date);
    if (base === null)
        return day;
    return day === null ? base : Math.max(base, day);
}
/** A timestamp this far past `now` is not "fresh", it is wrong. Generous: clocks do drift. */
const FUTURE_SLACK_MS = 60 * 60 * 1000;
/**
 * Whether the sweep should close this game, and if not, why not.
 *
 * Returns a REASON rather than a bare false so the scheduled run can say what it skipped and how
 * often. A sweep that only reports what it closed cannot be told apart from one that is silently
 * skipping everything.
 */
function expiryRefusal(game, nowMs) {
    if ((game === null || game === void 0 ? void 0 : game.gameType) === exports.SERVER_OWNED_GAME)
        return 'server-owned';
    // `finalized`, and DELIBERATELY not `status`. In this schema `status: 'finished'` means the
    // ROUND is over, not the session: the round-loop games set it at the end of every round and
    // "Next Round" sets it back to 'playing'. Reading it as "already closed" made the sweep blind
    // to the commonest way a game is abandoned — somebody wins a round and nobody comes back — and
    // one of the eighteen games on live was sitting in exactly that state.
    if ((game === null || game === void 0 ? void 0 : game.finalized) === true)
        return 'already-closed';
    // The future check applies to the STAMP alone, never to the combined figure. A game booked for
    // next Saturday legitimately has a last-activity in the future — that is the whole point of the
    // day floor — and calling that a broken clock would file the commonest future case under the
    // one reason that means "something is wrong". Only a MOVE claiming to have happened after now
    // is suspicious.
    const stamped = activityMs(game === null || game === void 0 ? void 0 : game.lastMoveAt);
    if (stamped !== null && stamped - nowMs > FUTURE_SLACK_MS)
        return 'future-timestamp';
    const last = lastActivityMs(game);
    if (last === null)
        return 'no-timestamp';
    if (nowMs - last < exports.IDLE_MS)
        return 'still-fresh';
    return null;
}
/** Convenience for the call sites that only care about the verdict. */
function shouldExpire(game, nowMs) {
    return expiryRefusal(game, nowMs) === null;
}
/**
 * The fields that close a session — shared so the button and the sweep write the same shape.
 *
 * `endedAt` is NOT here: one side needs the client SDK's `serverTimestamp()` and the other the
 * Admin SDK's, and this file is allowed neither. Each caller adds its own.
 */
function closedSessionFields(game, abandoned) {
    return Object.assign({ status: 'finished', winner: getSessionWinner(game), finalized: true }, (abandoned ? { abandoned: true } : {}));
}
//# sourceMappingURL=gameSession.js.map