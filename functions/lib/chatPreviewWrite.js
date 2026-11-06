"use strict";
// functions/src/chatPreviewWrite.ts
//
// Writes a conversation's preview (`lastMessageText`, `lastMessageBy`, `lastMessageDeleted`) from its NEWEST message
// as it is now. The one writer: both create triggers, and both update triggers once chatPreview.ts says an update
// changed what the list shows.
//
// Read, not taken from the event (the review, 06.11.2026). Eventarc orders nothing and may deliver twice: a message
// deleted a second after it was sent can reach its update trigger before its create trigger, an edit and a delete can
// arrive in either order, and two messages' create triggers can finish out of order. Whatever arrives last, it writes
// what the newest message says now, so the preview converges on the truth instead of on the last event handled. The
// words and the name come from the same message, never one's words under the other's name.
//
// In one transaction with the conversation: a message arriving meanwhile is either read here or written after, by its
// own trigger. `update`, never `set`: a conversation deleted meanwhile is not brought back holding a preview. An edit or
// a delete that leaves the preview as it is (an older message's) writes nothing, rather than a write that changes
// nothing and is still paid for.
//
// Like errorLog.ts, it calls `admin.firestore()` only inside its function, so the `initializeApp()` in index.ts has
// always run by then.
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPreview = syncPreview;
exports.previewNewMessage = previewNewMessage;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const chatPreview_1 = require("./chatPreview");
const errorLog_1 = require("./errorLog");
/** How far past the function's clock a message's `createdAt` may be (two servers' clocks) and still count. */
const CLOCK_SLACK_MS = 60000;
/**
 * Sync the preview of `conversation` (`groups/<id>` or `chats/<id>`) with its newest message. `activity` (a new
 * message) also stamps `lastMessageAt`, which orders the list; an edit or a delete moves nothing. `message`, when
 * given, is read in the same transaction and returned as it is now, for the caller that announces it.
 */
async function syncPreview(conversation, opts = {}) {
    const db = admin.firestore();
    const ref = db.doc(conversation);
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const [conv, latest, asked] = await Promise.all([
            tx.get(ref),
            // Only times, and none in the future: before 08.10.2026 the rules let a client write any `createdAt`, and a
            // string or a map sorts after every time (a time in 2099 above every real one). One such message would be the
            // "newest" for good, holding the preview while the chat itself hides it (src/utils/chatMessage.ts). A range on
            // the same field keeps to times, on the single-field index the order already needs.
            tx.get(db.collection(`${conversation}/messages`)
                .where("createdAt", "<=", firestore_1.Timestamp.fromMillis(Date.now() + CLOCK_SLACK_MS))
                .orderBy("createdAt", "desc").limit(1)),
            opts.message ? tx.get(opts.message) : Promise.resolve(null),
        ]);
        const message = opts.message ? ((asked === null || asked === void 0 ? void 0 : asked.exists) ? (_a = asked.data()) !== null && _a !== void 0 ? _a : null : null) : undefined;
        if (!conv.exists)
            return { outcome: "gone", message };
        // The rules stamp every message with the server's time (`createdAt == request.time`), so the newest is the one
        // with the latest. One without (none on live, 06.11.2026) is still the one asked about, if it is.
        const newest = (_d = (_c = (_b = latest.docs[0]) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : message) !== null && _d !== void 0 ? _d : null;
        if (!newest)
            return { outcome: "empty", message };
        const deleted = newest.isDeleted === true;
        // A deleted newest message: its words go, and the list says it was deleted, rather than "nothing said yet" with
        // older messages above it.
        const text = deleted ? "" : (0, chatPreview_1.previewOf)(newest);
        const by = typeof newest.senderId === "string" ? newest.senderId : null;
        const now = (_e = conv.data()) !== null && _e !== void 0 ? _e : {};
        const right = now.lastMessageText === text && now.lastMessageBy === by
            && (deleted ? now.lastMessageDeleted === true : !("lastMessageDeleted" in now));
        // A new message always writes: it moves the conversation up the list.
        if (right && !opts.activity)
            return { outcome: "unchanged", message };
        tx.update(ref, Object.assign({ lastMessageText: text, lastMessageDeleted: deleted ? true : firestore_1.FieldValue.delete(), lastMessageBy: by }, (opts.activity ? { lastMessageAt: firestore_1.FieldValue.serverTimestamp() } : {})));
        return { outcome: "written", message };
    });
}
/**
 * For a create trigger: sync the preview as a new message (`activity`), and return that message as it is now, for the
 * announcement; null when there is nothing to announce (the conversation or the message is gone).
 *
 * The announcement does not hang on the preview (the second review, 06.11.2026). A transaction that keeps losing to
 * a burst of messages in the same conversation, say, is logged under "chat:preview", where Admin sees it, and the
 * message is then read on its own: its push and its bell row still go.
 */
async function previewNewMessage(conversation, message) {
    var _a, _b;
    try {
        const synced = await syncPreview(conversation, { activity: true, message });
        return synced.outcome === "gone" ? null : (_a = synced.message) !== null && _a !== void 0 ? _a : null;
    }
    catch (err) {
        await (0, errorLog_1.logServerError)(`preview not written for a new message in ${conversation}: ${String((err === null || err === void 0 ? void 0 : err.message) || err)}`, "chat:preview", { stack: err === null || err === void 0 ? void 0 : err.stack });
        const snap = await message.get();
        return snap.exists ? (_b = snap.data()) !== null && _b !== void 0 ? _b : null : null;
    }
}
//# sourceMappingURL=chatPreviewWrite.js.map