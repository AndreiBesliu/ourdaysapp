// src/utils/inviteShare.ts
// Where an invitation can be sent, and what it says.
//
// ── The constraint that picked these channels ─────────────────────────────────────────
//
// "Other methods are fine as long as they need no setup from me." That rules out every provider
// that needs an account, a key or a verified domain — SendGrid, Mailgun, Twilio, the WhatsApp
// Business API. What is left is the category that needs nothing at all: hand the text to an app
// the sender already has and let them press send. No server sends anything; the PERSON sends it.
//
// That is also why the message is a link rather than a pre-addressed invitation. The old flow
// needed the recipient's email in advance and only worked if they signed up with exactly that
// address. A link works for somebody with no account, reached through any channel.
//
// ── Why `native` is first ─────────────────────────────────────────────────────────────
//
// `navigator.share` opens the operating system's own share sheet, which lists every app on the
// device that accepts text — WhatsApp, Telegram, Signal, Messenger, SMS, mail, anything. One
// channel that is really all of them, with nothing to integrate and nothing to keep up to date.
// The explicit buttons below it exist because the sheet is absent on desktop browsers, and
// because somebody who wants WhatsApp should not have to go through a menu to find it.
//
// Pure: no React, no DOM, no network. `navigator.share` is invoked by the caller, not here.

export type InviteChannel = 'native' | 'whatsapp' | 'email' | 'sms' | 'telegram' | 'copy' | 'qr';

export interface InviteMessage {
  /** One line for a subject or a share-sheet title. */
  title: string;
  /** The body, WITHOUT the link. */
  text: string;
  /** The join URL. */
  url: string;
}

/**
 * The join URL for a code.
 *
 * `origin` is passed in rather than read from `window` so this stays pure and so a test can pin
 * the result. Any trailing slash is trimmed, because `${origin}/join/${code}` with an origin of
 * "https://x/" yields a double slash — which some routers treat as a different path.
 */
export function joinUrl(origin: string, code: string): string {
  return `${String(origin).replace(/\/+$/, '')}/join/${encodeURIComponent(code)}`;
}

/**
 * Everything a channel needs, in the sender's language.
 *
 * The strings arrive already translated: this module must not import `t`, or it would have to
 * know the language and could not be tested without the dictionary.
 */
export function buildMessage(parts: {
  title: string;
  /** Already interpolated, e.g. "Andrei invites you to Family on Our Days." */
  body: string;
  origin: string;
  code: string;
}): InviteMessage {
  return {
    title: parts.title,
    text: parts.body,
    url: joinUrl(parts.origin, parts.code),
  };
}

/** Body and link together, for channels that take one blob of text. */
export function fullText(m: InviteMessage): string {
  return `${m.text}\n\n${m.url}`;
}

/**
 * The URL that opens a channel with the message prefilled, or null for the channels that are not
 * a link (`native`, `copy`, `qr` — the caller handles those).
 */
export function channelHref(channel: InviteChannel, m: InviteMessage): string | null {
  const body = fullText(m);
  switch (channel) {
    case 'whatsapp':
      // wa.me is WhatsApp's own web entry point; with no phone number it opens the contact
      // picker, which is what we want — the sender chooses who, we never handle a phone number.
      return `https://wa.me/?text=${encodeURIComponent(body)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${encodeURIComponent(m.url)}&text=${encodeURIComponent(m.text)}`;
    case 'email':
      return `mailto:?subject=${encodeURIComponent(m.title)}&body=${encodeURIComponent(body)}`;
    case 'sms':
      // `?&body=` on purpose. iOS wants `sms:&body=`, Android wants `sms:?body=`, and this form
      // is the one both parse — a documented platform disagreement, not a typo.
      return `sms:?&body=${encodeURIComponent(body)}`;
    default:
      return null;
  }
}

/**
 * Channels worth offering here and now.
 *
 * `native` only when the browser actually has it — an inert button is worse than an absent one,
 * which is the same rule the refusals in this codebase are written under. Everything else is a
 * plain URL and always works; `qr` is for handing somebody the invitation in person.
 */
export function availableChannels(canShare: boolean): InviteChannel[] {
  const rest: InviteChannel[] = ['whatsapp', 'email', 'sms', 'telegram', 'copy', 'qr'];
  return canShare ? ['native', ...rest] : rest;
}

/** True when the running browser can open the OS share sheet. */
export function canUseNativeShare(nav: { share?: unknown } | undefined | null): boolean {
  return typeof nav?.share === 'function';
}

/** Read a `/join/:code` path back into a code. Null when the path is not a join link. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/join\/([^/?#]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  try {
    const code = decodeURIComponent(m[1]);
    return code && code.length <= 64 ? code : null;
  } catch {
    // A malformed percent-escape throws rather than returning null, and an exception here would
    // take down whatever screen was routing.
    return null;
  }
}
