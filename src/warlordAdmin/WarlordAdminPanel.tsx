import { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { loadWarlordConfig, saveWarlordConfig, loadWarlordConfigMeta, pruneOverrides } from './configApi';
import type { GameConfigOverrides } from '../warlord/logic/config';
import { DEFAULT_TRAINING } from '../warlord/logic/config';
import {
  BuildingCostCopper, ResourceBuildingCosts, UPKEEP_BASE, UPKEEP_RANK_MULT, FOOD_BASE,
  RESOURCE_BUILDING_BASE_VALUE,
} from '../warlord/logic/economy';
import { fmtCopper } from '../warlord/logic/types';
import { DEFAULT_TECHS, BRANCH_LABEL } from '../warlord/logic/research/catalog';
import type { TechDef } from '../warlord/logic/research/catalog';
import { BUFF_DEFS } from '../warlord/logic/research/momentum';
import type { EffectDelta } from '../warlord/logic/research/effects';
import { MISSION_PRESETS } from '../warlord/logic/combat/enemies';

// Warlord balance editor. Every field is an OVERRIDE over the game's built-in default:
// an empty box means "use the default", so the stored document only ever contains what
// an admin deliberately changed. Access is the OurDaysApp admin role (admins/{uid});
// Firestore rules enforce the write, this panel only guards the UI.

type Section = 'TECHS' | 'MOMENTUM' | 'ECONOMY' | 'CAMPAIGN' | 'JSON';

const EFFECT_LABELS: Record<keyof EffectDelta, string> = {
  prodMult: 'Production ×',
  craftEfficiency: 'Craft eff. ×',
  buildCostMult: 'Build cost ×',
  upkeepMult: 'Upkeep ×',
  foodMult: 'Food ×',
  trainDaysDelta: 'Train days ±',
  trainSlotsDelta: 'Train slots ±',
  trainXpMult: 'Train XP ×',
  lootMult: 'Loot ×',
  postBattleMoraleBonus: 'Morale +',
  unlocks: 'Unlocks',
};

function NumField({ label, def, value, onChange, hint }: {
  label: string;
  def: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  hint?: string;
}) {
  const changed = value !== undefined && value !== def;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className={`w-40 shrink-0 ${changed ? 'font-semibold text-amber-700' : 'text-stone-600'}`}>{label}</span>
      <input
        type="number"
        step="any"
        value={value ?? ''}
        placeholder={String(def)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className={`w-28 px-2 py-1 rounded border text-sm ${changed ? 'border-amber-500 bg-amber-50' : 'border-stone-300 bg-white'}`}
      />
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

function countOverrides(o: GameConfigOverrides): number {
  let n = 0;
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') n += Object.keys(v as object).length;
    else if (v !== undefined) n += 1;
  }
  return n;
}

export default function WarlordAdminPanel() {
  const [ov, setOv] = useState<GameConfigOverrides>({});
  const [section, setSection] = useState<Section>('ECONOMY');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<{ updatedBy?: string; updatedAt?: Date | null }>({});
  const [jsonDraft, setJsonDraft] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([loadWarlordConfig(), loadWarlordConfigMeta()]).then(([cfg, m]) => {
      if (!alive) return;
      setOv(cfg ?? {});
      setMeta(m);
      setStatus('idle');
    });
    return () => { alive = false; };
  }, []);

  const dirtyCount = useMemo(() => countOverrides(ov), [ov]);

  // ---- generic setters: writing `undefined` removes the override entirely ----
  function setIn<K extends keyof GameConfigOverrides>(key: K, id: string, value: unknown) {
    setOv((prev) => {
      const branch: Record<string, unknown> = { ...((prev[key] as Record<string, unknown>) ?? {}) };
      if (value === undefined) delete branch[id];
      else branch[id] = value;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(branch).length === 0) delete next[key as string];
      else next[key as string] = branch;
      return next as GameConfigOverrides;
    });
  }

  // Overrides are stored as plain records and cast back on return: TypeScript treats a
  // spread-built object's keys as required, which makes `delete` on them an error.
  function withCatalog(prev: GameConfigOverrides, mutate: (catalog: Record<string, unknown>) => void): GameConfigOverrides {
    const catalog: Record<string, unknown> = { ...(prev.catalog ?? {}) };
    mutate(catalog);
    const next: Record<string, unknown> = { ...prev };
    if (Object.keys(catalog).length === 0) delete next.catalog;
    else next.catalog = catalog;
    return next as GameConfigOverrides;
  }

  function setTech(id: string, patch: Partial<Omit<TechDef, 'id'>>) {
    setOv((prev) => withCatalog(prev, (catalog) => {
      const techs: Record<string, unknown> = { ...((catalog.techs as Record<string, unknown>) ?? {}) };
      const merged: Record<string, unknown> = { ...((techs[id] as Record<string, unknown>) ?? {}), ...patch };
      for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
      if (Object.keys(merged).length === 0) delete techs[id];
      else techs[id] = merged;
      if (Object.keys(techs).length === 0) delete catalog.techs;
      else catalog.techs = techs;
    }));
  }

  function toggleTechDisabled(id: string, disabled: boolean) {
    setOv((prev) => withCatalog(prev, (catalog) => {
      const list = new Set((catalog.disabled as string[] | undefined) ?? []);
      if (disabled) list.add(id); else list.delete(id);
      if (list.size === 0) delete catalog.disabled;
      else catalog.disabled = [...list];
    }));
  }

  function setBuff(id: string, patch: { days?: number; effects?: EffectDelta }) {
    setOv((prev) => {
      const buffs: Record<string, unknown> = { ...(prev.buffs ?? {}) };
      const cur: Record<string, unknown> = { ...((buffs[id] as Record<string, unknown>) ?? {}) };
      if ('days' in patch) {
        if (patch.days === undefined) delete cur.days; else cur.days = patch.days;
      }
      if (patch.effects) {
        const eff: Record<string, unknown> = { ...((cur.effects as Record<string, unknown>) ?? {}), ...patch.effects };
        for (const [k, v] of Object.entries(eff)) if (v === undefined) delete eff[k];
        if (Object.keys(eff).length === 0) delete cur.effects; else cur.effects = eff;
      }
      if (Object.keys(cur).length === 0) delete buffs[id]; else buffs[id] = cur;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(buffs).length === 0) delete next.buffs;
      else next.buffs = buffs;
      return next as GameConfigOverrides;
    });
  }

  function setMission(id: string, patch: Record<string, number | undefined>) {
    setOv((prev) => {
      const missions: Record<string, unknown> = { ...(prev.missions ?? {}) };
      const cur: Record<string, unknown> = { ...((missions[id] as Record<string, unknown>) ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete cur[k]; else cur[k] = v;
      }
      if (Object.keys(cur).length === 0) delete missions[id];
      else missions[id] = cur;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(missions).length === 0) delete next.missions;
      else next.missions = missions;
      return next as GameConfigOverrides;
    });
  }

  function setTraining(key: 'baseDays' | 'minDays' | 'maxSlots', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.training ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.training;
      else next.training = t;
      return next as GameConfigOverrides;
    });
  }

  function resetSection(s: Section) {
    setOv((prev) => {
      const next = { ...prev };
      if (s === 'TECHS') delete next.catalog;
      if (s === 'MOMENTUM') delete next.buffs;
      if (s === 'CAMPAIGN') delete next.missions;
      if (s === 'ECONOMY') {
        delete next.buildingCost; delete next.buildingResourceCost; delete next.resourceBaseValue;
        delete next.upkeepBase; delete next.upkeepRankMult; delete next.foodBase; delete next.training;
      }
      return next;
    });
  }

  async function save() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setStatus('saving'); setError('');
    try {
      const clean = pruneOverrides(ov);
      await saveWarlordConfig(clean, uid);
      setOv(clean);
      setMeta({ updatedBy: uid, updatedAt: new Date() });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (status === 'loading') {
    return <div className="p-6 text-sm text-stone-500">Loading configuration…</div>;
  }

  const SECTIONS: [Section, string][] = [
    ['ECONOMY', 'Economy'], ['TECHS', 'Techs'], ['MOMENTUM', 'Momentum'], ['CAMPAIGN', 'Campaign'], ['JSON', 'JSON'],
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">Global, live configuration</p>
        <p className="mt-1">
          One shared world means one set of numbers: saving here changes the game for <b>every</b> player
          the next time they open it. Research already in progress keeps the days it was queued with;
          new prices and durations apply from the next start. Effects of <b>already unlocked</b> techs
          are read from the current values, so a nerf applies retroactively.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SECTIONS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => { if (k === 'JSON') setJsonDraft(JSON.stringify(pruneOverrides(ov), null, 2)); setSection(k); }}
            className={`px-3 py-1 rounded text-sm border ${section === k ? 'bg-black text-white' : 'bg-white hover:bg-stone-50'}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-stone-500">
          {dirtyCount === 0 ? 'No overrides — pure defaults' : `${dirtyCount} override group(s) active`}
          {meta.updatedAt && ` · last saved ${meta.updatedAt.toLocaleString()}`}
        </span>
        <button
          onClick={save}
          disabled={status === 'saving'}
          className="px-4 py-1.5 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-sm text-red-600">Save failed: {error}</p>
      )}

      {section !== 'JSON' && (
        <button onClick={() => resetSection(section)} className="text-xs underline text-stone-500">
          Reset this section to defaults
        </button>
      )}

      {/* ── ECONOMY ── */}
      {section === 'ECONOMY' && (
        <div className="space-y-6">
          <section>
            <h3 className="font-bold mb-2">Building prices (copper)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(BuildingCostCopper) as (keyof typeof BuildingCostCopper)[]).map((t) => (
                <NumField
                  key={t}
                  label={t.replace(/_/g, ' ')}
                  def={BuildingCostCopper[t]}
                  value={ov.buildingCost?.[t]}
                  onChange={(v) => setIn('buildingCost', t, v)}
                  hint={fmtCopper(ov.buildingCost?.[t] ?? BuildingCostCopper[t])}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              A building's price is also its income basis (daily output ≈ 10% of price for
              crafting buildings), so lowering a price lowers what it earns.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Resource building output (copper/day of value)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {Object.keys(RESOURCE_BUILDING_BASE_VALUE).map((k) => (
                <NumField
                  key={k}
                  label={k.replace(/_/g, ' ')}
                  def={RESOURCE_BUILDING_BASE_VALUE[k] ?? 0}
                  value={ov.resourceBaseValue?.[k]}
                  onChange={(v) => setIn('resourceBaseValue', k, v)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-bold mb-2">Soldier upkeep (copper/day, per soldier)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(UPKEEP_BASE) as (keyof typeof UPKEEP_BASE)[]).map((t) => (
                <NumField
                  key={t}
                  label={t.replace(/_/g, ' ')}
                  def={UPKEEP_BASE[t]}
                  value={ov.upkeepBase?.[t]}
                  onChange={(v) => setIn('upkeepBase', t, v)}
                />
              ))}
            </div>
            <h4 className="font-semibold mt-3 mb-1 text-sm">Rank multiplier</h4>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(UPKEEP_RANK_MULT) as (keyof typeof UPKEEP_RANK_MULT)[]).map((r) => (
                <NumField
                  key={r}
                  label={r}
                  def={UPKEEP_RANK_MULT[r]}
                  value={ov.upkeepRankMult?.[r]}
                  onChange={(v) => setIn('upkeepRankMult', r, v)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-bold mb-2">Food consumption (per soldier/day)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(FOOD_BASE) as (keyof typeof FOOD_BASE)[]).map((t) => (
                <NumField
                  key={t}
                  label={t.replace(/_/g, ' ')}
                  def={FOOD_BASE[t]}
                  value={ov.foodBase?.[t]}
                  onChange={(v) => setIn('foodBase', t, v)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-bold mb-2">Training queue</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Base days (L1)" def={DEFAULT_TRAINING.baseDays} value={ov.training?.baseDays} onChange={(v) => setTraining('baseDays', v)} />
              <NumField label="Minimum days" def={DEFAULT_TRAINING.minDays} value={ov.training?.minDays} onChange={(v) => setTraining('minDays', v)} />
              <NumField label="Max slots" def={DEFAULT_TRAINING.maxSlots} value={ov.training?.maxSlots} onChange={(v) => setTraining('maxSlots', v)} />
            </div>
            <p className="mt-2 text-xs text-stone-500">
              A batch takes <code>max(baseDays − (level − 1), minDays)</code> days; slots are
              <code> min(level + 1, maxSlots)</code>. Research modifiers apply on top.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Building resource costs</h3>
            <div className="space-y-2">
              {(Object.keys(ResourceBuildingCosts) as (keyof typeof ResourceBuildingCosts)[]).map((t) => {
                const base = ResourceBuildingCosts[t];
                if (!base || Object.keys(base).length === 0) return null;
                const cur = ov.buildingResourceCost?.[t] ?? {};
                return (
                  <div key={t} className="flex flex-wrap items-center gap-3 border-b border-stone-100 pb-2">
                    <span className="w-40 shrink-0 text-sm font-medium">{t.replace(/_/g, ' ')}</span>
                    {Object.keys(base).map((res) => (
                      <NumField
                        key={res}
                        label={res}
                        def={(base as Record<string, number>)[res]}
                        value={(cur as Record<string, number>)[res]}
                        onChange={(v) => {
                          const nextRes = { ...(cur as Record<string, number>) };
                          if (v === undefined) delete nextRes[res]; else nextRes[res] = v;
                          setIn('buildingResourceCost', t, Object.keys(nextRes).length ? nextRes : undefined);
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ── TECHS ── */}
      {section === 'TECHS' && (
        <div className="space-y-4">
          {DEFAULT_TECHS.map((t) => {
            const o = ov.catalog?.techs?.[t.id] ?? {};
            const disabled = (ov.catalog?.disabled ?? []).includes(t.id);
            const effKeys = Object.keys(t.effects).filter((k) => k !== 'unlocks') as (keyof EffectDelta)[];
            return (
              <div key={t.id} className={`rounded border p-3 ${disabled ? 'opacity-50 bg-stone-50' : 'bg-white'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-stone-200">{BRANCH_LABEL[t.branch]} · T{t.tier}</span>
                  <span className="font-semibold">{t.name}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-stone-600">
                    <input type="checkbox" checked={disabled} onChange={(e) => toggleTechDisabled(t.id, e.target.checked)} />
                    Disabled
                  </label>
                </div>
                <p className="text-xs text-stone-500 mb-2">{t.desc}</p>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                  <NumField label="Cost (copper)" def={t.costCopper} value={o.costCopper} onChange={(v) => setTech(t.id, { costCopper: v })} hint={fmtCopper(o.costCopper ?? t.costCopper)} />
                  <NumField label="Days" def={t.days} value={o.days} onChange={(v) => setTech(t.id, { days: v })} />
                  {effKeys.map((k) => (
                    <NumField
                      key={k}
                      label={EFFECT_LABELS[k] ?? k}
                      def={t.effects[k] as number}
                      value={(o.effects as Record<string, number> | undefined)?.[k]}
                      onChange={(v) => {
                        const eff = { ...t.effects, ...(o.effects ?? {}) } as Record<string, unknown>;
                        if (v === undefined) eff[k] = t.effects[k]; else eff[k] = v;
                        setTech(t.id, { effects: eff as EffectDelta });
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-stone-500">
            Effects are capped by the engine (e.g. build cost never below ×0.5, production never
            above ×3), so an extreme value here is clamped rather than breaking the economy.
          </p>
        </div>
      )}

      {/* ── MOMENTUM ── */}
      {section === 'MOMENTUM' && (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Temporary buffs triggered by events: a won battle grants War Spoils + Martial Fervour,
            a loss grants Licking Wounds, a completed research grants Breakthrough. Re-triggering
            refreshes the duration instead of stacking.
          </p>
          {Object.values(BUFF_DEFS).map((b) => {
            const o = ov.buffs?.[b.id] ?? {};
            const effKeys = Object.keys(b.effects).filter((k) => k !== 'unlocks') as (keyof EffectDelta)[];
            return (
              <div key={b.id} className="rounded border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${b.good ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {b.good ? 'Boon' : 'Bane'}
                  </span>
                  <span className="font-semibold">{b.name}</span>
                </div>
                <p className="text-xs text-stone-500 mb-2">{b.desc}</p>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                  <NumField label="Duration (days)" def={b.days} value={o.days} onChange={(v) => setBuff(b.id, { days: v })} />
                  {effKeys.map((k) => (
                    <NumField
                      key={k}
                      label={EFFECT_LABELS[k] ?? k}
                      def={b.effects[k] as number}
                      value={(o.effects as Record<string, number> | undefined)?.[k]}
                      onChange={(v) => setBuff(b.id, { effects: { [k]: v } as EffectDelta })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CAMPAIGN ── */}
      {section === 'CAMPAIGN' && (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            PvE mission difficulty and rewards. <b>Ratio</b> is the enemy army strength relative to
            the army you deploy; escalation and win-streak multipliers apply on top.
          </p>
          {Object.values(MISSION_PRESETS).map((m) => {
            const o = (ov.missions?.[m.id] ?? {}) as Record<string, number>;
            return (
              <div key={m.id} className="rounded border bg-white p-3">
                <div className="font-semibold mb-2">{m.name}</div>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                  <NumField label="Strength ratio" def={m.ratio} value={o.ratio} onChange={(v) => setMission(m.id, { ratio: v })} />
                  <NumField label="Reward / strength" def={m.rewardCopperPerStrength} value={o.rewardCopperPerStrength} onChange={(v) => setMission(m.id, { rewardCopperPerStrength: v })} />
                  <NumField label="Min enemy tokens" def={m.minTokens} value={o.minTokens} onChange={(v) => setMission(m.id, { minTokens: v })} />
                  <NumField label="Max enemy tokens" def={m.maxTokens} value={o.maxTokens} onChange={(v) => setMission(m.id, { maxTokens: v })} />
                  <NumField label="Enemy morale" def={m.baseMorale} value={o.baseMorale} onChange={(v) => setMission(m.id, { baseMorale: v })} />
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  Reward resources: {Object.entries(m.rewardResources).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} (edit via JSON)
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── JSON ── */}
      {section === 'JSON' && (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">
            The full override document. Edit for bulk changes (or to reach fields without a form,
            like mission reward resources), then Apply and Save. Invalid values are ignored by the
            game at load time rather than breaking it.
          </p>
          <textarea
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-96 font-mono text-xs p-3 rounded border border-stone-300 bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonDraft || '{}');
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
                  setOv(parsed as GameConfigOverrides);
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  setStatus('error');
                }
              }}
              className="px-3 py-1 rounded border bg-white hover:bg-stone-50 text-sm"
            >
              Apply to form
            </button>
            <button
              onClick={() => setJsonDraft(JSON.stringify(pruneOverrides(ov), null, 2))}
              className="px-3 py-1 rounded border bg-white hover:bg-stone-50 text-sm"
            >
              Reload from form
            </button>
            <button
              onClick={() => { setOv({}); setJsonDraft('{}'); }}
              className="px-3 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 text-sm"
            >
              Clear ALL overrides
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
