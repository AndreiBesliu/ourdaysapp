"use strict";
// functions/src/errorState.ts
// New, seen, resolved — and the one rule that keeps those words honest.
//
// ── The problem with a "resolved" flag ───────────────────────────────────────────────
//
// "Resolved" is not a note about how somebody feels. It is a CLAIM ABOUT THE CODE: this cannot
// happen any more. A flag that only records the claim turns the error panel into a to-do list you
// tick to feel better, and the fastest way to an empty panel becomes marking everything resolved.
//
// So a resolved group carries a WATERMARK: the timestamp of the newest occurrence known at the
// moment it was resolved. An occurrence after that watermark refutes the claim, and the group comes
// back by itself as `regressed` — louder than new, because something that was believed fixed and
// is not is worse news than something nobody has looked at yet.
//
// Nobody has to remember to do this. That is the point: a status that can only be changed by hand
// decays into a lie the moment attention moves on.
//
// ── Why `seen` does NOT work the same way ────────────────────────────────────────────
//
// `seen` claims nothing about the code — only "I know about this one". A new occurrence does not
// contradict it, so it does not reset. But "known about AND still happening" is worth showing, so
// that travels as a separate flag rather than as a status. One field, one meaning.
//
// Pure: no imports, so the app's own suite tests it. See `functionsPurity.test.ts`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_RANK = exports.ERROR_STATUSES = void 0;
exports.isErrorStatus = isErrorStatus;
exports.groupDocId = groupDocId;
exports.recurredSince = recurredSince;
exports.effectiveStatus = effectiveStatus;
exports.joinState = joinState;
/** What an admin can set. `regressed` is DERIVED and can never be written. */
exports.ERROR_STATUSES = ["new", "seen", "resolved"];
function isErrorStatus(v) {
    return typeof v === "string" && exports.ERROR_STATUSES.includes(v);
}
/**
 * A Firestore document id for a fingerprint.
 *
 * Injective on purpose. A lossy id — truncation, or mapping "/" onto some other character already
 * in the alphabet — would let two different problems share one state document, so resolving one
 * would silently resolve the other. Percent-encoding "%" first is what keeps it reversible.
 *
 * Firestore also forbids "." and "..", ids starting with "__", and anything over 1500 bytes.
 */
function groupDocId(fingerprint) {
    const raw = typeof fingerprint === "string" ? fingerprint : "";
    if (!raw)
        return "unknown";
    let id = raw.replace(/%/g, "%25").replace(/\//g, "%2F");
    // NOT encodeURIComponent: "." is unreserved there, so it returns the very id Firestore
    // rejects. Its own test caught this.
    if (id === "." || id === "..")
        id = id.replace(/\./g, "%2E");
    if (id.startsWith("__"))
        id = `%5F%5F${id.slice(2)}`;
    // Cut on BYTES, not characters — a multi-byte character straddling the limit would produce an id
    // the server rejects. TextEncoder rather than Buffer: this module is imported by the app's own
    // test suite, and a Node global has no business in something that claims to be portable.
    if (new TextEncoder().encode(id).length > 1400) {
        id = `${id.slice(0, 300)}~${hash32(raw)}`;
    }
    return id;
}
/** A short, stable suffix. Only ever used to separate two ids that were already truncated. */
function hash32(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++)
        h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}
const timeOf = (v) => {
    const t = Date.parse(typeof v === "string" ? v : "");
    return Number.isFinite(t) ? t : -Infinity;
};
/**
 * Has this happened again since somebody last touched its status?
 *
 * A group with no state has never been touched, so nothing has happened "since" — false, not true.
 */
function recurredSince(state, lastSeen) {
    if (!state || !isErrorStatus(state.status))
        return false;
    const mark = timeOf(state.watermark);
    if (mark === -Infinity)
        return false;
    return timeOf(lastSeen) > mark;
}
/**
 * What the panel should call this group.
 *
 * A group nobody has touched is `new` — including one whose stored status is unreadable, because
 * showing an unknown state as "resolved" would hide it.
 */
function effectiveStatus(state, lastSeen) {
    if (!state || !isErrorStatus(state.status))
        return "new";
    if (state.status === "resolved" && recurredSince(state, lastSeen))
        return "regressed";
    return state.status;
}
/** Ordering for the panel: what needs attention first, then what is merely known, then what is done. */
exports.STATUS_RANK = {
    regressed: 0,
    new: 1,
    seen: 2,
    resolved: 3,
};
/**
 * Decorate groups with their stored state.
 *
 * Takes a LOOKUP rather than a parallel array, deliberately. The first version of this paired
 * `groups[i]` with `snapshots[i]`, and a slice applied to one side but not the other made every
 * group past the cap report `new` — no error, no log line, just a panel quietly forgetting what had
 * been resolved. An index is a fact about two arrays; a key is a fact about the data. Passing the
 * lookup means there is no alignment left to get wrong.
 */
function joinState(groups, lookup) {
    return groups.map((g) => {
        const state = lookup(g.key) || null;
        const status = effectiveStatus(state, g.lastSeen);
        return Object.assign(Object.assign({}, g), { status, 
            // `seen` never resets when something happens again — it only claimed "I know about this" —
            // but "known AND still happening" is worth showing, so it travels as its own flag.
            recurred: recurredSince(state, g.lastSeen), note: typeof (state === null || state === void 0 ? void 0 : state.note) === "string" ? state.note : null, 
            // Read against the status actually held, so a reopened group cannot report a resolve time.
            statusAt: status === "resolved"
                ? (typeof (state === null || state === void 0 ? void 0 : state.resolvedAt) === "string" ? state.resolvedAt : null)
                : (typeof (state === null || state === void 0 ? void 0 : state.seenAt) === "string" ? state.seenAt : null) });
    });
}
//# sourceMappingURL=errorState.js.map