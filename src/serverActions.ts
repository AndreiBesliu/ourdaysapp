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

// Emails that see the Admin entry client-side (cosmetic only — the /admin screen
// and every admin callable re-check server-side). Keep in sync with the
// functions' BOOTSTRAP_ADMIN_EMAILS.
export const ADMIN_BOOTSTRAP_EMAILS = ["besliandrei@gmail.com"];
