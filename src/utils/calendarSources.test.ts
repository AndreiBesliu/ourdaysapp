// src/utils/calendarSources.test.ts
//
// Two things the calendar screen got wrong (audit A.9, 24.09.2026), plus the group-rename message.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reconciledActiveGroup, sourceFlags } from './calendarSources';

describe('a group that is gone does not stay selected', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];

  it('falls back to the personal calendar when the selected group is no longer in the list', () => {
    expect(reconciledActiveGroup('g-deleted', groups)).toBe('personal');
    expect(reconciledActiveGroup('g1', [])).toBe('personal'); // left the only group
  });

  it('leaves a group that still exists, and the personal tab, alone', () => {
    expect(reconciledActiveGroup('g2', groups)).toBe('g2');
    expect(reconciledActiveGroup('personal', [])).toBe('personal');
  });
});

describe('one listener loading does not hide another failing', () => {
  it('a success from one source keeps a failure from another', () => {
    // The defect: the "your events" query loading cleared the warning that the ASSIGNED events
    // had not loaded.
    const f = sourceFlags(['main', 'assigned', 'invited'] as const);
    expect(f.fail('assigned')).toBe(true);
    expect(f.ok('main')).toBe(true);
    expect(f.ok('invited')).toBe(true);
  });

  it('and clears only when the failing source itself recovers', () => {
    const f = sourceFlags(['main', 'assigned'] as const);
    f.fail('main');
    f.fail('assigned');
    expect(f.ok('main')).toBe(true);
    expect(f.ok('assigned')).toBe(false);
  });
});

describe('a failed rename says it was a rename', () => {
  // A source pin — the modal cannot be mounted here. It said "the group could not be deleted"
  // (or left), and filed itself in the error log under delete/leave.
  const src = readFileSync(resolve(process.cwd(), 'src/components/GroupSettingsModal.tsx'), 'utf8');
  const rename = src.slice(src.indexOf('const handleRename'), src.indexOf('const handleRemoveMember'));

  it('shows the rename message and logs under rename', () => {
    expect(rename).toMatch(/t\('renameGroupFailed', language\)/);
    expect(rename).toMatch(/context: 'GroupSettingsModal\.rename'/);
    expect(rename).not.toMatch(/deleteGroupFailed|leaveGroupFailed/);
  });
});
