import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// Server-side actions that create documents owned by ANOTHER user — these can't
// be client writes anymore (Firestore now requires ownerId == auth.uid on
// create), so they go through Cloud Functions that validate permissions and
// write via the Admin SDK. These throw on failure (callers handle it).

// Single-occurrence override of a recurring event (keeps the original owner).
// Returns the new document's id. Callers that only wanted the side effect can ignore it, but
// EventDetailsModal needs it: after materialising an occurrence it has to send the rest of that
// interaction to the override rather than to the synthetic key it was rendered from.
export async function createEventOverride(params: {
  parentId: string;
  overrideDate: string;
  data: Record<string, unknown>;
}): Promise<string> {
  const fn = httpsCallable(getFunctions(app), "createEventOverride");
  const res = await fn(params);
  return (res.data as { id: string }).id;
}

// Duplicate an owned asset to a recipient who shares a group with you.
export async function transferAssetCopy(params: {
  assetId: string;
  recipientId: string;
  /** "copy" keeps the original with you; "move" hands it over and deletes yours. */
  mode?: 'copy' | 'move';
}): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "transferAssetCopy");
  await fn(params);
}

// Delete a group and everything hanging off it.
//
// This cannot be a client loop: `allow delete` on events is owner-only, so the first event
// belonging to another member throws and leaves the group half-torn-down. The server deletes
// only the CALLER's own unkept events and re-parents everyone else's to personal.
export async function deleteGroupCascade(params: {
  groupId: string;
  keepEventIds?: string[];
}): Promise<{ deleted: number; freed: number; invites: number; messages: number }> {
  const fn = httpsCallable(getFunctions(app), "deleteGroupCascade");
  const res = await fn(params);
  return res.data as { deleted: number; freed: number; invites: number; messages: number };
}

// Accept or decline a friend request (must write both users' friend lists).
export async function respondToFriendRequest(params: {
  requestId: string;
  accept: boolean;
}): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "respondToFriendRequest");
  await fn(params);
}

// ── Warlord PvP (server-authoritative; see functions/src/index.ts) ──

// Create a PvP challenge. The server validates the challenger's army and stashes it
// in an Admin-only doc (hidden from the opponent until they commit), then writes the
// public 'waiting' game doc. Returns the new gameId.
export async function createWarlordChallenge(params: {
  groupId?: string; // optional — Warlord is one world; a group only tags the battle
  opponentUid: string;
  unitIds: string[];
  combatants: unknown[];
}): Promise<{ gameId: string }> {
  const fn = httpsCallable(getFunctions(app), "createWarlordChallenge");
  return (await fn(params)).data as { gameId: string };
}

// Accept a Warlord PvP challenge: locks in the defender's deployment; the server
// generates the seed, builds the authoritative BattleState and flips to 'playing'.
export async function acceptWarlordChallenge(params: {
  gameId: string;
  unitIds: string[];
  combatants: unknown[]; // DeployCombatantClaim[] — validated server-side
}): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "acceptWarlordChallenge");
  await fn(params);
}

// Submit one battle command; the server engine validates and applies it.
// applied:false = the engine judged it illegal — roll back the optimistic state.
export async function submitWarlordCommand(params: {
  gameId: string;
  command: unknown; // Command — validated & rebuilt server-side
}): Promise<{ applied: boolean; finished: boolean }> {
  const fn = httpsCallable(getFunctions(app), "submitWarlordCommand");
  return (await fn(params)).data as { applied: boolean; finished: boolean };
}

// Retreat (= concede) an active battle, or decline/cancel a waiting challenge.
export async function forfeitWarlordBattle(gameId: string): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "forfeitWarlordBattle");
  await fn({ gameId });
}

// Claim the win when the opponent has stopped playing (server checks the elapsed time).
export async function claimWarlordTimeout(gameId: string): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "claimWarlordTimeout");
  await fn({ gameId });
}

// Remove a friend (mutual — edits both users' friend lists).
export async function removeFriend(friendUid: string): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "removeFriend");
  await fn({ friendUid });
}

// Accept a group invite (adds you to the group's members — a non-member can't
// do that under the groups rules, so it runs server-side).
export async function acceptGroupInvite(inviteId: string): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "acceptGroupInvite");
  await fn({ inviteId });
}

// ── Admin backend (all server-gated by assertAdmin) ──
export async function adminCheck(): Promise<boolean> {
  const fn = httpsCallable(getFunctions(app), "adminCheck");
  const res = await fn({});
  return (res.data as { isAdmin?: boolean })?.isAdmin === true;
}
export async function adminGetStats(): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminGetStats");
  return (await fn({})).data;
}
export async function adminListProfiles(): Promise<{ profiles: any[]; count: number }> {
  const fn = httpsCallable(getFunctions(app), "adminListProfiles");
  return (await fn({})).data as { profiles: any[]; count: number };
}
export async function adminListAdmins(): Promise<{ admins: any[] }> {
  const fn = httpsCallable(getFunctions(app), "adminListAdmins");
  return (await fn({})).data as { admins: any[] };
}
export async function adminSetAdmin(params: { uid?: string; email?: string; makeAdmin: boolean }): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "adminSetAdmin");
  await fn(params);
}
export async function adminGetHealth(): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminGetHealth");
  return (await fn({})).data;
}
export async function adminGetUser(uid: string): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminGetUser");
  return (await fn({ uid })).data;
}
export async function adminModerateUser(uid: string, action: 'enable' | 'disable' | 'forceVerify' | 'delete'): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminModerateUser");
  return (await fn({ uid, action })).data;
}
export async function adminBroadcast(params: { target: string; title: string; body?: string }): Promise<{ created: number }> {
  const fn = httpsCallable(getFunctions(app), "adminBroadcast");
  return (await fn(params)).data as { created: number };
}
export async function adminListGroups(): Promise<{ groups: any[] }> {
  const fn = httpsCallable(getFunctions(app), "adminListGroups");
  return (await fn({})).data as { groups: any[] };
}
export async function adminGetGrowth(): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminGetGrowth");
  return (await fn({})).data;
}

// Emails that see the Admin entry client-side (cosmetic only — the /admin screen
// and every admin callable re-check server-side). Keep in sync with the
// functions' BOOTSTRAP_ADMIN_EMAILS.
export const ADMIN_BOOTSTRAP_EMAILS = ["besliandrei@gmail.com"];

// ── The assistant's visibility preview ─────────────────────────────────────────────────
//
// Slice 1 of the cross-group assistant. Calls no model and persists nothing: it answers
// "what would the assistant be able to see for me, in this period?" as counts and titles, so
// the privacy claim can be checked against the calendar on screen before a token is spent.
//
// Give it either an explicit day range or a month. Both are refused rather than guessed if
// malformed — a guessed period answers about a different month than the one asked about, and
// that is a failure the caller can never see.
export interface ScopePreview {
  period: { fromDay: string; toDay: string; days: number };
  scope: { groups: number; totalGroups: number; truncated: boolean };
  events: {
    count: number;
    complete: boolean;
    /**
     * The PREVIEW was capped, which is a different thing from `complete`.
     *
     * `complete` says whether the Firestore read was cut. The server then slices the result to
     * 200 rows for the wire, and that second truncation used to contribute to nothing at all — so
     * a caller could be handed 200 rows next to `count: 900` and `complete: true`, and the screen,
     * which builds its day list purely from `preview`, simply did not show the rest.
     */
    previewTruncated?: boolean;
    preview: {
      day: string; title: string; isTask: boolean;
      scopeLabel: string; outOfScope: boolean; virtual: boolean;
    }[];
    unavailable?: string;
  };
  chat: { count: number; complete: boolean; unavailable?: string };
  assets: { count: number; complete: boolean };
  // Declared to match what the server actually sends. It used to say `unavailable?` alone —
  // a field the server no longer emits on the happy path — while omitting `complete` and
  // `preview`, which it does send. The `as ScopePreview` cast below hid the difference, so the
  // type was documentation that disagreed with the wire.
  expenses: {
    count: number;
    complete: boolean;
    previewTruncated?: boolean;
    preview: { day: string; amount: number; description: string; scopeLabel: string }[];
    /** Present only when the source could not be served at all — a CODE, translated by the client. */
    unavailable?: string;
  };
}

export async function aiPreviewScope(
  input: { from: string; to: string } | { year: number; month: number },
): Promise<ScopePreview> {
  const fn = httpsCallable(getFunctions(app), "aiPreviewScope");
  return (await fn(input)).data as ScopePreview;
}

// ── AI spend (admin) ───────────────────────────────────────────────────────────────────
export interface AiSpend {
  daily: { date: string; calls: number; failures: number; promptTokens: number; completionTokens: number; usd: number }[];
  totals: { today: number; week: number; month: number };
  byFeature: { feature: string; calls: number; failures: number; usd: number }[];
  topUsers: { uid: string; calls: number; usd: number }[];
}

export async function adminGetAiSpend(): Promise<AiSpend> {
  const fn = httpsCallable(getFunctions(app), "adminGetAiSpend");
  return (await fn({})).data as AiSpend;
}

export interface AiLedgerRow {
  id: string; uid: string; feature: string; model: string;
  ok: boolean | null; errorCode: string | null;
  promptTokens: number; completionTokens: number; costUsd: number; computeMs: number;
}

export async function adminGetAiLedger(
  input: { date?: string; uid?: string } = {},
): Promise<{ date: string; rows: AiLedgerRow[]; truncated: boolean }> {
  const fn = httpsCallable(getFunctions(app), "adminGetAiLedger");
  return (await fn(input)).data as { date: string; rows: AiLedgerRow[]; truncated: boolean };
}

/**
 * Backfill the scoping fields `expenses` never had. DRY RUN unless `apply` is true — the server
 * writes nothing otherwise, and never guesses a group for an author who is in several.
 */
export async function adminBackfillExpenses(apply = false): Promise<{
  dryRun: boolean; total: number; alreadyScoped: number; noPaidBy: number;
  wouldSetOwnerOnly: number; wouldSetOwnerAndGroup: number;
  ambiguous: { id: string; paidBy: string; groups: number }[]; applied: number;
}> {
  const fn = httpsCallable(getFunctions(app), "adminBackfillExpenses");
  return (await fn({ apply })).data as any;
}
