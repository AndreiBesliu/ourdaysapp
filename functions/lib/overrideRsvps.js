"use strict";
// functions/src/overrideRsvps.ts
//
// The RSVP answers a materialised occurrence carries — and who may set which of them.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────
//
// `createEventOverride` copied `rsvps` from the client's request straight onto the new document,
// on the Admin SDK. The Admin SDK does not evaluate rules, so `rsvpsOnlyMine()` — the rule that
// lets each person change only their OWN answer — was simply not consulted. Any member able to
// edit a shared series could send `{ rsvps: { <anybody>: 'yes' } }` and answer for the whole
// family, on one date, through the one door the rule could not see.
//
// ── The answer ─────────────────────────────────────────────────────────────────────────────
//
// Everybody else's answers come from the PARENT, exactly as they stood. The request speaks only
// for the caller: their answer if it is a real one, and if their key is absent from a map the
// request did send, their answer is removed — which is how the client un-answers (it deletes its
// own key). A request that sends no `rsvps` at all changes nothing.
//
// Pure, no firebase-admin, so the app's suite can run it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSVP_ANSWERS = void 0;
exports.overrideRsvps = overrideRsvps;
exports.RSVP_ANSWERS = ["yes", "maybe", "no"];
function plainMap(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}
/** The override's `rsvps`, or undefined when there are no answers to carry at all. */
function overrideRsvps(parent, requested, uid) {
    const out = {};
    // Other people's answers exactly as the parent holds them. Not re-validated: they were written
    // under the rules by the people they belong to, and dropping one here would delete it silently.
    const p = plainMap(parent);
    if (p)
        for (const [k, v] of Object.entries(p))
            if (typeof v === "string")
                out[k] = v;
    // The request, heard ONLY about the caller.
    const r = plainMap(requested);
    if (r && uid) {
        const mine = r[uid];
        if (typeof mine === "string" && exports.RSVP_ANSWERS.includes(mine))
            out[uid] = mine;
        else
            delete out[uid];
    }
    return Object.keys(out).length ? out : undefined;
}
//# sourceMappingURL=overrideRsvps.js.map