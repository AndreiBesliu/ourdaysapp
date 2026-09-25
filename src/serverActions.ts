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
//
// If an override already exists for that date, its id comes back instead of a second override
// being made. `apply: true` is for a caller whose `data` IS the edit (the edit form): it is then
// applied to the existing override. Without it (the details window, which materialises and then
// writes its one change to the returned id), nothing is applied — see the callable.
export async function createEventOverride(params: {
  parentId: string;
  overrideDate: string;
  data: Record<string, unknown>;
  apply?: boolean;
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
export interface ErrorStatusResult {
  ok: boolean;
  written: number;
  skipped: number;
  refused?: { failed: number; unclaimed: number; missing: number };
}
export async function adminSetErrorStatus(
  fingerprints: string[], status: 'new' | 'seen' | 'resolved',
  opts?: { note?: string; onlyIfClaimHolds?: boolean },
): Promise<ErrorStatusResult> {
  const fn = httpsCallable(getFunctions(app), "adminSetErrorStatus");
  return (await fn({
    fingerprints, status, note: opts?.note, onlyIfClaimHolds: opts?.onlyIfClaimHolds === true,
  })).data as ErrorStatusResult;
}
export async function adminGetUser(uid: string): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminGetUser");
  return (await fn({ uid })).data;
}
export async function adminModerateUser(uid: string, action: 'enable' | 'disable' | 'forceVerify' | 'delete'): Promise<any> {
  const fn = httpsCallable(getFunctions(app), "adminModerateUser");
  return (await fn({ uid, action })).data;
}
export async function adminBroadcast(params: { target: string; title: string; body?: string }): Promise<{ created: number; pushed?: number; pruned?: number }> {
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

// (ADMIN_BOOTSTRAP_EMAILS lived here: a hard-coded address deciding who saw the Admin entry.
// The screen now reads the caller's own `admins/{uid}` — see CalendarHome.)

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
  /** The window actually served. The server chooses from a fixed set, so this may not be what was asked. */
  days: number;
  /** NEWEST first. Reverse it before a left-to-right chart or the axis labels lie. */
  daily: { date: string; calls: number; failures: number; promptTokens: number; completionTokens: number; usd: number }[];
  totals: { today: number; week: number; month: number };
  byFeature: { feature: string; calls: number; failures: number; usd: number }[];
  topUsers: { uid: string; calls: number; failures: number; usd: number }[];
  /** What the budget actually resolved to, and where it came from — see functions/src/aiLimits.ts. */
  limits: {
    globalDailyUsd: number; userDailyUsd: number; killSwitch: boolean;
    /** Inputs that were refused and replaced. Non-empty means somebody configured something unusable. */
    clamped: string[];
    source: 'environment' | 'built-in defaults';
  };
  /**
   * Today's spend as the BUDGET sees it — from `ai_budget/_global`, not the daily rollup. It is
   * the number that decides whether the next call is refused, and it runs slightly ahead of the
   * rollup because a call is pre-charged at its ceiling and reconciled down afterwards.
   */
  todayGlobalUsd: number;
  /** False when a day's rollup could not be read. The breakdowns below are then INCOMPLETE. */
  complete: boolean;
}

export async function adminGetAiSpend(days: 7 | 30 = 30): Promise<AiSpend> {
  const fn = httpsCallable(getFunctions(app), "adminGetAiSpend");
  return (await fn({ days })).data as AiSpend;
}

// ── The live AI budget (admin) ────────────────────────────────────────────────────────
export interface AiConfigFields {
  globalDailyUsd: number;
  userDailyUsd: number;
  killSwitch: boolean;
}

/**
 * What the form SENDS. The limits travel as strings on purpose.
 *
 * `Number('')` is `0`, and an empty `<input type="number">` reads `''` — so does `1.` mid-typing,
 * and so does anything the browser considers invalid. Coercing here would turn "I cleared the box
 * to retype it" into "spend nothing today", which is a total AI outage that a non-owner admin
 * cannot undo, because raising a limit is owner-only.
 *
 * `clampAiLimits` on the server already parses digit strings and rejects everything else — that is
 * the whole reason it does not use `Number()`. Sending the string lets the one careful parser do
 * the work instead of a second, careless one in the browser.
 */
export interface AiConfigInput {
  globalDailyUsd: string | number;
  userDailyUsd: string | number;
  killSwitch: boolean;
}

export interface AiConfig {
  /** False until somebody presses Save. Until then the app runs on the compiled defaults. */
  exists: boolean;
  effective: AiConfigFields & { clamped: string[]; source: string };
  updatedAt: string | null;
  updatedByEmail: string;
  /**
   * The document's own stamp disagrees with the newest log row.
   *
   * The Firebase console writes with the Admin SDK, bypassing both the rules and the callable,
   * so this log can never be complete. Rather than present a partial history as a full one, the
   * screen says when the two disagree.
   */
  outsideAdmin: boolean;
  log: {
    id: string; at: string | null; byEmail: string;
    from: AiConfigFields | null; to: AiConfigFields | null;
    requested: Record<string, unknown> | null;
  }[];
}

export async function adminGetAiConfig(): Promise<AiConfig> {
  const fn = httpsCallable(getFunctions(app), "adminGetAiConfig");
  return (await fn({})).data as AiConfig;
}

/**
 * Save the budget. The SERVER owns the bounds and the direction.
 *
 * `clamped` comes back non-empty when the server refused a number and substituted its own — the
 * form must show that rather than redisplaying what was typed, or the screen and the bill tell
 * two stories. A refusal by DIRECTION (raising a limit, or turning the switch off, as a non-owner)
 * arrives as a thrown `permission-denied` with a sentence.
 */
export async function adminSetAiConfig(
  input: AiConfigInput,
): Promise<{
  saved: AiConfigFields; previous: AiConfigFields; clamped: string[]; actor: 'owner' | 'admin';
}> {
  const fn = httpsCallable(getFunctions(app), "adminSetAiConfig");
  return (await fn(input)).data as {
    saved: AiConfigFields; previous: AiConfigFields; clamped: string[]; actor: 'owner' | 'admin';
  };
}

export interface AiLedgerRow {
  id: string; uid: string; feature: string; model: string;
  ok: boolean | null; errorCode: string | null;
  promptTokens: number; completionTokens: number; costUsd: number; computeMs: number;
  /** ISO. Null only for a row written before the column existed. Rows arrive newest-first. */
  at: string | null;
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
// ── Invite links ──────────────────────────────────────────────────────────────
// Bearer invitations that can be sent through any channel. The `invite_links` collection is
// denied to clients outright (the document id IS the secret code, so a readable collection would
// be an enumerable list of every live invitation), which is why all five of these are callables.

export interface InviteLinkRow {
  code: string;
  groupId: string | null;
  groupName: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  revoked: boolean;
}

/**
  * Mint a link. Good for ONE registration — that is the server's constant, not a parameter, so
  * there is deliberately nothing here to raise it with.
  */
export async function createGroupInviteLink(params: {
  groupId?: string | null; days?: number;
}): Promise<{ code: string; maxUses: number; days: number; groupName: string | null }> {
  const fn = httpsCallable(getFunctions(app), "createGroupInviteLink");
  return (await fn(params)).data as any;
}

/**
 * What a link is for, WITHOUT redeeming it.
 *
 * Deliberately usable before sign-in: the join screen has to say who invited you and to what
 * before asking you to create an account. It returns only what a poster would carry.
 */
export async function peekGroupInviteLink(code: string): Promise<{
  valid: boolean; reason: string | null; alreadyJoined: boolean;
  groupName: string | null; invitedBy: string | null;
}> {
  const fn = httpsCallable(getFunctions(app), "peekGroupInviteLink");
  return (await fn({ code })).data as any;
}

/**
 * Join, and become friends with whoever sent it. Requires a signed-in caller.
 *
 * Only `accepted` changed anything. `already` (you used this link before) and `member` (you were
 * already in the group) are answers: nothing was joined, nothing befriended, nothing spent.
 */
export async function redeemGroupInviteLink(code: string): Promise<{
  status: 'accepted' | 'already' | 'member'; groupId: string | null; groupName: string | null;
  invitedBy: string; joinedGroup: boolean;
}> {
  const fn = httpsCallable(getFunctions(app), "redeemGroupInviteLink");
  return (await fn({ code })).data as any;
}

/** Withdraw a link. Redemptions already made stand — this only stops further ones. */
export async function revokeGroupInviteLink(code: string): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "revokeGroupInviteLink");
  await fn({ code });
}

/** The caller's own links, newest first. */
export async function listMyInviteLinks(groupId?: string | null): Promise<InviteLinkRow[]> {
  const fn = httpsCallable(getFunctions(app), "listMyInviteLinks");
  const res = (await fn({ groupId: groupId ?? null })).data as { links: InviteLinkRow[] };
  return res.links || [];
}
// ── Direct chats ──────────────────────────────────────────────────────────────
// Clients cannot create one: `chats` denies create outright, because the question that decides
// it — are these two friends, or in a group together — cannot be asked in a Firestore rule.
export async function openDirectChat(otherUid: string): Promise<{ chatId: string; created: boolean }> {
  const fn = httpsCallable(getFunctions(app), "openDirectChat");
  return (await fn({ otherUid })).data as { chatId: string; created: boolean };
}
