// src/utils/uploadLimits.test.ts
//
// `uploadLimits.ts` holds a COPY of numbers that are actually enforced in `storage.rules`. A copy
// of a number in another file is the kind of thing that stops being true without anybody noticing
// — and the way it stops being true here is silent: the client would let a file through that
// Storage then refuses, which is precisely the failure the constants were added to prevent.
//
// So this reads the rules and compares. It parses by BRACE MATCHING rather than by a regex over
// the file, because that file is two-thirds prose: a line-based pattern gets its answers from the
// comments. Every string it looks at is inside a `match` block's body.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { limitForPath, checkUpload, checkChatImage, describeBytes, IMAGE_MAX_BYTES, AUDIO_MAX_BYTES } from './uploadLimits';

const RULES = readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8');

/** Strip `//` comments so prose cannot answer a question about code. */
function code(text: string): string {
  return text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

/**
 * The body of the block starting at `from`, found by counting braces.
 *
 * The opening brace is NOT simply the next `{`: a rule path contains braces of its own —
 * `match /assets/{uid}/{path=**} {`. Taking the first one returned the body `uid`, which
 * contains no `allow` line, so every folder looked unwritable and the comparison below ran over
 * an empty list while reporting success. The block's brace is the one preceded by whitespace;
 * the path's are preceded by `/`.
 */
function bodyAt(text: string, from: number): { body: string; end: number } {
  let open = text.indexOf('{', from);
  while (open > 0 && !/\s/.test(text[open - 1])) open = text.indexOf('{', open + 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  throw new Error('unbalanced braces in storage.rules');
}

/** `{ root: body }` for every `match /<root>/...` block, nested ones included. */
function matchBlocks(): Record<string, string> {
  const text = code(RULES);
  const out: Record<string, string> = {};
  const re = /match\s+\/([^/\s{]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = bodyAt(text, m.index).body;
  return out;
}

/** The size ceiling and type prefix a fragment of rule text enforces. */
function constraintsIn(fragment: string): { maxBytes?: number; typePrefix?: string } {
  const size = /request\.resource\.size\s*<\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(fragment);
  const type = /contentType\.matches\('([a-z]+)\/\.\*'\)/.exec(fragment);
  return {
    maxBytes: size ? Number(size[1]) * 1024 * 1024 : undefined,
    typePrefix: type ? `${type[1]}/` : undefined,
  };
}

describe('the rules file parses the way this test assumes', () => {
  // A parser that silently found nothing would make every assertion below vacuously true.
  it('finds the blocks, and the helper they lean on', () => {
    const blocks = matchBlocks();
    expect(Object.keys(blocks)).toEqual(
      expect.arrayContaining(['chat-images', 'chat-audio', 'profiles', 'assets']),
    );
    // A body must look like a rule body. The first version of this parser returned the path
    // fragment `uid` here and nothing noticed.
    for (const [root, body] of Object.entries(blocks)) {
      if (root === 'b') continue;
      expect(body, `/${root} parsed to ${JSON.stringify(body)}`).toMatch(/allow\s/);
    }
    expect(constraintsIn(/function isImage\(\)[\s\S]*?\n {4}\}/.exec(code(RULES))![0]))
      .toEqual({ maxBytes: IMAGE_MAX_BYTES, typePrefix: 'image/' });
  });

  it('reads code, not comments', () => {
    // storage.rules explains "size/type gated" and quotes patterns in prose. Feeding the parser a
    // comment that states a DIFFERENT number must not move its answer.
    expect(constraintsIn(code("// request.resource.size < 99 * 1024 * 1024\nallow read;")))
      .toEqual({ maxBytes: undefined, typePrefix: undefined });
  });
});

describe('the client limits equal the rules', () => {
  const blocks = matchBlocks();
  const isImageBody = /function isImage\(\)[\s\S]*?\n {4}\}/.exec(code(RULES))![0];
  const imageLimits = constraintsIn(isImageBody);

  /** What the rules enforce for a folder: inline, or via `isImage()`. */
  function ruleLimitFor(root: string): { maxBytes?: number; typePrefix?: string } {
    const body = blocks[root];
    const own = constraintsIn(body);
    if (own.maxBytes !== undefined) return own;
    return /isImage\(\)/.test(body) ? imageLimits : {};
  }

  const WRITABLE = Object.keys(blocks).filter(
    (root) => root !== 'b' && !root.startsWith('{') && /allow\s+[a-z,\s]*(write|create)/.test(blocks[root]),
  );

  // `it.each([])` runs NOTHING and reports a pass. The count is asserted separately so an empty
  // list is a failure rather than a green run over no cases.
  it('found folders to compare', () => expect(WRITABLE.length).toBe(7));

  it.each(WRITABLE)('%s', (root) => {
    const fromRules = ruleLimitFor(root);
    const fromClient = limitForPath(`${root}/anything/file.bin`);
    expect(fromClient, `storage.rules can be written to at /${root}, but uploadLimits.ts has no `
      + 'entry for it — an upload there would be size-checked by nothing.').not.toBeNull();
    expect(fromClient!.maxBytes).toBe(fromRules.maxBytes);
    expect(fromClient!.typePrefix).toBe(fromRules.typePrefix);
  });

  it('knows about every writable folder and no others', () => {
    // Both directions. "Every folder in the rules is known here" leaves room for an entry here
    // that the rules no longer have — which reads as a guarantee and is not one.
    const known = ['assets', 'events', 'checklists', 'profiles', 'backgrounds', 'chat-images', 'chat-audio'];
    expect([...WRITABLE].sort()).toEqual([...known].sort());
    for (const root of known) expect(limitForPath(`${root}/x`), root).not.toBeNull();
  });
});

describe('checkUpload', () => {
  it('refuses exactly the limit, because the rule says `<` and not `<=`', () => {
    expect(checkUpload('chat-images/g/u_1_a.jpg', IMAGE_MAX_BYTES - 1, 'image/jpeg')).toBeNull();
    expect(checkUpload('chat-images/g/u_1_a.jpg', IMAGE_MAX_BYTES, 'image/jpeg'))
      .toEqual({ kind: 'too-large', maxBytes: IMAGE_MAX_BYTES, size: IMAGE_MAX_BYTES });
  });

  it('uses the audio ceiling for audio, which is larger', () => {
    expect(checkUpload('chat-audio/g/u_1.webm', 12 * 1024 * 1024, 'audio/webm')).toBeNull();
    expect(checkUpload('chat-audio/g/u_1.webm', AUDIO_MAX_BYTES, 'audio/webm')?.kind).toBe('too-large');
    // The same 12 MB as a photo would not be accepted.
    expect(checkUpload('chat-images/g/u_1.jpg', 12 * 1024 * 1024, 'image/jpeg')?.kind).toBe('too-large');
  });

  it('catches a type the rule would refuse', () => {
    expect(checkUpload('chat-images/g/u_1_doc.pdf', 1000, 'application/pdf'))
      .toEqual({ kind: 'wrong-type', typePrefix: 'image/', contentType: 'application/pdf' });
  });

  it('does not invent a type when there is none', () => {
    // A Uint8Array has no type. Refusing it here would be a new way to fail, not a guard.
    expect(checkUpload('chat-images/g/u_1_a.jpg', 1000, undefined)).toBeNull();
    expect(checkUpload('chat-images/g/u_1_a.jpg', 1000, '')).toBeNull();
  });

  it('says nothing about a path this app does not upload to', () => {
    expect(limitForPath('somewhere-else/x')).toBeNull();
    expect(checkUpload('somewhere-else/x', 900 * 1024 * 1024, 'image/jpeg')).toBeNull();
  });

  it('is not fooled by a leading slash or a bare folder name', () => {
    expect(limitForPath('/chat-audio/g/f.webm')?.maxBytes).toBe(AUDIO_MAX_BYTES);
    expect(limitForPath('chat-images')?.maxBytes).toBe(IMAGE_MAX_BYTES);
    expect(limitForPath(null)).toBeNull();
    expect(limitForPath(42)).toBeNull();
  });

  it('does not answer for a folder that merely starts with a known name', () => {
    expect(limitForPath('chat-images-old/g/f.jpg')).toBeNull();
    expect(limitForPath('assets2/x')).toBeNull();
  });
});

describe('describeBytes', () => {
  it('names a size the way the person sees it on their phone', () => {
    expect(describeBytes(12 * 1024 * 1024)).toBe('12 MB');
    expect(describeBytes(IMAGE_MAX_BYTES)).toBe('10 MB');
    expect(describeBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(describeBytes(300 * 1024)).toBe('300 KB');
    expect(describeBytes(10)).toBe('1 KB'); // never "0 KB" for a file that exists
  });
});

describe('checkChatImage', () => {
  it('answers for a chat photo without the caller naming a path', () => {
    expect(checkChatImage({ size: 12 * 1024 * 1024, type: 'image/jpeg' })?.kind).toBe('too-large');
    expect(checkChatImage({ size: 2 * 1024 * 1024, type: 'image/jpeg' })).toBeNull();
    expect(checkChatImage({ size: 10, type: 'application/pdf' })?.kind).toBe('wrong-type');
  });

  it('agrees with the path form, since one is meant to stand in for the other', () => {
    for (const size of [1, IMAGE_MAX_BYTES - 1, IMAGE_MAX_BYTES, 99 * 1024 * 1024]) {
      expect(checkChatImage({ size, type: 'image/jpeg' }), String(size))
        .toEqual(checkUpload('chat-images/g/u_1_a.jpg', size, 'image/jpeg'));
    }
  });
});
