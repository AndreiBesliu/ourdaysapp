// src/utils/chatWindow.test.ts
//
// The chat's window of live messages and the typing throttle (utils/chatWindow.ts), and their wiring
// in GroupChatWidget. Chosen by Andrei from the backlog, 28.09.2026.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHAT_PAGE, TYPING_FRESH_MS, TYPING_REFRESH_MS, mayHaveOlder, typingWriteDue, windowToReach,
  anchorStep, pinnedInOrder, type ScrollAnchor,
} from './chatWindow';

describe('the window', () => {
  it('is a page of a hundred', () => {
    expect(CHAT_PAGE).toBe(100);
  });

  it('may have older messages only when it is full', () => {
    expect(mayHaveOlder(100, 100)).toBe(true);
    expect(mayHaveOlder(99, 100)).toBe(false);
    expect(mayHaveOlder(23, 100)).toBe(false); // the largest conversation on live, 28.09
    expect(mayHaveOlder(200, 200)).toBe(true);
  });

  it('reaches a message by whole pages, never shrinking', () => {
    expect(windowToReach(1, 100)).toBe(100);
    expect(windowToReach(100, 100)).toBe(100);
    expect(windowToReach(101, 100)).toBe(200);
    expect(windowToReach(250, 100)).toBe(300);
    expect(windowToReach(50, 300)).toBe(300);
    expect(windowToReach(0, 100)).toBe(100);
    expect(windowToReach(-5, 100)).toBe(100);
  });
});

describe('the typing throttle', () => {
  it('refreshes before readers let the mark go stale', () => {
    expect(TYPING_REFRESH_MS).toBeLessThan(TYPING_FRESH_MS);
  });

  it('writes on the first keystroke, and again only after the refresh interval', () => {
    expect(typingWriteDue(null, 1000)).toBe(true);
    expect(typingWriteDue(1000, 1000 + TYPING_REFRESH_MS - 1)).toBe(false);
    expect(typingWriteDue(1000, 1000 + TYPING_REFRESH_MS)).toBe(true);
  });

  it('ten seconds of steady typing: a handful of writes instead of one per key, and never stale', () => {
    let last: number | null = null;
    let writes = 0;
    let worstAge = 0;
    for (let now = 0; now <= 10_000; now += 150) { // a keystroke every 150 ms
      if (typingWriteDue(last, now)) { last = now; writes++; }
      worstAge = Math.max(worstAge, now - (last as number));
    }
    expect(writes).toBeLessThanOrEqual(5); // it was 67
    expect(worstAge).toBeLessThan(TYPING_FRESH_MS);
  });
});

describe('anchorStep', () => {
  const now = 1_000;
  const older: ScrollAnchor = { convId: 'c1', id: 'top', block: 'start', waitForGrowth: true, until: now + 10_000 };
  const pin: ScrollAnchor = { convId: 'c1', id: 'p', block: 'center', waitForGrowth: false, until: now + 10_000 };

  it('no anchor, another conversation, or expired: the usual end', () => {
    expect(anchorStep(null, 'c1', 'x', false, now)).toBe('none');
    expect(anchorStep(older, 'c2', 'x', true, now)).toBe('none');
    expect(anchorStep(older, 'c1', 'x', true, now + 10_001)).toBe('none');
  });

  it('"load older": waits while the old top is still first — a cached first answer must not jump to the end', () => {
    expect(anchorStep(older, 'c1', 'top', true, now)).toBe('wait');
    expect(anchorStep(older, 'c1', 'newFirst', true, now)).toBe('scroll');
  });

  it('a pinned message: waits until it is rendered, then scrolls', () => {
    expect(anchorStep(pin, 'c1', 'a', false, now)).toBe('wait');
    expect(anchorStep(pin, 'c1', 'a', true, now)).toBe('scroll');
  });
});

describe('pinnedInOrder', () => {
  const at = (ms: number) => ({ toMillis: () => ms });
  it('drops deleted pins and orders the rest oldest first; a pending one goes last', () => {
    const out = pinnedInOrder([
      { id: 'b', createdAt: at(20) },
      { id: 'gone', createdAt: at(5), isDeleted: true },
      { id: 'pending', createdAt: null },
      { id: 'a', createdAt: at(10) },
    ]);
    expect(out.map((d) => d.id)).toEqual(['a', 'b', 'pending']);
  });
});

describe('GroupChatWidget uses them', () => {
  // No DOM in this suite and the widget needs Firestore, so the wiring is held on the source.
  // Line endings normalised: a fresh Windows checkout writes CRLF, and the patterns below anchor on `\n`.
  const src = readFileSync(resolve(process.cwd(), 'src/components/GroupChatWidget.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const effect = /const q = query\([\s\S]*?\}, \[convId, basePath, windowSize\]\);/.exec(src);

  it('listens to the newest window only', () => {
    expect(src).toMatch(/collection\(db, `\$\{basePath\}\/messages`\),\s*orderBy\('createdAt', 'asc'\),\s*limitToLast\(windowSize\),/);
  });

  it('is not re-created on open and close, and reads open / lastRead through refs', () => {
    expect(effect, 'the listener effect, keyed on conversation and window').toBeTruthy();
    const body = effect![0];
    expect(body).toContain('if (!openRef.current) {');
    expect(body).toContain('m.createdAt.toMillis() > lastReadRef.current');
    expect(body).not.toMatch(/\bif \(!open\)/);
    expect(src).not.toContain('}, [convId, open]);');
  });

  it('pinned messages come from their own query, not from the window', () => {
    expect(effect![0]).toContain("where('isPinned', '==', true)");
    expect(src).toContain('const pinnedMessages = pinnedInOrder(pinnedDocs);');
    expect(src).not.toMatch(/messages\.filter\(m => m\.isPinned/);
  });

  it('the typing mark is written through the throttle, and the throttle resets when the mark is cleared', () => {
    const typing = /const handleTyping = [\s\S]*?\n  };\n/.exec(src)![0];
    expect(typing).toMatch(/if \(typingWriteDue\(typingWrittenAtRef\.current, now\)\) \{\s*typingWrittenAtRef\.current = now;\s*setDoc\(/);
    expect(typing.match(/setDoc\(/g)).toHaveLength(1);
    expect(typing).toMatch(/setTimeout\(\(\) => \{\s*typingWrittenAtRef\.current = null;\s*deleteDoc\(/);
    // Sending clears the mark too, so the next keystroke writes at once.
    expect(src).toMatch(/if \(typingTimeoutRef\.current\) clearTimeout\(typingTimeoutRef\.current\);\s*typingWrittenAtRef\.current = null;\s*deleteDoc\(/);
  });

  it('readers use the same freshness the throttle is built on', () => {
    expect(src).toContain('(now - d.updatedAt.toMillis()) < TYPING_FRESH_MS)');
  });

  it('"load older" is offered whenever the window is full', () => {
    expect(src).toMatch(/\{messages\.length > 0 && mayHaveOlder\(messages\.length, windowSize\) && \(\s*<button\s+type="button"\s+onClick=\{loadOlder\}/);
  });

  it('the jump to the end happens only when no anchor is waiting', () => {
    expect(src).toMatch(/if \(step === 'scroll'\) \{[\s\S]*?\} else if \(step === 'none'\) \{\s*anchorRef\.current = null;\s*messagesEndRef\.current\?\.scrollIntoView\(\{ behavior: 'smooth' \}\);/);
    expect(src.match(/messagesEndRef\.current\?\.scrollIntoView/g)).toHaveLength(1);
  });
});
