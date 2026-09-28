// src/utils/falseUi.test.ts
//
// "UI fals" from the backlog, chosen by Andrei on 28.09.2026: things on screen that pretended, and
// things in the code that nothing could reach. Held on the source (no DOM in this suite).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const home = read('src/screens/CalendarHome.tsx');
const settings = read('src/components/GroupSettingsModal.tsx');

describe('pull-to-refresh', () => {
  it('is gone: it spun for a second and refreshed nothing', () => {
    expect(home).not.toMatch(/onTouchStart=|onTouchMove=|onTouchEnd=/);
    expect(home).not.toMatch(/pullDistance|isRefreshing|RefreshCw/);
    expect(home).not.toContain('Simulate refresh');
  });

  it('and <main> carries no transform, so it is not the containing block of fixed elements', () => {
    // The element, not the comment that mentions it (a `<main>` in prose matched first once).
    const mains = home.match(/<main className=[^>]*>/g) || [];
    expect(mains).toHaveLength(1);
    expect(mains[0]).not.toMatch(/style=|transform/);
  });
});

describe('leaving or deleting a group', () => {
  it('group settings hand it to LeaveGroupModal, which asks which events to keep', () => {
    expect(settings).toMatch(/onClick=\{onLeaveOrDelete\}/);
    // Settings no longer leave or delete by themselves, without a keep-list.
    expect(settings).not.toContain('deleteGroupCascade');
    expect(settings).not.toMatch(/members: arrayRemove\(auth\.currentUser\.uid\)/);
  });

  it('and the calendar opens it — the modal that nothing used to open', () => {
    expect(home).toContain('onLeaveOrDelete={() => { setIsGroupSettingsOpen(false); setIsLeaveGroupModalOpen(true); }}');
    expect(home.match(/setIsLeaveGroupModalOpen\(true\)/g)).toHaveLength(1);
    expect(home).toMatch(/<LeaveGroupModal\s+isOpen=\{isLeaveGroupModalOpen\}/);
  });
});

describe('event invitations', () => {
  it('no listener for an `inviteeId` nothing writes, and no card that could never appear', () => {
    // A query argument, not the comment that records the removal.
    expect(home).not.toMatch(/,\s*where\('inviteeId'/);
    expect(home).not.toMatch(/pendingInvites\b|handleAcceptInvite|handleDeclineInvite|respondToEventInvite/);
    expect(home).toContain("sourceFlags(['main', 'assigned'] as const)");
  });

  it('and still nothing writes it — if something starts to, this cleanup needs revisiting', () => {
    // A write is an object key: `inviteeId: …`. Optional type fields (`inviteeId?: …`) are not.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'lib') walk(p); continue; }
        if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(resolve(process.cwd(), 'src'));
    walk(resolve(process.cwd(), 'functions/src'));
    const writers = files.filter((f) => /\binviteeId\s*:/.test(readFileSync(f, 'utf8')));
    expect(writers).toEqual([]);
    expect(files.length).toBeGreaterThan(150);
  });
});
