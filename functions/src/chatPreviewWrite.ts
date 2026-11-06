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

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { previewOf } from "./chatPreview";
import { logServerError } from "./errorLog";

/** How far past the function's clock a message's `createdAt` may be (two servers' clocks) and still count. */
const CLOCK_SLACK_MS = 60_000;

export interface PreviewSync {
  /** Written; already right (nothing written); no conversation (nothing written); or no message to show (nothing written). */
  outcome: "written" | "unchanged" | "gone" | "empty";
  /** The message asked about (`message`), as it is now: null when it is gone, undefined when not asked. */
  message?: Record<string, unknown> | null;
}

/**
 * Sync the preview of `conversation` (`groups/<id>` or `chats/<id>`) with its newest message. `activity` (a new
 * message) also stamps `lastMessageAt`, which orders the list; an edit or a delete moves nothing. `message`, when
 * given, is read in the same transaction and returned as it is now, for the caller that announces it.
 */
export async function syncPreview(
  conversation: string,
  opts: { activity?: boolean; message?: admin.firestore.DocumentReference } = {},
): Promise<PreviewSync> {
  const db = admin.firestore();
  const ref = db.doc(conversation);
  return db.runTransaction(async (tx) => {
    const [conv, latest, asked] = await Promise.all([
      tx.get(ref),
      // Only times, and none in the future: before 08.10.2026 the rules let a client write any `createdAt`, and a
      // string or a map sorts after every time (a time in 2099 above every real one). One such message would be the
      // "newest" for good, holding the preview while the chat itself hides it (src/utils/chatMessage.ts). A range on
      // the same field keeps to times, on the single-field index the order already needs.
      tx.get(db.collection(`${conversation}/messages`)
        .where("createdAt", "<=", Timestamp.fromMillis(Date.now() + CLOCK_SLACK_MS))
        .orderBy("createdAt", "desc").limit(1)),
      opts.message ? tx.get(opts.message) : Promise.resolve(null),
    ]);
    const message = opts.message ? (asked?.exists ? asked.data() ?? null : null) : undefined;
    if (!conv.exists) return { outcome: "gone" as const, message };
    // The rules stamp every message with the server's time (`createdAt == request.time`), so the newest is the one
    // with the latest. One without (none on live, 06.11.2026) is still the one asked about, if it is.
    const newest = latest.docs[0]?.data() ?? message ?? null;
    if (!newest) return { outcome: "empty" as const, message };
    const deleted = newest.isDeleted === true;
    // A deleted newest message: its words go, and the list says it was deleted, rather than "nothing said yet" with
    // older messages above it.
    const text = deleted ? "" : previewOf(newest);
    const by = typeof newest.senderId === "string" ? newest.senderId : null;
    const now = conv.data() ?? {};
    const right = now.lastMessageText === text && now.lastMessageBy === by
      && (deleted ? now.lastMessageDeleted === true : !("lastMessageDeleted" in now));
    // A new message always writes: it moves the conversation up the list.
    if (right && !opts.activity) return { outcome: "unchanged" as const, message };
    tx.update(ref, {
      lastMessageText: text,
      lastMessageDeleted: deleted ? true : FieldValue.delete(),
      lastMessageBy: by,
      ...(opts.activity ? { lastMessageAt: FieldValue.serverTimestamp() } : {}),
    });
    return { outcome: "written" as const, message };
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
export async function previewNewMessage(
  conversation: string,
  message: admin.firestore.DocumentReference,
): Promise<Record<string, unknown> | null> {
  try {
    const synced = await syncPreview(conversation, { activity: true, message });
    return synced.outcome === "gone" ? null : synced.message ?? null;
  } catch (err) {
    await logServerError(`preview not written for a new message in ${conversation}: ${String((err as Error)?.message || err)}`,
      "chat:preview", { stack: (err as Error)?.stack });
    const snap = await message.get();
    return snap.exists ? snap.data() ?? null : null;
  }
}
