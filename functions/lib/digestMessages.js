"use strict";
// functions/src/digestMessages.ts
//
// What one chat message contributes to the group digest's prompt (generateGroupDigest).
//
// The line used to be `d.text || (d.imageUrl ? '[Image]' : '[Audio]')`, which got two things wrong:
//   * A deleted message keeps its document with `isDeleted: true` and its text and links cleared
//     (GroupChatWidget's soft delete), so it reached the model as "[Audio]": a voice note somebody
//     never sent, in place of words somebody took back.
//   * `text` was read without asking what it is. The rule has accepted only text since 08.10.2026; a
//     map from before, or from the console, went in as "[object Object]".
// A message is also ONE line: its own line breaks would let it write lines that read as other
// people's ("- Alice: ...") in a prompt that attributes each line to its sender. And so is everything
// else a client wrote into that prompt (the review, 01.11.2026): the sender's name, which stands at
// the start of the very line, the group's name and the events' titles. `digestText` is the one way
// any of them goes in.
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.digestText = digestText;
exports.digestMessageLine = digestMessageLine;
/**
 * Client-written text as ONE line of the prompt: every run of whitespace or control characters (C0, DEL
 * and C1, NEL among them) becomes one space, trimmed, cut at `max` CHARACTERS. Not text, or nothing
 * left: `null`.
 *
 * Cut on whole characters (code points), the way the rules count a name's length: a cut by UTF-16 units
 * can leave half an emoji, and the API refuses a body that holds one (remindersCore.ts), which would
 * fail the whole group's digest over one member's name (the re-verification, 01.11.2026).
 */
function digestText(raw, max) {
    if (typeof raw !== "string")
        return null;
    // eslint-disable-next-line no-control-regex
    const one = raw.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
    const s = Array.from(one).slice(0, max).join("").trim();
    return s || null;
}
/** The words, a picture, a voice note, or nothing at all (`null`: leave the message out). */
function digestMessageLine(message) {
    if (!message || typeof message !== "object")
        return null;
    const m = message;
    if (m.isDeleted === true)
        return null;
    // As long as the rule lets a message be (4000 characters), so nothing changes for a real one.
    const words = digestText(m.text, 4000);
    if (words)
        return words;
    if (typeof m.imageUrl === "string" && m.imageUrl)
        return "[Image]";
    if (typeof m.audioUrl === "string" && m.audioUrl)
        return "[Audio]";
    return null;
}
//# sourceMappingURL=digestMessages.js.map