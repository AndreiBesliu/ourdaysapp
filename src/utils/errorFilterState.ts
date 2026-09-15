// src/utils/errorFilterState.ts
//
// Which problems a filter chip shows, and which chip the Health tab opens on.
//
// This was written inline in Admin.tsx, where it could not be run: `/admin` is behind a login, so
// typecheck, the lint gate, the tests and the build can all be green with that screen showing
// nothing at all. The rule that decides what the panel greets you with is exactly the rule worth
// being able to prove, so it lives here instead.
//
// The reason it exists: the panel hard-coded "Needs attention" as the landing chip. When nothing
// needed attention — the good case — the first thing anybody saw was "Nothing in this state", with
// five real problems one click away and no sign of them. A panel that looks emptiest precisely when
// everything is fine is the opposite of what it is for.

export type ErrorFilter = 'open' | 'new' | 'seen' | 'resolved' | 'all';

/** The order somebody actually cares: what came back, what is unread, what is known, what is done. */
export const ERROR_FILTER_ORDER: readonly ErrorFilter[] = ['open', 'new', 'seen', 'resolved'];

interface StatusCarrier {
  status?: string | null;
}

/**
 * A group's status, with the one legitimate gap filled in.
 *
 * `status` can be missing for a real reason: hosting deployed ahead of functions, so the browser
 * holds a build expecting a field the server does not send yet. Treating that as 'new' keeps the
 * group VISIBLE. The alternative — letting it fall through to 'resolved' — is a panel confidently
 * reporting that everything is fine.
 */
export function errorStatusOf(group: StatusCarrier): string {
  return group?.status || 'new';
}

/** Whether a group belongs in the given chip. 'open' is new + regressed. */
export function inErrorState(group: StatusCarrier, filter: ErrorFilter | string): boolean {
  if (filter === 'all') return true;
  const status = errorStatusOf(group);
  if (filter === 'open') return status === 'new' || status === 'regressed';
  return status === filter;
}

/**
 * The chip to open on: the first one in priority order that actually holds something.
 *
 * Falls back to 'all', which is empty only when the log itself is — so the panel can never land on
 * an empty shelf while a full one sits beside it.
 */
export function landingErrorFilter(groups: readonly StatusCarrier[]): ErrorFilter {
  if (!groups || groups.length === 0) return 'all';
  return ERROR_FILTER_ORDER.find((f) => groups.some((g) => inErrorState(g, f))) || 'all';
}
