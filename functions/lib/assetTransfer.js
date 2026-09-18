"use strict";
// functions/src/assetTransfer.ts
//
// What a wallet card looks like after it changes hands.
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// `transferAssetCopy` built the recipient's copy as `{ ...rest, ownerId: recipientId }`, where
// `rest` was the whole source document minus `ownerId` and `createdAt`. So `sharedGroupId` — the
// field that decides who may READ a card — travelled with it.
//
// The rule resolves that field at read time:
//
//   allow read: ... || ('sharedGroupId' in d && d.sharedGroupId is string && isMemberOfGroup(...))
//
// so the moment a shared card is handed to somebody, every member of the SENDER's group can read
// the RECIPIENT's copy — a group the recipient may not be in, may never have heard of, and cannot
// see named on the card (the wallet can only print a group name it knows, so it falls back to a
// bare "Shared").
//
// ── Why it was harmless until today, and is not any more ─────────────────────────────
//
// Measured on live this morning: eighteen assets, `sharedGroupId` null on every one. The field was
// never set because sharing a card did not work — the wallet's own toggle was the only way to set
// it and nothing read it usefully. Zero cards could leak because zero cards were shared.
//
// Today attaching a card to a group event started setting that field, deliberately and by design.
// That is what arms this: the first card Andrei attaches to a Family event and then hands to
// somebody is the first card readable by Family in a wallet that is not his.
//
// ── The rule ─────────────────────────────────────────────────────────────────────────
//
// A transferred card starts PRIVATE. Sharing is a statement the owner makes about their own card,
// and a new owner has not made it. They can share it themselves, with a group of theirs, in one
// tap — which is the only version of that statement that means anything.
//
// Pure, and importable by `src/utils/assetTransfer.test.ts`: no imports, no firebase-admin, so the
// decision can be RUN rather than reasoned about. `sharedWithFamily` is written alongside because
// it is the DERIVED legacy twin of `sharedGroupId` (see src/utils/assetSharing.ts) — leaving it
// behind would let the two disagree, which is how that field earned its reputation.
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIVATE_ON_TRANSFER = void 0;
exports.transferredCopy = transferredCopy;
/** The fields a transfer must not carry over, and what they become instead. */
exports.PRIVATE_ON_TRANSFER = {
    sharedGroupId: null,
    sharedWithFamily: false,
};
/**
 * The document the recipient's copy should be.
 *
 * `source` is the sender's asset as stored. `now` is passed in rather than read from the clock so
 * this stays a function of its inputs.
 */
function transferredCopy(source, senderId, recipientId, now) {
    // Named explicitly rather than spread-and-override: a spread that is later reordered silently
    // stops overriding, and this codebase has already been bitten by exactly that shape.
    const { ownerId, createdAt, sharedGroupId, sharedWithFamily } = source, rest = __rest(source, ["ownerId", "createdAt", "sharedGroupId", "sharedWithFamily"]);
    void ownerId;
    void createdAt;
    void sharedGroupId;
    void sharedWithFamily;
    return Object.assign(Object.assign(Object.assign({}, rest), exports.PRIVATE_ON_TRANSFER), { ownerId: recipientId, createdAt: now, 
        // The old client-side ownerId flip never wrote this, so a wallet entry that appeared out of
        // nowhere had nothing on it saying where it came from.
        transferredFrom: senderId });
}
//# sourceMappingURL=assetTransfer.js.map