"use strict";
// functions/src/docId.ts
//
// Whether a value may become ONE segment of a document path.
//
// The server builds paths like `groups/${groupId}` out of ids it did not choose: a callable's
// argument, or a field a client wrote on an invitation, an event or a game. A "/" in such an id does
// not fail. `groups/G/typing/B` is a valid path, to a DIFFERENT document, and a membership check then
// asks a subcollection document for its `members`. That is how `deleteGroupData` was passed before
// 06.10.2026 (`g1/typing/uid-bob`, a typing document a member could shape at will), and every other
// check built the same way could be passed the same way, wherever a member finds a document under a
// group whose fields they choose. The rules close those shapes one at a time; this closes the path
// (01.11.2026).
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlainDocId = isPlainDocId;
/** Only an id that names exactly one document may become a path: one segment, not a reserved one. */
function isPlainDocId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= 1500
        && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}
//# sourceMappingURL=docId.js.map