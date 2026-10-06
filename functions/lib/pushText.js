"use strict";
// functions/src/pushText.ts
//
// What a push may carry, whoever sends it (06.10.2026). Pure, with no firebase-admin import, so the
// app's suite tests it too (src/utils/pushText.test.ts).
//
// The bell row was always cut to 200 characters for the title and 500 for the body; the push was
// not cut at all. A member's own text — a chat message, their name — went to FCM at any size, and
// FCM refuses a payload over 4 KB as INVALID_ARGUMENT, which notify() reads as a dead token: one
// long message would have pruned the push tokens of everybody in the group at once. Cut to the
// bell's lengths, a title and a body are at most 2,100 bytes of UTF-8 together.
//
// A cut must not split a character. Half an emoji (a lone surrogate) has no UTF-8 encoding, and
// event titles already arrive here cut at 120 by the reminders, with no such care.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUSH_NAME_MAX = void 0;
exports.wellFormed = wellFormed;
exports.clampText = clampText;
exports.pushName = pushName;
/** The same text without lone surrogates, wherever they are. */
function wellFormed(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = s.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                out += s[i] + s[i + 1];
                i++;
            }
            continue;
        }
        if (c >= 0xdc00 && c <= 0xdfff)
            continue;
        out += s[i];
    }
    return out;
}
/** At most `max` UTF-16 units, never half a character. Anything that is not a string is "". */
function clampText(s, max) {
    if (typeof s !== "string")
        return "";
    return wellFormed(wellFormed(s).slice(0, max));
}
exports.PUSH_NAME_MAX = 40;
/** One line: every run of whitespace or control characters becomes one space. */
function oneLine(s) {
    let out = "";
    let gap = false;
    for (const ch of s) {
        const c = ch.charCodeAt(0);
        if (c < 0x20 || c === 0x7f || /\s/.test(ch)) {
            gap = true;
            continue;
        }
        if (gap && out)
            out += " ";
        gap = false;
        out += ch;
    }
    return out;
}
/**
 * The name a group push shows for whoever caused it (a game started, a chat message): the `name`
 * on their `users` document, else the part of that document's email before the @, else "Someone"
 * — what both triggers always read. Now always one line of at most 40 characters, like the
 * server's other stamps (senderIdentity.ts). `users` has no shape rule, so the name could be
 * several lines, any length, or not a string at all — a map threw, and that person's game and
 * chat pushes stopped going out.
 */
function pushName(user) {
    const u = (user && typeof user === "object" ? user : {});
    const shape = (v) => (typeof v === "string" ? clampText(oneLine(v), exports.PUSH_NAME_MAX).trim() : "");
    return shape(u.name)
        || (typeof u.email === "string" ? shape(u.email.split("@")[0]) : "")
        || "Someone";
}
//# sourceMappingURL=pushText.js.map