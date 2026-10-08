// src/utils/groupName.test.ts
//
// A group's name as the screens may use it, and the one limit it has (08.10.2026). The rules take
// only text of 1 to 60 characters; the listeners pass every name through groupNameText, so a name
// that is not text — which any member could write until that day — reaches no screen.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GROUP_NAME_MAX, groupNameText, withGroupName } from './groupName';
import { GROUP_NAME_MAX as SERVER_GROUP_NAME_MAX } from '../../functions/src/senderIdentity';
import { groupNameOf } from './assetSharing';

const POISON = { toString: 0 };

describe('a group’s name on screen', () => {
  it('text stays as it is; anything else is empty, never a crash', () => {
    expect(groupNameText('Family')).toBe('Family');
    expect(groupNameText('')).toBe('');
    for (const v of [{ a: 1 }, POISON, ['x'], 123, true, null, undefined]) expect(groupNameText(v)).toBe('');
    expect(withGroupName({ id: 'g', name: POISON, members: ['a'] })).toEqual({ id: 'g', name: '', members: ['a'] });
    expect(withGroupName({ id: 'g' })).toEqual({ id: 'g', name: '' });
  });

  it('the share badge reads a name that is not text as no name', () => {
    expect(groupNameOf([{ id: 'g', name: POISON as never }], 'g')).toBeNull();
    expect(groupNameOf([{ id: 'g', name: 123 as never }], 'g')).toBeNull();
    expect(groupNameOf([{ id: 'g', name: ' Family ' }], 'g')).toBe('Family');
  });
});

describe('the one limit, in the three places that hold it', () => {
  it('the app, the server and the rules agree on 60', () => {
    expect(GROUP_NAME_MAX).toBe(60);
    expect(SERVER_GROUP_NAME_MAX).toBe(GROUP_NAME_MAX);
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain(`d.get('name', null) is string && d.name.size() <= ${GROUP_NAME_MAX}`);
    expect(rules).toContain(`request.resource.data.groupName.size() <= ${GROUP_NAME_MAX}`);
    // An address, as the server's own check takes it (functions/src/senderIdentity.ts, trustedEmail).
    expect(rules).toContain('request.resource.data.fromEmail.size() <= 254');
  });

  it('both name inputs stop there', () => {
    for (const file of ['src/components/CreateGroupModal.tsx', 'src/components/GroupSettingsModal.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toContain('maxLength={GROUP_NAME_MAX}');
    }
  });
});

describe('every listener of groups that shows a name passes it through here', () => {
  const uses: [string, string][] = [
    ['src/screens/CalendarHome.tsx', 'setGroups(fetchedGroups.map(withGroupName))'],
    ['src/screens/Chat.tsx', 'setGroups(docs.map(withGroupName))'],
    ['src/screens/Wallet.tsx', 'name: groupNameText(g.name) ||'],
    ['src/warlordPvp/pvpApi.ts', 'name: groupNameText(d.name) ||'],
    ['src/screens/Admin.tsx', 'setGroups((g.value.groups || []).map(withGroupName))'],
    ['src/screens/Admin.tsx', 'groups: Array.isArray(u?.groups) ? u.groups.map(withGroupName)'],
  ];
  it.each(uses)('%s', (file, line) => {
    expect(readFileSync(file, 'utf8')).toContain(line);
  });

  it('and a name that was not text shows on the calendar’s pill as "Group", not as nothing', () => {
    expect(readFileSync('src/screens/CalendarHome.tsx', 'utf8')).toContain("{group.name || t('group', language)}");
  });
});
