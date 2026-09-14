// src/utils/inviteShare.test.ts
//
// The invite modal used to have a "Share invite" button that composed hardcoded English text
// saying "sign up and accept the invite" — and created NO invitation. Whoever received it signed
// up and found nothing waiting for them. So the thing worth pinning is not the wording: it is
// that every channel carries a REAL link, and that the link is built the same way every time.

import { describe, it, expect } from 'vitest';
import {
  availableChannels, buildMessage, canUseNativeShare, channelHref, codeFromPath, fullText, joinUrl,
} from './inviteShare';

const M = buildMessage({
  title: 'Join me on Our Days',
  body: 'Andrei invites you to Family on Our Days.',
  origin: 'https://our-days-2a939.web.app',
  code: 'abc-123_XY',
});

describe('joinUrl', () => {
  it('builds the join path', () => {
    expect(joinUrl('https://x.app', 'code1')).toBe('https://x.app/join/code1');
  });

  it('does not double the slash when the origin has one', () => {
    // `${origin}/join/...` with a trailing slash yields `//join/`, and some routers treat that as
    // a different path — a link that opens a blank page instead of the invitation.
    expect(joinUrl('https://x.app/', 'code1')).toBe('https://x.app/join/code1');
    expect(joinUrl('https://x.app///', 'code1')).toBe('https://x.app/join/code1');
  });

  it('escapes a code so it cannot break out of the path', () => {
    expect(joinUrl('https://x.app', 'a/b?c#d')).toBe('https://x.app/join/a%2Fb%3Fc%23d');
  });
});

describe('every channel carries the link', () => {
  const linked = ['whatsapp', 'telegram', 'email', 'sms'] as const;

  it.each(linked)('%s includes the join URL', (channel) => {
    const href = channelHref(channel, M);
    expect(href).toBeTruthy();
    expect(decodeURIComponent(href!)).toContain(M.url);
  });

  it.each(linked)('%s percent-encodes the body rather than pasting it raw', (channel) => {
    const href = channelHref(channel, M)!;
    // A raw newline or `&` in a URL truncates the message at the first one, silently.
    expect(href).not.toContain('\n');
    expect(href.split('?')[1] || '').not.toContain(' ');
  });

  it('whatsapp uses wa.me with no phone number, so the sender picks the recipient', () => {
    // With a number we would be handling somebody's phone number. With none, WhatsApp opens its
    // own contact picker and we never see one.
    expect(channelHref('whatsapp', M)!.startsWith('https://wa.me/?text=')).toBe(true);
  });

  it('email carries a subject as well as the body', () => {
    const href = channelHref('email', M)!;
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain(M.title);
  });

  it('sms uses the form BOTH platforms parse', () => {
    // iOS wants `sms:&body=`, Android wants `sms:?body=`. This is the one they both accept, and
    // it looks like a typo to anybody who has not hit the disagreement.
    expect(channelHref('sms', M)!.startsWith('sms:?&body=')).toBe(true);
  });

  it('the channels that are not links say so, instead of returning a broken href', () => {
    expect(channelHref('native', M)).toBeNull();
    expect(channelHref('copy', M)).toBeNull();
    expect(channelHref('qr', M)).toBeNull();
  });
});

describe('fullText', () => {
  it('puts the link after the message, separated', () => {
    expect(fullText(M)).toBe(`${M.text}\n\n${M.url}`);
  });

  it('always contains a link — the defect this file exists for', () => {
    expect(fullText(M)).toContain('/join/');
  });
});

describe('availableChannels', () => {
  it('offers the share sheet only when the browser has one', () => {
    // An inert button is worse than an absent one, which is the rule every refusal in this
    // codebase is written under.
    expect(availableChannels(true)[0]).toBe('native');
    expect(availableChannels(false)).not.toContain('native');
  });

  it('always offers the ones that are plain URLs', () => {
    for (const c of ['whatsapp', 'email', 'sms', 'telegram', 'copy', 'qr']) {
      expect(availableChannels(false)).toContain(c);
    }
  });
});

describe('canUseNativeShare', () => {
  it('is true only for a real function', () => {
    expect(canUseNativeShare({ share: () => {} })).toBe(true);
    expect(canUseNativeShare({})).toBe(false);
    expect(canUseNativeShare(undefined)).toBe(false);
    expect(canUseNativeShare(null)).toBe(false);
    // A truthy non-function would pass a `!!nav.share` check and then throw on the click.
    expect(canUseNativeShare({ share: 'yes' as unknown })).toBe(false);
  });
});

describe('codeFromPath', () => {
  it('reads the code back out of a join path', () => {
    expect(codeFromPath('/join/abc123')).toBe('abc123');
    expect(codeFromPath('/join/abc123/')).toBe('abc123');
  });

  it('is null for anything else', () => {
    expect(codeFromPath('/')).toBeNull();
    expect(codeFromPath('/join')).toBeNull();
    expect(codeFromPath('/join/')).toBeNull();
    expect(codeFromPath('/wallet')).toBeNull();
    expect(codeFromPath('')).toBeNull();
  });

  it('survives a malformed escape instead of throwing', () => {
    // `decodeURIComponent('%')` throws, and an exception here would take down the router.
    expect(codeFromPath('/join/%')).toBeNull();
  });

  it('refuses an absurdly long code rather than passing it to the server', () => {
    expect(codeFromPath(`/join/${'a'.repeat(200)}`)).toBeNull();
  });

  it('round-trips a real code through the URL it builds', () => {
    const code = 'aB3-_xYz09';
    expect(codeFromPath(new URL(joinUrl('https://x.app', code)).pathname)).toBe(code);
  });
});
