// functions/src/pushTokens.ts
//
// Which addresses one push call proved dead (notify.ts).
//
// FCM's v1 API answers INVALID_ARGUMENT both for a token that is not a token (or no longer is one)
// and for a MESSAGE it refuses: a field it does not accept, a value of the wrong type, a payload over
// its size. The Admin SDK maps both to `messaging/invalid-argument` (lib/utils/error.js,
// MESSAGING_SERVER_TO_CLIENT_CODE), and the legacy `invalid-registration-token` no longer comes back
// from a v1 send. So reading every `invalid-argument` as a dead token, as notify() did, meant that one
// malformed message, from any caller added later, would unsubscribe EVERY recipient of it at once,
// silently.
//
// One call sends one message to all its tokens. So when any of them was delivered, the message was
// fine, and an `invalid-argument` beside it is about its token. When none was, nothing in the call
// says which of the two it is: the answer has to come from elsewhere, and notify() asks FCM to
// validate the same message without delivering it (a dry run). Not from counting: two refused tokens
// are no evidence against the message when both are one person's, who stopped using two devices
// (the review, 01.11.2026).
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).

export interface SendResult {
  success: boolean;
  /** The error's `code`, as the Admin SDK reports it (`messaging/...`). */
  code?: string;
}

/** These name the address itself as gone, whatever happened to the message. */
const GONE = ["registration-token-not-registered", "invalid-registration-token"];

export interface DeadTokens {
  /** Indexes into the call's tokens. */
  dead: number[];
  /** Refused as `invalid-argument` with nothing proving the message fine: ask a dry run. */
  unproven: boolean;
}

/** `messageValid`: a dry run of the same message passed, so an `invalid-argument` is its token's. */
export function deadTokens(results: readonly SendResult[], messageValid = false): DeadTokens {
  const proven = messageValid || results.some((r) => r.success);
  const dead: number[] = [];
  let refused = 0;
  results.forEach((r, i) => {
    if (r.success) return;
    const code = typeof r.code === "string" ? r.code : "";
    if (GONE.some((g) => code.includes(g))) {
      dead.push(i);
    } else if (code.includes("invalid-argument")) {
      refused++;
      if (proven) dead.push(i);
    }
  });
  return { dead, unproven: !proven && refused > 0 };
}

/** What a dry run of the message said, by the error it threw (none: `"valid"`). */
export function dryRunVerdict(error: unknown): "valid" | "refused" | "unknown" {
  if (error === undefined || error === null) return "valid";
  const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
  // The message itself: refused by FCM, or by the SDK before it left. Anything else (a quota, an
  // outage, credentials) says nothing about the message, so it decides nothing.
  return code.includes("invalid-argument") || code.includes("invalid-payload") ? "refused" : "unknown";
}
