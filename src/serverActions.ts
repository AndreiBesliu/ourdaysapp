import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// Server-side actions that create documents owned by ANOTHER user — these can't
// be client writes anymore (Firestore now requires ownerId == auth.uid on
// create), so they go through Cloud Functions that validate permissions and
// write via the Admin SDK. These throw on failure (callers handle it).

// Single-occurrence override of a recurring event (keeps the original owner).
export async function createEventOverride(params: {
  parentId: string;
  overrideDate: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "createEventOverride");
  await fn(params);
}

// Duplicate an owned asset to a recipient who shares a group with you.
export async function transferAssetCopy(params: {
  assetId: string;
  recipientId: string;
}): Promise<void> {
  const fn = httpsCallable(getFunctions(app), "transferAssetCopy");
  await fn(params);
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
