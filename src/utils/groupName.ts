// src/utils/groupName.ts
//
// A group's name, as the screens may use it (08.10.2026). The rules now take only text of 1 to 60
// characters, but a name is shown by every member's calendar on every load, and one that was not
// text — a map, which any member could write until that day — crashed the whole app for the whole
// group, with no way back inside the app. So the listeners — and the Admin screens, which get the
// names from the server — pass every name through here, and anything else reaches them as ''.

/**
 * The longest name a group may have: the server's GROUP_NAME_MAX (functions/src/senderIdentity.ts)
 * and the rules' `groupNameOk`, held equal by src/utils/groupName.test.ts.
 */
export const GROUP_NAME_MAX = 60;

/** The name as text, or '' for anything that is not text. */
export function groupNameText(name: unknown): string {
  return typeof name === 'string' ? name : '';
}

/** A group document with its name made safe to render. */
export function withGroupName<T extends { name?: unknown }>(group: T): T & { name: string } {
  return { ...group, name: groupNameText(group.name) };
}
