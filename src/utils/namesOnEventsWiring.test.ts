// src/utils/namesOnEventsWiring.test.ts
//
// Where CalendarHome hands the map WITH the names of people who left (utils/namesOnEvents.ts) and
// where it must not. Showing an event: the extended map, so a task that is over says "Gina", not
// "Member" (Andrei, 05.10.2026). Choosing whom to assign: the members' map only — AddEventModal offers
// every entry of it, and naming somebody who is not a member is refused by the rules
// (`namedAreInGroup`). Read with the TypeScript parser, so a comment cannot satisfy a check.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const file = resolve(process.cwd(), 'src', 'screens', 'CalendarHome.tsx');
const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = (pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
  visit(sf);
  return out;
};
/** The value of `attr` on every <tag>, as source text. */
const attrs = (tag: string, attr: string): string[] =>
  (all((n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === tag) as (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[])
    .map((el) => {
      const a = el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === attr) as ts.JsxAttribute | undefined;
      const init = a?.initializer;
      return init && ts.isJsxExpression(init) ? init.expression!.getText(sf) : init ? init.getText(sf) : '';
    });

describe('CalendarHome: the names of people who left, shown but never offered', () => {
  it('the event details and the calendar grid are shown with the extended map', () => {
    expect(attrs('EventDetailsModal', 'userMap')).toEqual(['eventUserMap']);
    expect(attrs('CalendarGrid', 'userMap')).toEqual(['eventUserMap']);
  });

  it('the form that assigns people, the group settings and the games keep the members’ map', () => {
    expect(attrs('AddEventModal', 'userMap')).toEqual(['userMap']);
    expect(attrs('GroupSettingsModal', 'userMap')).toEqual(['userMap']);
    expect(attrs('GamesHubModal', 'userMap')).toEqual(['userMap']);
  });

  it('the extended map is the members’ map plus the names looked up for the loaded events', () => {
    const decl = all((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === 'eventUserMap') as ts.VariableDeclaration[];
    expect(decl).toHaveLength(1);
    expect(decl[0].initializer!.getText(sf)).toBe('useMemo(() => withNamesOnEvents(userMap, namesOutside), [userMap, namesOutside])');
    const lookups = all((n) => ts.isCallExpression(n) && n.expression.getText(sf) === 'namedOutside') as ts.CallExpression[];
    expect(lookups.map((c) => c.arguments.map((a) => a.getText(sf)).join(', '))).toEqual(['allEvents, userMap']);
  });
});
