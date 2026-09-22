// src/utils/uploadName.test.ts
//
// The name a chat upload lands under has to satisfy a Storage rule that cannot read Firestore.
// Membership is unknowable there; OWNERSHIP is not, and the uid prefix is what makes it askable.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { sanitiseUploadName, chatUploadPath } from './uploadName';

describe('the uploader is named first', () => {
  it('puts the uid at the very start, which is what the rule anchors on', () => {
    expect(chatUploadPath('chat-images', 'group-1', 'uid-alice', 'photo.jpg', 1700000000000))
      .toBe('chat-images/group-1/uid-alice_1700000000000_photo.jpg');
  });

  it('and keeps the path to exactly three segments', () => {
    // The rule matches `chat-images/{convId}/{fileName}` — a single trailing segment. A fourth
    // would stop matching it, so the upload would be refused with nothing to explain why.
    const p = chatUploadPath('chat-audio', 'g', 'u', 'a/b/c.webm', 1);
    expect(p.split('/')).toHaveLength(3);
  });
});

describe('a filename cannot break out of that prefix', () => {
  it('replaces the separator, because an object name is ONE flat string', () => {
    // Firebase has no folders: the slashes are a rendering convention. A `/` in a user's filename
    // silently changes the object's depth.
    expect(sanitiseUploadName('holiday 2026/07.jpg')).toBe('holiday-2026-07.jpg');
  });

  it('keeps the tail when a name is long, because that is the distinguishing part', () => {
    const long = 'IMG_20260922_181245_' + 'x'.repeat(200) + '_final.jpg';
    const out = sanitiseUploadName(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('_final.jpg')).toBe(true);
  });

  it('never returns something empty, or something starting with a separator', () => {
    // An empty final segment makes a path ending in `/`, and a leading `_` is ambiguous against
    // the uid separator the rule matches on.
    for (const bad of ['', '///', '...', '___', '---', null, undefined, 42, {}]) {
      const out = sanitiseUploadName(bad as unknown);
      expect(out.length, String(bad)).toBeGreaterThan(0);
      expect(/^[-_.]/.test(out), String(bad)).toBe(false);
    }
  });

  it('leaves an ordinary name recognisable', () => {
    expect(sanitiseUploadName('receipt-2026.png')).toBe('receipt-2026.png');
  });
});

describe('no chat upload builds its own path', () => {
  // The prefix only protects anything if EVERY upload carries it. A second call site written by
  // hand would be invisible to the tests above and silently unattributed.
  const SRC = resolve(process.cwd(), 'src');

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'warlord') continue;
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) sourceFiles(file, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(file);
    }
    return out;
  }

  /** Template literals that build a `chat-images/` or `chat-audio/` path by hand. */
  function handBuilt(): string[] {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith(join('utils', 'uploadName.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node): void => {
        if ((ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)
             || ts.isStringLiteral(n))
            && /chat-(images|audio)\//.test(n.getText(sf))) {
          hits.push(`${file.slice(SRC.length + 1).replace(/\\/g, '/')}`
            + `:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return hits;
  }

  it('finds none outside the helper', () => {
    expect(
      handBuilt(),
      'Build chat upload paths with chatUploadPath(). A hand-written path omits the uid prefix, '
      + 'and the Storage rule that requires it will refuse the upload with nothing on screen to '
      + 'say why.',
    ).toEqual([]);
  });
});
