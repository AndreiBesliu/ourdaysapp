import { useMemo, useState } from 'react';
import {
  compareConfigs, explainBuilding, buildingFormula,
  explainRecipe, explainBuildingCost, explainCompany, explainMission, explainStudy,
} from '@warlord/logic/explain';
import { fmtCopper, type BuildingType, type Rank, type SoldierType } from '@warlord/logic/types';
import type { Difficulty } from '@warlord/logic/combat/types';
import type { GameConfigOverrides } from '@warlord/logic/config';

// Both of these run the game's own daily simulation. Nothing here re-derives a formula:
// the panel has to be able to say "this is what a day will do" and be right, and the only
// way to be right is to ask the same code the tick asks.

/**
 * What the pending edits would change, per day, compared with what is stored.
 * Measured on a reference domain — one of every building at level 1, all output going to
 * materials — so a change anywhere in the configuration shows up somewhere here.
 */
export function PendingEffect({ saved, pending }: { saved: GameConfigOverrides; pending: GameConfigOverrides }) {
  const delta = useMemo(() => compareConfigs(saved, pending), [saved, pending]);
  const rows = Object.entries(delta.resources).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] !== 0);
  if (delta.wallet === 0 && rows.length === 0) return null;

  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div className="rounded border border-wl-accent-line bg-wl-accent-surface p-3 text-sm">
      <div className="font-semibold text-wl-ink">What your unsaved changes would do, per day</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {delta.wallet !== 0 && (
          <span className={delta.wallet > 0 ? 'text-wl-good' : 'text-wl-bad'}>
            coin {delta.wallet > 0 ? '+' : '−'}{fmtCopper(Math.abs(delta.wallet))}
          </span>
        )}
        {rows.map(([r, v]) => (
          <span key={r} className={v > 0 ? 'text-wl-good' : 'text-wl-bad'}>
            {r.replace(/_/g, ' ').toLowerCase()} {sign(v)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-wl-muted">
        Measured on a reference domain — one of every building at level 1, everything set to produce
        materials rather than coin — by running the same daily simulation the game runs. A real
        kingdom differs by which buildings it has, their levels and their focus.
      </p>
    </div>
  );
}

const nice = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/**
 * The shell every effect line shares: a one-line answer, and the arithmetic behind it on
 * demand. Kept collapsed by default — the numbers are what an admin tunes by; the formula
 * is what he reaches for when a number surprises him.
 */
function Explain({ summary, formula }: { summary: React.ReactNode; formula: string[] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="text-xs text-wl-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {summary}
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          // Padding grows the touch target; the negative margin keeps the inline flow.
          className="underline decoration-dotted hover:text-wl-ink py-2 -my-2"
        >
          {show ? 'hide formula' : 'formula'}
        </button>
      </div>
      {show && (
        <ul className="mt-1 ml-3 list-disc space-y-0.5 font-mono text-[11px] text-wl-subtle">
          {formula.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

// Every component below takes `config` — the configuration being EDITED, not the one that is
// stored. An effect line answered from the saved values would be lying exactly where it is
// supposed to explain.

/** One building: what a day of it yields and costs. */
export function BuildingEffect({
  type, level, config,
}: { type: BuildingType; level: number; config?: GameConfigOverrides | null }) {
  const e = useMemo(() => explainBuilding(type, { level, focusCoinPct: 0, config }), [type, level, config]);
  const coinOnly = useMemo(() => explainBuilding(type, { level, focusCoinPct: 100, config }), [type, level, config]);
  const formula = useMemo(() => buildingFormula(type, level, 0, config), [type, level, config]);

  const consumes = Object.entries(e.consumesPerDay).filter((x): x is [string, number] => typeof x[1] === 'number');
  return (
    <Explain
      formula={formula}
      summary={
        <>
          {e.itemsPerDay > 0
            ? <span>→ <span className="font-mono text-wl-ink">{e.itemsPerDay}</span> {nice(e.outputItem)}/day at full material focus</span>
            : e.valueLostPerDay > 0
              // Not "all of it becomes coin": the engine pays only the coin share and drops
              // the rest, so this building on material focus produces literally nothing.
              ? <span className="text-wl-bad">→ has no item to make; on material focus it produces NOTHING and wastes {fmtCopper(e.valueLostPerDay)}/day</span>
              : <span>→ produces no item; its value is paid as coin</span>}
          <span>or <span className="font-mono text-wl-ink">{fmtCopper(coinOnly.coinPerDay)}</span>/day at full coin focus</span>
          {consumes.length > 0 && (
            <span className="text-wl-bad">
              consumes {consumes.map(([r, q]) => `${Math.round(q)} ${nice(r)}`).join(' + ')}/day
            </span>
          )}
        </>
      }
    />
  );
}

/** One recipe: is crafting it worth more than the materials it eats? */
export function RecipeEffect({ item, config }: { item: string; config?: GameConfigOverrides | null }) {
  const r = useMemo(() => explainRecipe(item, config), [item, config]);
  const pct = Number.isFinite(r.ratio) ? Math.round(r.ratio * 100) : null;
  return (
    <Explain
      formula={r.lines}
      summary={
        <span className={r.destroysValue ? 'text-wl-bad font-semibold' : 'text-wl-good'}>
          {r.destroysValue
            ? `materials ${fmtCopper(r.materialsValue)} > item ${fmtCopper(r.itemValue)} — crafting DESTROYS ${fmtCopper(r.materialsValue - r.itemValue)} per item`
            : `materials ${fmtCopper(r.materialsValue)} → item ${fmtCopper(r.itemValue)}${pct === null ? '' : ` (${pct}% of its value)`}`}
        </span>
      }
    />
  );
}

/** One building's price: to put up, and to raise to the top. */
export function CostEffect({ type, config }: { type: BuildingType; config?: GameConfigOverrides | null }) {
  const c = useMemo(() => explainBuildingCost(type, config), [type, config]);
  const top = c.upgrades[c.upgrades.length - 1];
  const res = Object.entries(c.resources).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0);
  return (
    <Explain
      formula={c.lines}
      summary={
        <>
          <span>build <span className="font-mono text-wl-ink">{fmtCopper(c.build)}</span></span>
          {top && <span>· to L{top.toLevel} <span className="font-mono text-wl-ink">{fmtCopper(top.cumulative)}</span> in all</span>}
          {res.length > 0 && <span>· plus {res.map(([r, q]) => `${q} ${nice(r)}`).join(' + ')}</span>}
        </>
      }
    />
  );
}

/** What a company of this soldier costs to keep, at the size an army actually reaches. */
export function CompanyEffect({
  type, rank, count, config,
}: { type: SoldierType; rank: Rank; count: number; config?: GameConfigOverrides | null }) {
  const c = useMemo(() => explainCompany(type, rank, count, config), [type, rank, count, config]);
  return (
    <Explain
      formula={c.lines}
      summary={
        <span>
          {count} {rank.toLowerCase()} → <span className="font-mono text-wl-ink">{fmtCopper(c.copperPerDay)}</span>/day
          {' '}and <span className="font-mono text-wl-ink">{c.foodPerDay}</span> food/day
        </span>
      }
    />
  );
}

/** What the study rates mean: the pace a Scriptorium sets, and what a tech costs at it. */
export function StudyEffect({
  scriptoriumLevel, config,
}: { scriptoriumLevel: number; config?: GameConfigOverrides | null }) {
  const e = useMemo(() => explainStudy(scriptoriumLevel, config), [scriptoriumLevel, config]);
  const slow = e.examples.find((x) => x.days === 3);
  return (
    <Explain
      formula={e.lines}
      summary={
        <>
          <span>
            a Scriptorium L{scriptoriumLevel} alone →{' '}
            <span className="font-mono text-wl-ink">{e.perBranch.ECONOMY}</span> study/day to every branch
          </span>
          {slow && (
            <span>
              · an Effort-3 tech takes <span className="font-mono text-wl-ink">{slow.daysAtPace ?? '∞'}</span> days
              on that alone
            </span>
          )}
        </>
      }
    />
  );
}

/** What one run of a mission fields against you and pays. */
export function MissionEffect({
  id, deployedStrength, config,
}: { id: Difficulty; deployedStrength: number; config?: GameConfigOverrides | null }) {
  const m = useMemo(() => explainMission(id, deployedStrength, config), [id, deployedStrength, config]);
  const res = Object.entries(m.rewardResources).filter((e): e is [string, number] => typeof e[1] === 'number');
  return (
    <Explain
      formula={m.lines}
      summary={
        <>
          <span>vs a {deployedStrength}-strength army → enemy <span className="font-mono text-wl-ink">{m.enemyStrength}</span></span>
          <span className="text-wl-good">pays <span className="font-mono">{fmtCopper(m.rewardCopper)}</span>{res.length ? ` + ${res.map(([r, q]) => `${q} ${nice(r)}`).join(' + ')}` : ''}</span>
        </>
      }
    />
  );
}
