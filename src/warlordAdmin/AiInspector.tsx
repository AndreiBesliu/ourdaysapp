// src/warlordAdmin/AiInspector.tsx
// Every rule the enemy AI has, and every decision it takes, in one place.
//
// ── Why this can exist at all ─────────────────────────────────────────────────────────
//
// The AI is a PURE function of the battle state — no clock, no rng, and it plans with mean
// damage rather than dice. So the admin does not need any data plumbing from a player's device:
// given the same difficulty and seed, it reproduces the identical battle and the identical
// reasoning. What you read here is not a reconstruction or an approximation — it is the same
// planner, over the same state, returning the same trace the live battle would.
//
// The rule list is not written here. It is rendered from `AI_RULES` in the game itself, which is
// also what the planner cites. A rule cannot be described here and behave differently there.

import { useMemo, useState } from 'react';
import { AI_RULES, AI_RULE_BY_ID } from '@warlord/logic/combat/aiRules';
import type { AiRuleId } from '@warlord/logic/combat/aiRules';
import type { AiUnitTrace } from '@warlord/logic/combat/ai';
import { replayEnemyTurns, syntheticCohorts } from '@warlord/logic/combat/aiReplay';
import type { AiReplay } from '@warlord/logic/combat/aiReplay';
import { DIFFICULTIES } from '@warlord/logic/combat/enemies';
import { Registry } from '@warlord/logic/registry';
import type { Difficulty } from '@warlord/logic/combat/types';
import type { GameConfigOverrides } from '@warlord/logic/config';

const DECISION_STYLE: Record<AiUnitTrace['decision'], { label: string; cls: string }> = {
  ATTACK: { label: 'Strikes', cls: 'bg-wl-bad-surface text-wl-bad-ink' },
  MOVE_AND_ATTACK: { label: 'Closes & strikes', cls: 'bg-wl-bad-surface text-wl-bad-ink' },
  ADVANCE: { label: 'Advances', cls: 'bg-wl-accent-surface text-wl-ink' },
  HOLD: { label: 'Holds', cls: 'bg-wl-panel-muted text-wl-muted' },
  SKIPPED: { label: 'Skipped', cls: 'bg-wl-panel-muted text-wl-muted' },
};

type Replay = AiReplay & { error?: string };

/**
 * The loop that could hang a page lives in the GAME (`aiReplay.ts`), where tests cover it. This
 * panel needs an account to open, so it cannot be loaded in a browser during development —
 * typecheck, tests and build can all be green with it crashed on an ErrorBoundary. Anything with
 * a termination condition belongs on the other side of that line.
 */
function runReplay(
  difficulty: Difficulty, seed: number, cohorts: number, size: number, maxTurns: number,
  overrides: GameConfigOverrides,
): Replay {
  try {
    Registry.init();
    // Passed explicitly, and restored by the callee. Without it the replay ran against whatever
    // the process global happened to hold — empty here until the game mounts — so the same seed
    // gave different battles depending on whether the operator had opened the Domain tab.
    return replayEnemyTurns(syntheticCohorts(cohorts, size), difficulty, seed, maxTurns, overrides);
  } catch (e) {
    return {
      turns: [], outcome: '—', winner: null, playerCohorts: 0, enemyCohorts: 0, ranAgainst: 'defaults',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function RuleChip({ id, onPick }: { id: AiRuleId; onPick: (id: AiRuleId) => void }) {
  const r = AI_RULE_BY_ID[id];
  return (
    <button
      onClick={() => onPick(id)}
      title={r ? `${r.name} — ${r.effect}` : id}
      className="px-1.5 py-0.5 rounded border border-wl-line bg-wl-panel text-[10px] font-mono hover:bg-wl-panel-muted"
    >
      {id}
    </button>
  );
}

export default function AiInspector({ overrides }: { overrides: GameConfigOverrides }) {
  // Every hook up here, together. `/admin` cannot be loaded in a browser without an account, so
  // a hook placed next to a return is a crash nobody sees until a real operator opens the page.
  const [difficulty, setDifficulty] = useState<Difficulty>('BANDIT_RAID');
  const [seed, setSeed] = useState(12345);
  const [cohorts, setCohorts] = useState(4);
  const [size, setSize] = useState(40);
  const [maxTurns, setMaxTurns] = useState(12);
  // The inputs are DRAFTS until Run is pressed. They used to be memo dependencies, which made the
  // Run button decorative and re-ran a whole battle on every keystroke of the seed field — up to
  // 24 cohorts x 60 turns of synchronous work per character, on a page that cannot be opened
  // without an account and so has nobody to notice it freeze.
  const [request, setRequest] = useState<{
    difficulty: Difficulty; seed: number; cohorts: number; size: number; maxTurns: number;
    overrides: GameConfigOverrides; n: number;
  } | null>(null);
  const [focus, setFocus] = useState<AiRuleId | null>(null);
  const [showAllRules, setShowAllRules] = useState(true);

  const replay = useMemo(
    () => (request === null
      ? null
      : runReplay(request.difficulty, request.seed, request.cohorts, request.size, request.maxTurns, request.overrides)),
    [request],
  );

  const run = (nextSeed = seed) => {
    setSeed(nextSeed);
    setRequest((prev) => ({
      difficulty, seed: nextSeed, cohorts, size, maxTurns, overrides, n: (prev?.n ?? 0) + 1,
    }));
  };
  // True when the drafts have moved on from what is displayed, so the operator is never left
  // reading a replay that no longer matches the controls above it without being told.
  const stale = !!request && (
    request.difficulty !== difficulty || request.seed !== seed || request.cohorts !== cohorts ||
    request.size !== size || request.maxTurns !== maxTurns || request.overrides !== overrides
  );

  const usage = useMemo(() => {
    const seen = new Map<AiRuleId, number>();
    for (const t of replay?.turns ?? []) {
      for (const id of t.rules) seen.set(id, (seen.get(id) ?? 0) + 1);
      for (const u of t.units) for (const id of [...u.rules, ...u.weighed]) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return seen;
  }, [replay]);

  const turnRules = AI_RULES.filter((r) => r.scope === 'turn');
  const unitRules = AI_RULES.filter((r) => r.scope === 'unit');

  const num = (v: string, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-wl-line bg-wl-panel p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-wl-muted">What this is</div>
        <p className="text-sm text-wl-muted leading-relaxed">
          The enemy AI is a pure function of the battle state, so this page replays it exactly rather
          than approximating it: same difficulty and seed, same decisions, same reasoning. Every rule
          below is read from the game's own rule table — the one the planner cites — so a rule cannot
          be described here and behave differently in a real battle.
        </p>
      </div>

      {/* ---- The rulebook ---- */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h4 className="font-serif text-base font-bold">Rules ({AI_RULES.length})</h4>
          <button
            onClick={() => setShowAllRules((v) => !v)}
            className="px-2 py-0.5 text-xs rounded border border-wl-line bg-wl-panel hover:bg-wl-panel-muted"
          >
            {showAllRules ? 'Collapse' : 'Expand'}
          </button>
          {focus && (
            <button onClick={() => setFocus(null)} className="px-2 py-0.5 text-xs rounded border border-wl-line bg-wl-panel">
              Clear focus on {focus}
            </button>
          )}
        </div>

        {showAllRules && ([['Turn', turnRules], ['Cohort', unitRules]] as const).map(([label, rules]) => (
          <div key={label} className="space-y-1.5">
            <div className="text-xs uppercase tracking-wide text-wl-muted mt-2">{label} rules</div>
            {rules.map((r) => {
              const fired = usage.get(r.id) ?? 0;
              return (
                <div
                  key={r.id}
                  // Focus is carried by the border and the surface, never by opacity: opacity
                  // composites the text down with whatever is behind it, and these rules ARE the
                  // reading matter. Twice today that shortcut cost a contrast failure.
                  className={`rounded border p-2 ${focus === r.id ? 'border-wl-accent bg-wl-accent-surface' : 'border-wl-line bg-wl-panel'}`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <button onClick={() => setFocus(r.id)} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-wl-line hover:bg-wl-panel-muted">
                      {r.id}
                    </button>
                    <span className="font-semibold text-sm">{r.name}</span>
                    {replay && (
                      <span className={`text-[11px] ${fired ? 'text-wl-good' : 'text-wl-muted'}`}>
                        {fired ? `fired ${fired}×` : 'not fired in this replay'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-1"><span className="text-wl-muted">Effect: </span>{r.effect}</div>
                  <div className="text-xs mt-0.5"><span className="text-wl-muted">Why: </span>{r.why}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ---- The replay ---- */}
      <div className="space-y-3">
        <h4 className="font-serif text-base font-bold">Replay a battle</h4>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-wl-line bg-wl-panel-muted p-3">
          <label className="text-xs">
            <div className="text-wl-muted mb-1">Mission</div>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="px-2 py-1 rounded border border-wl-line bg-wl-panel text-sm"
            >
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <div className="text-wl-muted mb-1">Seed</div>
            <input type="number" value={seed} onChange={(e) => setSeed(num(e.target.value, seed, 0, 2147483647))}
              className="w-32 px-2 py-1 rounded border border-wl-line bg-wl-panel text-sm font-mono" />
          </label>
          <label className="text-xs">
            <div className="text-wl-muted mb-1">Player cohorts</div>
            <input type="number" value={cohorts} onChange={(e) => setCohorts(num(e.target.value, cohorts, 1, 24))}
              className="w-20 px-2 py-1 rounded border border-wl-line bg-wl-panel text-sm font-mono" />
          </label>
          <label className="text-xs">
            <div className="text-wl-muted mb-1">Cohort size</div>
            <input type="number" value={size} onChange={(e) => setSize(num(e.target.value, size, 1, 500))}
              className="w-20 px-2 py-1 rounded border border-wl-line bg-wl-panel text-sm font-mono" />
          </label>
          <label className="text-xs">
            <div className="text-wl-muted mb-1">Max enemy turns</div>
            <input type="number" value={maxTurns} onChange={(e) => setMaxTurns(num(e.target.value, maxTurns, 1, 60))}
              className="w-20 px-2 py-1 rounded border border-wl-line bg-wl-panel text-sm font-mono" />
          </label>
          <button onClick={() => run()} className="px-4 py-1.5 rounded bg-wl-accent text-wl-accent-ink text-sm">
            Run
          </button>
          <button onClick={() => run((seed * 1103515245 + 12345) % 2147483647)}
            className="px-3 py-1.5 rounded border border-wl-line bg-wl-panel text-sm">
            New seed &amp; run
          </button>
        </div>

        {stale && (
          <p className="text-sm text-wl-bad-ink">
            These settings have changed since the replay below. Press <strong>Run</strong> to use them.
          </p>
        )}

        <p className="text-xs text-wl-muted">
          The player side <strong>stands still</strong> for the whole replay. That is deliberate — it lets the
          advance and target-selection rules show themselves without a second set of choices mixed in — but it
          means this is <strong>not</strong> a balance simulation and the outcome should not be read as one.
        </p>

        {replay?.error && (
          <div className="rounded border border-wl-line bg-wl-bad-surface p-3 text-sm text-wl-bad-ink">
            The replay could not run: {replay.error}
          </div>
        )}

        {replay && !replay.error && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-mono">{replay.playerCohorts}</span> player cohorts vs{' '}
              <span className="font-mono">{replay.enemyCohorts}</span> enemy · {replay.outcome}
              {' · '}
              <span className="text-wl-muted">
                ran against {replay.ranAgainst === 'overrides'
                  ? 'the configuration in this editor, unsaved changes included'
                  : 'the built-in defaults (no overrides set)'}
              </span>
              {replay.turns.length === 0 && ' · the enemy never got a turn'}
            </div>

            {replay.turns.map((t, i) => {
              const rows = focus ? t.units.filter((u) => u.rules.includes(focus) || u.weighed.includes(focus)) : t.units;
              return (
                <div key={i} className="rounded-lg border border-wl-line bg-wl-panel">
                  <div className="flex flex-wrap items-center gap-2 border-b border-wl-line px-3 py-2">
                    <span className="font-serif font-bold text-sm">Enemy turn {t.turn}</span>
                    <span className="text-xs text-wl-muted">{t.units.length} cohort(s)</span>
                    <div className="flex flex-wrap gap-1 ml-auto">
                      {t.rules.map((id) => <RuleChip key={id} id={id} onPick={setFocus} />)}
                    </div>
                  </div>
                  {t.note && <div className="px-3 py-2 text-xs text-wl-muted">{t.note}</div>}
                  {focus && rows.length === 0 && (
                    <div className="px-3 py-2 text-xs text-wl-muted">No cohort cited {focus} this turn.</div>
                  )}
                  <div className="divide-y divide-wl-line">
                    {rows.map((u) => {
                      const st = DECISION_STYLE[u.decision];
                      return (
                        <div key={u.id} className="px-3 py-2 space-y-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-mono text-xs">{u.id}</span>
                            <span className="text-sm font-semibold">{u.name}</span>
                            <span className="text-[11px] text-wl-muted font-mono">({u.from.x},{u.from.y})</span>
                            <span className={`px-1.5 py-0.5 rounded text-[11px] ${st.cls}`}>{st.label}</span>
                            {u.target && (
                              <span className="text-[11px] text-wl-muted">
                                → {u.target.name} at range {u.target.distance}
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-wl-muted font-mono">
                              {u.consideredPositions} pos · {u.consideredShots} shot(s)
                              {u.expectedKills !== undefined && ` · exp ${u.expectedKills}`}
                              {u.score !== undefined && ` · score ${u.score.toFixed(3)}`}
                            </span>
                          </div>
                          <div className="text-xs">{u.detail}</div>
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-wl-muted mr-1">decided by</span>
                            {u.rules.map((id) => <RuleChip key={id} id={id} onPick={setFocus} />)}
                          </div>
                          {u.weighed.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {/* Separate on purpose: these fired while weighing options that LOST.
                                  Shown, because the ask was to log everything the AI does — but
                                  never mixed with what actually decided the action. */}
                              <span className="text-[10px] uppercase tracking-wide text-wl-muted mr-1">also weighed</span>
                              {u.weighed.map((id) => <RuleChip key={id} id={id} onPick={setFocus} />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!replay && <p className="text-sm text-wl-muted">Press <strong>Run</strong> to replay a battle and read every decision.</p>}
      </div>
    </div>
  );
}
