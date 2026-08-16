import { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { loadWarlordConfigFull, saveWarlordConfig, pruneOverrides, ConfigConflictError } from './configApi';
import type { Timestamp } from 'firebase/firestore';
import type { GameConfigOverrides } from '@warlord/logic/config';
import {
  DEFAULT_TRAINING, DEFAULT_TICK, DEFAULT_STUDY,
  DEFAULT_RECRUIT_COST, DEFAULT_RECRUIT_SOURCES, DEFAULT_INTENSITY, DEFAULT_BARRACKS,
  DEFAULT_TRADITION_RULES,
} from '@warlord/logic/config';
import { PROMOTE_AT } from '@warlord/logic/units';
import { EFFECT_PRIMS } from '@warlord/logic/traditionPalette';
import { DUTIES } from '@warlord/logic/duty';
import { DEFAULT_LEGION_DEEDS } from '@warlord/logic/config';
import {
  BuildingCostCopper, ResourceBuildingCosts, UPKEEP_BASE, UPKEEP_RANK_MULT, FOOD_BASE,
  BUILDING_OUTPUT_VALUE, ManufacturingRecipes,
} from '@warlord/logic/economy';
import { fmtCopper, type Rank } from '@warlord/logic/types';
import {
  PendingEffect, BuildingEffect, RecipeEffect, CostEffect, CompanyEffect, MissionEffect, StudyEffect,
  IntensityEffect, CapacityEffect, RecruitSourceEffect,
} from './EffectPreview';
import { DEFAULT_TECHS, BRANCH_LABEL } from '@warlord/logic/research/catalog';
import type { TechDef } from '@warlord/logic/research/catalog';
import { BUFF_DEFS } from '@warlord/logic/research/momentum';
import type { EffectDelta } from '@warlord/logic/research/effects';
import { MISSION_PRESETS } from '@warlord/logic/combat/enemies';

// Warlord balance editor. Every field is an OVERRIDE over the game's built-in default:
// an empty box means "use the default", so the stored document only ever contains what
// an admin deliberately changed. Access is the OurDaysApp admin role (admins/{uid});
// Firestore rules enforce the write, this panel only guards the UI.

type Section = 'TECHS' | 'MOMENTUM' | 'ECONOMY' | 'ARMY' | 'CAMPAIGN' | 'JSON';

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

function NumField({ label, def, value, onChange, hint, min }: {
  label: string;
  def: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  hint?: string;
  // The game validates overrides at load and falls back to the default when one is out of
  // range. Without saying so, the field would paint an "override" the game quietly ignores.
  min?: number;
}) {
  const changed = value !== undefined && value !== def;
  const rejected = value !== undefined && (!Number.isFinite(value) || (min !== undefined && value < min));
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`w-40 shrink-0 ${changed ? 'font-semibold text-wl-accent' : 'text-wl-muted'}`}>{label}</span>
      <input
        type="number"
        step="any"
        value={value ?? ''}
        placeholder={String(def)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className={`w-28 px-2 py-1.5 min-h-[34px] rounded border text-sm text-wl-ink ${
          rejected ? 'border-wl-bad bg-wl-bad-surface' : changed ? 'border-wl-accent bg-wl-accent-surface' : 'border-wl-line bg-wl-panel'
        }`}
      />
      {hint && !rejected && <span className="text-xs text-wl-subtle">{hint}</span>}
      {rejected && (
        <span className="text-xs text-wl-bad">
          the game rejects this and keeps {def} — the value must be {min ?? 0} or more
        </span>
      )}
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

// `onSaved` lets the host apply the new balance immediately. Without it the host keeps
// the config it loaded when the screen mounted, so an admin saves, switches back to the
// game, sees the OLD numbers, and reasonably concludes the admin is broken.
export default function WarlordAdminPanel({
  onSaved,
  onDirtyChange,
  loader,
}: {
  onSaved?: (o: GameConfigOverrides) => void;
  // Testing seam: the panel lives behind auth, so without this its successful-load state
  // cannot be exercised outside a real admin session (see warlord-admin.html).
  loader?: () => Promise<import('./configApi').ConfigLoad>;
  // The host blocks navigation while there is unsaved work — leaving used to discard it
  // silently, which reads exactly like "the admin doesn't save".
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const [ov, setOv] = useState<GameConfigOverrides>({});
  // What is actually stored right now. Everything unsaved is `ov` minus this.
  const [savedOv, setSavedOv] = useState<GameConfigOverrides>({});
  const [section, setSection] = useState<Section>('ECONOMY');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<{ updatedBy?: string; updatedAt?: Date | null }>({});
  // The version this edit is based on; the save is rejected if the live doc moved on.
  const [baseVersion, setBaseVersion] = useState<Timestamp | null>(null);
  const [jsonDraft, setJsonDraft] = useState('');
  // Effects are shown at a chosen building level — a value that looks fine at L1 can be
  // very different at L3, which is where a tuned domain actually sits.
  const [previewLevel, setPreviewLevel] = useState(1);
  // Upkeep and food are per-soldier numbers; they only mean something at the size an army
  // actually reaches, so the panel prices a company rather than a man.
  const [companySize, setCompanySize] = useState(20);
  const [companyRank, setCompanyRank] = useState<Rank>('TRAINED');
  const [deployStrength, setDeployStrength] = useState(100);
  const [scriptoriumLevel, setScriptoriumLevel] = useState(1);
  // Army previews. Kept up here with the other hooks on purpose: this component returns
  // early while the configuration loads, and a hook declared below that return would take
  // the whole panel down with React #310 — green typecheck, green tests, blank admin.
  const [batchSize, setBatchSize] = useState(20);
  const [previewXpMult, setPreviewXpMult] = useState(1);

  useEffect(() => {
    let alive = true;
    (loader ?? loadWarlordConfigFull)().then((r) => {
      if (!alive) return;
      if (!r.ok) {
        // Refusing to edit is the whole point: an editor that cannot read the current
        // configuration would save a document built from defaults over the live one.
        setLoadFailed(true);
        setError(r.error);
        setStatus('error');
        return;
      }
      setOv(r.overrides);
      setSavedOv(r.overrides);
      setBaseVersion(r.updatedAt);
      setMeta({ updatedBy: r.updatedBy, updatedAt: r.updatedAt?.toDate() ?? null });
      setStatus('idle');
    });
    return () => { alive = false; };
  }, [loader]);

  const storedCount = useMemo(() => countOverrides(ov), [ov]);

  // Unsaved work, compared against what is actually stored — not a count of overrides,
  // which reads the same before and after a save and told the admin nothing.
  const pendingJson = useMemo(() => JSON.stringify(pruneOverrides(ov)), [ov]);
  const savedJson = useMemo(() => JSON.stringify(pruneOverrides(savedOv)), [savedOv]);
  const jsonPending = section === 'JSON' && jsonDraft.trim() !== '' && jsonDraft !== JSON.stringify(pruneOverrides(ov), null, 2);
  const dirty = pendingJson !== savedJson || jsonPending;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // A reload or a tab close is the other way unsaved work disappears.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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

  function setRecipe(item: string, res: string, v: number | undefined) {
    setOv((prev) => {
      const recipes: Record<string, unknown> = { ...(prev.recipes ?? {}) };
      const cur: Record<string, unknown> = { ...((recipes[item] as Record<string, unknown>) ?? {}) };
      if (v === undefined) delete cur[res]; else cur[res] = v;
      if (Object.keys(cur).length === 0) delete recipes[item];
      else recipes[item] = cur;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(recipes).length === 0) delete next.recipes;
      else next.recipes = recipes;
      return next as GameConfigOverrides;
    });
  }

  function setTick(key: 'minutesPerDay' | 'maxOfflineDays', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.tick ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.tick;
      else next.tick = t;
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

  function setStudy(key: 'baselinePerDay' | 'scriptoriumPerLevel' | 'poolCap' | 'copperPerStudy', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.study ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.study;
      else next.study = t;
      return next as GameConfigOverrides;
    });
  }

  // Hand-enumerated, and therefore the same trap `hydrateResearch` carries: a branch that
  // is missing from every clause below survives "Reset this section" in silence. `intensity`
  // and `barracks` were exactly that until the Army section existed to own them.
  // Keyed branches (one entry per source / per intensity), same delete-when-empty shape as
  // the flat ones above so an emptied group leaves no husk in the stored document.
  function setKeyed(
    branch: 'recruitSources' | 'intensity' | 'duties',
    key: string,
    field: string,
    v: number | undefined,
  ) {
    setOv((prev) => {
      const all: Record<string, Record<string, unknown>> = { ...((prev[branch] ?? {}) as Record<string, Record<string, unknown>>) };
      const one: Record<string, unknown> = { ...(all[key] ?? {}) };
      if (v === undefined) delete one[field]; else one[field] = v;
      if (Object.keys(one).length === 0) delete all[key]; else all[key] = one;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(all).length === 0) delete next[branch];
      else next[branch] = all;
      return next as GameConfigOverrides;
    });
  }

  const setRecruitSource = (key: string, field: 'costMult' | 'startingXp', v: number | undefined) =>
    setKeyed('recruitSources', key, field, v);
  const setIntensity = (key: string, field: 'dayMult' | 'payPerSoldier' | 'xpGranted' | 'washoutPct', v: number | undefined) =>
    setKeyed('intensity', key, field, v);
  const setDuty = (key: string, v: number | undefined) =>
    setKeyed('duties', key, 'copperPerSoldier', v);

  function setLegionDeeds(key: 'minSharePct' | 'heldTheLinePct' | 'killsPerBattleCap' | 'levelBase' | 'levelCurve' | 'maxLevel', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.legionDeeds ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.legionDeeds;
      else next.legionDeeds = t;
      return next as GameConfigOverrides;
    });
  }

  function setTraditionRules(key: 'minHonours' | 'adoptCostCopper', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.traditionRules ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.traditionRules;
      else next.traditionRules = t;
      return next as GameConfigOverrides;
    });
  }

  function setBarracks(key: 'capacityBase' | 'capacityPerLevel', v: number | undefined) {
    setOv((prev) => {
      const t: Record<string, unknown> = { ...(prev.barracks ?? {}) };
      if (v === undefined) delete t[key]; else t[key] = v;
      const next: Record<string, unknown> = { ...prev };
      if (Object.keys(t).length === 0) delete next.barracks;
      else next.barracks = t;
      return next as GameConfigOverrides;
    });
  }

  function resetSection(s: Section) {
    setOv((prev) => {
      const next = { ...prev };
      // Study lives with the techs it paces, not with the economy that produces it —
      // resetting prices should not silently reset how long research takes.
      if (s === 'TECHS') { delete next.catalog; delete next.study; }
      if (s === 'MOMENTUM') delete next.buffs;
      if (s === 'CAMPAIGN') delete next.missions;
      if (s === 'ARMY') {
        delete next.recruitCost; delete next.recruitSources;
        delete next.barracks; delete next.intensity; delete next.training;
        delete next.traditions; delete next.traditionRules;
        delete next.legionDeeds; delete next.duties;
      }
      if (s === 'ECONOMY') {
        delete next.buildingCost; delete next.buildingResourceCost; delete next.resourceBaseValue;
        delete next.buildingOutputValue; delete next.recipes;
        delete next.upkeepBase; delete next.upkeepRankMult; delete next.foodBase;
        delete next.tick;
      }
      return next;
    });
  }

  async function save() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (loadFailed) {
      setError('Reload before saving — the current configuration could not be read, so saving now would overwrite it.');
      setStatus('error');
      return;
    }
    setStatus('saving'); setError('');
    try {
      // A draft sitting in the JSON box was silently dropped by Save: the write succeeded,
      // said "Saved ✓", and contained none of what had just been pasted.
      let next = ov;
      if (jsonPending) {
        const parsed = JSON.parse(jsonDraft || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The JSON must be an object.');
        next = parsed as GameConfigOverrides;
        setOv(next);
      }
      const clean = pruneOverrides(next);
      await saveWarlordConfig(clean, uid, baseVersion);
      const after = await loadWarlordConfigFull();
      setOv(clean);
      setSavedOv(clean);
      setJsonDraft(JSON.stringify(clean, null, 2));
      if (after.ok) {
        setBaseVersion(after.updatedAt);
        setMeta({ updatedBy: after.updatedBy ?? uid, updatedAt: after.updatedAt?.toDate() ?? new Date() });
      }
      onSaved?.(clean);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setStatus('error');
      setError(
        e instanceof ConfigConflictError
          ? 'Someone else saved while you were editing. Reload the panel to see their version — saving now would overwrite it.'
          : e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (status === 'loading') {
    return <div className="p-6 text-sm text-wl-muted">Loading configuration…</div>;
  }

  if (loadFailed) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-3">
        <div className="rounded border border-wl-bad bg-wl-bad-surface p-4 text-sm text-wl-ink">
          <p className="font-semibold text-wl-bad">The current configuration could not be read.</p>
          <p className="mt-2">
            The editor stays closed on purpose: it cannot show you what is live, and saving from a
            blank form would replace the whole balance configuration for every player.
          </p>
          <p className="mt-2 font-mono text-xs text-wl-muted">{error}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded bg-wl-accent text-wl-accent-ink text-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  const SECTIONS: [Section, string][] = [
    ['ECONOMY', 'Economy'], ['ARMY', 'Army'], ['TECHS', 'Techs'], ['MOMENTUM', 'Momentum'], ['CAMPAIGN', 'Campaign'], ['JSON', 'JSON'],
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="rounded border border-wl-accent-line bg-wl-accent-surface p-3 text-sm text-wl-ink">
        <p className="font-semibold">Global, live configuration</p>
        <p className="mt-1">
          One shared world means one set of numbers: saving here changes the game for <b>every</b> player
          the next time they open it. Research already in progress keeps the study total it was
          started with, so a retune cannot move the finish line under a player mid-project; new costs
          apply from the next start. Effects of <b>already unlocked</b> techs are read from the current
          values, so a nerf applies retroactively.
        </p>
      </div>

      <PendingEffect saved={savedOv} pending={ov} />

      <div className="flex flex-wrap items-center gap-2">
        {SECTIONS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => { if (k === 'JSON') setJsonDraft(JSON.stringify(pruneOverrides(ov), null, 2)); setSection(k); }}
            className={`px-3 py-1 rounded text-sm border ${section === k ? 'bg-wl-accent text-wl-accent-ink' : 'bg-wl-panel hover:bg-wl-panel-muted'}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-wl-muted">
          {dirty
            ? <span className="text-wl-warn font-semibold">Unsaved changes</span>
            : storedCount === 0 ? 'No overrides — pure defaults' : `${storedCount} override group(s) stored`}
          {meta.updatedAt && ` · last saved ${meta.updatedAt.toLocaleString()}`}
        </span>
        <button
          onClick={save}
          disabled={status === 'saving' || loadFailed || !dirty}
          title={loadFailed ? 'The current configuration could not be read — reload first' : !dirty ? 'Nothing to save' : 'Save for every player'}
          className="px-4 py-1.5 min-h-[36px] rounded bg-wl-accent text-wl-accent-ink text-sm disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-sm text-wl-bad">Save failed: {error}</p>
      )}

      {section !== 'JSON' && (
        <button onClick={() => resetSection(section)} className="text-xs underline text-wl-muted">
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
                <div key={t} className="space-y-0.5">
                  <NumField
                    label={t.replace(/_/g, ' ')}
                    def={BuildingCostCopper[t]}
                    value={ov.buildingCost?.[t]}
                    onChange={(v) => setIn('buildingCost', t, v)}
                  min={0}
                    hint={fmtCopper(ov.buildingCost?.[t] ?? BuildingCostCopper[t])}
                  />
                  <CostEffect type={t} config={ov} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-wl-muted">
              What it costs to build. For every building listed under “Daily output” below, the
              price no longer decides what it earns — those are two independent knobs now. Only a
              building with no output value of its own still falls back to 10% of its price per day.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Daily output per building (copper/day at L1)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(BUILDING_OUTPUT_VALUE) as (keyof typeof BUILDING_OUTPUT_VALUE)[]).map((t) => (
                <div key={t} className="space-y-0.5">
                  <NumField
                    label={String(t).replace(/_/g, ' ')}
                    def={BUILDING_OUTPUT_VALUE[t] ?? 0}
                    value={ov.buildingOutputValue?.[t]}
                    onChange={(v) => setIn('buildingOutputValue', t, v)}
                  min={0}
                    hint={fmtCopper(ov.buildingOutputValue?.[t] ?? BUILDING_OUTPUT_VALUE[t] ?? 0)}
                  />
                  <BuildingEffect type={t} level={previewLevel} config={ov} />
                </div>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-wl-muted">
              Show effects at building level
              <select
                value={previewLevel}
                onChange={(e) => setPreviewLevel(Number(e.target.value))}
                className="px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <p className="mt-2 text-xs text-wl-muted">
              How much VALUE a building turns out per day, scaled by its level and by research.
              This used to be 10% of the building's price, which made a workshop's scale an accident
              of what it cost to build — a blacksmith produced a hundred times what a lumber mill did
              and ate raw material to match. Prices now only gate construction.
            </p>
            <p className="mt-1 text-xs text-wl-warn">
              A building's <b>focus slider</b> splits that value between coin and materials, and a
              newly built one starts at <b>100% coin</b> — so raising a material output changes
              nothing at all for a player who never moved the slider. If a change looks like it did
              not apply, check the focus before checking the balance.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Crafting recipes (materials per item)</h3>
            <div className="space-y-2">
              {Object.entries(ManufacturingRecipes).map(([item, recipe]) => {
                const cur = (ov.recipes?.[item] ?? {}) as Record<string, number>;
                return (
                  <div key={item} className="border-b border-wl-line pb-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="w-40 shrink-0 text-sm font-medium">{item.replace(/_/g, ' ')}</span>
                      {Object.keys(recipe).map((r) => (
                        <NumField
                          key={r}
                          label={r.replace(/_/g, ' ')}
                          def={(recipe as Record<string, number>)[r]}
                          value={cur[r]}
                          onChange={(v) => setRecipe(item, r, v)}
                  min={0}
                        />
                      ))}
                    </div>
                    <div className="ml-40 pl-3"><RecipeEffect item={item} config={ov} /></div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-wl-muted">
              Keep the materials worth LESS than the item, or crafting destroys value and a workshop
              becomes a way to turn resources into less than you started with — which is exactly what
              every recipe did before this was tunable.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Soldier upkeep (copper/day, per soldier)</h3>
            <label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-wl-muted">
              Show the cost of a company of
              <input
                type="number"
                min={1}
                value={companySize}
                onChange={(e) => setCompanySize(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
              />
              soldiers at rank
              <select
                value={companyRank}
                onChange={(e) => setCompanyRank(e.target.value as Rank)}
                className="px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
              >
                {(Object.keys(UPKEEP_RANK_MULT) as Rank[]).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(UPKEEP_BASE) as (keyof typeof UPKEEP_BASE)[]).map((t) => (
                <div key={t} className="space-y-0.5">
                  <NumField
                    label={t.replace(/_/g, ' ')}
                    def={UPKEEP_BASE[t]}
                    value={ov.upkeepBase?.[t]}
                    onChange={(v) => setIn('upkeepBase', t, v)}
                  min={0}
                  />
                  <CompanyEffect type={t} rank={companyRank} count={companySize} config={ov} />
                </div>
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
                  min={0}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-bold mb-2">Food consumption (per soldier/day)</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              {(Object.keys(FOOD_BASE) as (keyof typeof FOOD_BASE)[]).map((t) => (
                <div key={t} className="space-y-0.5">
                  <NumField
                    label={t.replace(/_/g, ' ')}
                    def={FOOD_BASE[t]}
                    value={ov.foodBase?.[t]}
                    onChange={(v) => setIn('foodBase', t, v)}
                  min={0}
                  />
                  <CompanyEffect type={t} rank={companyRank} count={companySize} config={ov} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-wl-muted">
              Food is eaten every day, including every day caught up after an absence. Compare a
              company's appetite against what a farm produces per day above — an army that eats
              more than the domain grows starves as soon as the stores run out.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Day clock</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Real minutes per day" def={DEFAULT_TICK.minutesPerDay} value={ov.tick?.minutesPerDay} onChange={(v) => setTick('minutesPerDay', v)} />
              <NumField label="Offline catch-up (days)" def={DEFAULT_TICK.maxOfflineDays} value={ov.tick?.maxOfflineDays} onChange={(v) => setTick('maxOfflineDays', v)} />
            </div>
            <p className="mt-2 text-xs text-wl-muted">
              The clock is anchored to the last completed day and stored in the save, so time
              spent away counts: on return the game resolves every whole day that elapsed, up to
              the catch-up limit (the excess is skipped, never banked). Each caught-up day still
              charges upkeep and eats food — a large limit can starve an army the player never
              got to feed. 0 = no offline catch-up (the day you are playing still ticks).
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
                  <div key={t} className="flex flex-wrap items-center gap-3 border-b border-wl-line pb-2">
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

      {/* ── ARMY ── */}
      {/* Everything from "take on a man" to "he walks out of the barracks". Three of these
          four branches had no form at all until now — they were reachable only by hand-editing
          the JSON tab, which is why the two explain functions written for them sat unused. */}
      {section === 'ARMY' && (
        <div className="space-y-6">
          <label className="flex flex-wrap items-center gap-2 text-xs text-wl-muted">
            Show a batch of
            <input
              type="number"
              min={1}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
            />
            men at barracks level
            <select
              value={previewLevel}
              onChange={(e) => setPreviewLevel(Number(e.target.value))}
              className="px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
            >
              {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            with training research at ×
            <input
              type="number"
              min={1}
              step="0.05"
              value={previewXpMult}
              onChange={(e) => setPreviewXpMult(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
            />
          </label>

          <section>
            <h3 className="font-bold mb-2">Recruiting</h3>
            <NumField label="Base price / man" def={DEFAULT_RECRUIT_COST} value={ov.recruitCost} onChange={(v) => setOv((p) => { const n = { ...p }; if (v === undefined) delete n.recruitCost; else n.recruitCost = v; return n; })} min={0} hint={fmtCopper(ov.recruitCost ?? DEFAULT_RECRUIT_COST)} />
            <div className="mt-3 space-y-3">
              {Object.keys(DEFAULT_RECRUIT_SOURCES).map((key) => (
                <div key={key} className="rounded border border-wl-line bg-wl-panel p-2 space-y-1">
                  <div className="text-sm font-semibold">{key.replace(/_/g, ' ')}</div>
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                    <NumField label="Price ×" def={DEFAULT_RECRUIT_SOURCES[key].costMult} value={ov.recruitSources?.[key]?.costMult} onChange={(v) => setRecruitSource(key, 'costMult', v)} min={0} />
                    <NumField label="Starting XP" def={DEFAULT_RECRUIT_SOURCES[key].startingXp} value={ov.recruitSources?.[key]?.startingXp} onChange={(v) => setRecruitSource(key, 'startingXp', v)} min={0} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2"><RecruitSourceEffect qty={batchSize} intensity="STANDARD" xpMult={previewXpMult} config={ov} /></div>
            <p className="mt-2 text-xs text-wl-muted">
              Starting XP is <b>capped below {PROMOTE_AT.NOVICE}</b> by the game, whatever you type
              here: at or above the first promotion threshold a source would hand over a whole rank
              for copper alone — no extra days, no drill pay, no wash-out — and rank is the one thing
              this game only ever sells for time. Raise it past the cap and the effect line above
              simply stops moving. Price is where the tiers are meant to differ.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Legions</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Victories to swear" def={DEFAULT_TRADITION_RULES.minHonours} value={ov.traditionRules?.minHonours} onChange={(v) => setTraditionRules('minHonours', v)} min={0} />
              <NumField label="Oath cost (copper)" def={DEFAULT_TRADITION_RULES.adoptCostCopper} value={ov.traditionRules?.adoptCostCopper} onChange={(v) => setTraditionRules('adoptCostCopper', v)} min={0} hint={fmtCopper(ov.traditionRules?.adoptCostCopper ?? DEFAULT_TRADITION_RULES.adoptCostCopper)} />
              <NumField label="Share of the line to be credited (%)" def={DEFAULT_LEGION_DEEDS.minSharePct} value={ov.legionDeeds?.minSharePct} onChange={(v) => setLegionDeeds('minSharePct', v)} min={1} />
              <NumField label="Losses that count as a grim stand (%)" def={DEFAULT_LEGION_DEEDS.heldTheLinePct} value={ov.legionDeeds?.heldTheLinePct} onChange={(v) => setLegionDeeds('heldTheLinePct', v)} min={1} />
              <NumField label="Kills counted per battle" def={DEFAULT_LEGION_DEEDS.killsPerBattleCap} value={ov.legionDeeds?.killsPerBattleCap} onChange={(v) => setLegionDeeds('killsPerBattleCap', v)} min={1} />
              <NumField label="Max legion level" def={DEFAULT_LEGION_DEEDS.maxLevel} value={ov.legionDeeds?.maxLevel} onChange={(v) => setLegionDeeds('maxLevel', v)} min={1} />
              <NumField label="Renown for level 2" def={DEFAULT_LEGION_DEEDS.levelBase} value={ov.legionDeeds?.levelBase} onChange={(v) => setLegionDeeds('levelBase', v)} min={1} />
              <NumField label="Level curve" def={DEFAULT_LEGION_DEEDS.levelCurve} value={ov.legionDeeds?.levelCurve} onChange={(v) => setLegionDeeds('levelCurve', v)} min={1} />
            </div>
            <div className="mt-3 space-y-1">
              <div className="text-sm font-semibold">Duties</div>
              <div className="grid md:grid-cols-3 gap-x-6 gap-y-1">
                {DUTIES.map((d) => (
                  <NumField key={d.id} label={`${d.name} — copper/soldier/day`} def={d.copperPerSoldier} value={ov.duties?.[d.id]?.copperPerSoldier} onChange={(v) => setDuty(d.id, v)} />
                ))}
              </div>
              <p className="text-xs text-wl-muted">A negative figure means the duty PAYS. That side is bounded harder than the cost side: a duty that pays too much is income proportional to army size.</p>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold mb-1">The palette players build from</div>
              <div className="text-xs text-wl-muted space-y-0.5">
                {EFFECT_PRIMS.map((p) => (
                  <div key={p.id}>
                    <b>{p.name}</b> — {p.channel}, {p.step > 0 ? '+' : ''}{p.step}/step, up to {p.maxSteps}, {p.points}pt · proof: {p.proofPerStep} {p.proof}/step
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-wl-muted">
                Read-only on purpose. A tradition is <b>authored by the player</b> out of these pieces,
                and a design stores piece ids and step counts — never numbers. That is what makes an
                inflated tradition unrepresentable rather than merely refused, and it is why retuning
                a piece here would apply retroactively to every tree already grown. Making the pieces
                editable is its own slice, with its own migration.
              </p>
            </div>
          </section>

          <section>
            <h3 className="font-bold mb-2">Training queue</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Base days (L1)" def={DEFAULT_TRAINING.baseDays} value={ov.training?.baseDays} onChange={(v) => setTraining('baseDays', v)} />
              <NumField label="Minimum days" def={DEFAULT_TRAINING.minDays} value={ov.training?.minDays} onChange={(v) => setTraining('minDays', v)} />
              <NumField label="Max slots" def={DEFAULT_TRAINING.maxSlots} value={ov.training?.maxSlots} onChange={(v) => setTraining('maxSlots', v)} />
            </div>
            <p className="mt-2 text-xs text-wl-muted">
              A batch takes <code>max(baseDays − (level − 1), minDays)</code> days; slots are
              <code> min(level + 1, maxSlots)</code>. Research modifiers apply on top.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Training intensity</h3>
            <div className="space-y-3">
              {Object.keys(DEFAULT_INTENSITY).map((key) => (
                <div key={key} className="rounded border border-wl-line bg-wl-panel p-2 space-y-1">
                  <div className="text-sm font-semibold">{key.replace(/_/g, ' ')}</div>
                  <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                    <NumField label="Days ×" def={DEFAULT_INTENSITY[key].dayMult} value={ov.intensity?.[key]?.dayMult} onChange={(v) => setIntensity(key, 'dayMult', v)} min={0.1} />
                    <NumField label="Drill pay / soldier" def={DEFAULT_INTENSITY[key].payPerSoldier} value={ov.intensity?.[key]?.payPerSoldier} onChange={(v) => setIntensity(key, 'payPerSoldier', v)} min={0} />
                    <NumField label="XP granted" def={DEFAULT_INTENSITY[key].xpGranted} value={ov.intensity?.[key]?.xpGranted} onChange={(v) => setIntensity(key, 'xpGranted', v)} min={0} />
                    <NumField label="Wash-out %" def={DEFAULT_INTENSITY[key].washoutPct} value={ov.intensity?.[key]?.washoutPct} onChange={(v) => setIntensity(key, 'washoutPct', v)} min={0} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2"><IntensityEffect level={previewLevel} qty={batchSize} xpMult={previewXpMult} config={ov} /></div>
            <p className="mt-2 text-xs text-wl-muted">
              STANDARD is the neutral member — ×1 days, no pay, no XP, no wash-out — so a batch that
              names no intensity behaves exactly as it always did. Wash-out destroys the lost men's
              <b> equipment</b> as well, which is deliberate: it is what makes rushing men you paid a
              premium for cost more than rushing levies. However far the XP is pushed here, a batch
              still promotes at most one rank; the surplus is discarded and the recruit screen says so.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">Barracks capacity</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Places at L1" def={DEFAULT_BARRACKS.capacityBase} value={ov.barracks?.capacityBase} onChange={(v) => setBarracks('capacityBase', v)} min={1} />
              <NumField label="Places per level" def={DEFAULT_BARRACKS.capacityPerLevel} value={ov.barracks?.capacityPerLevel} onChange={(v) => setBarracks('capacityPerLevel', v)} min={0} />
            </div>
            <div className="mt-2"><CapacityEffect config={ov} /></div>
            <p className="mt-2 text-xs text-wl-muted">
              Recruits and trained soldiers waiting to be formed take up room; soldiers already in a
              unit are in the field and do not. Only recruiting can hit the ceiling — training and
              conversion move men about without adding any.
            </p>
          </section>
        </div>
      )}

      {/* ── TECHS ── */}
      {section === 'TECHS' && (
        <div className="space-y-4">
          <section className="rounded border border-wl-line bg-wl-panel p-3">
            <h3 className="font-bold mb-2">Study — the pace of research</h3>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
              <NumField label="Reference pace / day" def={DEFAULT_STUDY.baselinePerDay} value={ov.study?.baselinePerDay} onChange={(v) => setStudy('baselinePerDay', v)} min={1} />
              <NumField label="Scriptorium / level" def={DEFAULT_STUDY.scriptoriumPerLevel} value={ov.study?.scriptoriumPerLevel} onChange={(v) => setStudy('scriptoriumPerLevel', v)} min={0} />
              <NumField label="Copper per study point" def={DEFAULT_STUDY.copperPerStudy} value={ov.study?.copperPerStudy} onChange={(v) => setStudy('copperPerStudy', v)} min={1} />
              <NumField label="Branch bank cap" def={DEFAULT_STUDY.poolCap} value={ov.study?.poolCap} onChange={(v) => setStudy('poolCap', v)} min={0} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-wl-muted">
              Show the pace of a Scriptorium at level
              <select
                value={scriptoriumLevel}
                onChange={(e) => setScriptoriumLevel(Number(e.target.value))}
                className="px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
              >
                <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
              </select>
            </label>
            <div className="mt-1"><StudyEffect scriptoriumLevel={scriptoriumLevel} config={ov} /></div>
            <p className="mt-2 text-xs text-wl-muted">
              A tech's <b>Effort</b> below is no longer elapsed time — it is multiplied by the reference
              pace to get what the tech costs in Study. A Scriptorium is deliberately slower than that
              pace on its own: the rest comes from buildings the player dedicates to study, which is the
              decision the whole system exists for. Raising the Scriptorium toward the reference pace
              makes research free again.
            </p>
          </section>

          {DEFAULT_TECHS.map((t) => {
            const o = ov.catalog?.techs?.[t.id] ?? {};
            const disabled = (ov.catalog?.disabled ?? []).includes(t.id);
            const effKeys = Object.keys(t.effects).filter((k) => k !== 'unlocks') as (keyof EffectDelta)[];
            return (
              <div key={t.id} className={`rounded border p-3 ${disabled ? 'opacity-50 bg-wl-panel-muted' : 'bg-wl-panel'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-wl-panel-muted">{BRANCH_LABEL[t.branch]} · T{t.tier}</span>
                  <span className="font-semibold">{t.name}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-wl-muted">
                    <input type="checkbox" checked={disabled} onChange={(e) => toggleTechDisabled(t.id, e.target.checked)} />
                    Disabled
                  </label>
                </div>
                <p className="text-xs text-wl-muted mb-2">{t.desc}</p>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                  <NumField label="Cost (copper)" def={t.costCopper} value={o.costCopper} onChange={(v) => setTech(t.id, { costCopper: v })} hint={fmtCopper(o.costCopper ?? t.costCopper)} />
                  <NumField label="Effort (days at pace)" def={t.days} value={o.days} onChange={(v) => setTech(t.id, { days: v })} min={0} />
                  {effKeys.map((k) => (
                    <NumField
                      key={k}
                      label={EFFECT_LABELS[k] ?? k}
                      def={t.effects[k] as number}
                      value={(o.effects as Record<string, number> | undefined)?.[k]}
                      onChange={(v) => {
                        // Clearing the box must DELETE the key. Writing the default back
                        // in looked identical on screen but kept the override stored, so
                        // the only way to undo an experiment was to reset the whole section.
                        const eff = { ...(o.effects ?? {}) } as Record<string, unknown>;
                        if (v === undefined) delete eff[k]; else eff[k] = v;
                        setTech(t.id, { effects: (Object.keys(eff).length ? eff : undefined) as EffectDelta | undefined });
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-wl-muted">
            Effects are capped by the engine (e.g. build cost never below ×0.5, production never
            above ×3), so an extreme value here is clamped rather than breaking the economy.
          </p>
        </div>
      )}

      {/* ── MOMENTUM ── */}
      {section === 'MOMENTUM' && (
        <div className="space-y-4">
          <p className="text-sm text-wl-muted">
            Temporary buffs triggered by events: a won battle grants War Spoils + Martial Fervour,
            a loss grants Licking Wounds, a completed research grants Breakthrough. Re-triggering
            refreshes the duration instead of stacking.
          </p>
          {Object.values(BUFF_DEFS).map((b) => {
            const o = ov.buffs?.[b.id] ?? {};
            const effKeys = Object.keys(b.effects).filter((k) => k !== 'unlocks') as (keyof EffectDelta)[];
            return (
              <div key={b.id} className="rounded border bg-wl-panel p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${b.good ? 'bg-wl-good-surface text-wl-good' : 'bg-wl-bad-surface text-wl-bad'}`}>
                    {b.good ? 'Boon' : 'Bane'}
                  </span>
                  <span className="font-semibold">{b.name}</span>
                </div>
                <p className="text-xs text-wl-muted mb-2">{b.desc}</p>
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
          <p className="text-sm text-wl-muted">
            PvE mission difficulty and rewards. <b>Ratio</b> is the enemy army strength relative to
            the army you deploy; escalation and win-streak multipliers apply on top.
          </p>
          <label className="flex items-center gap-2 text-xs text-wl-muted">
            Show what each mission does against an army of strength
            <input
              type="number"
              min={1}
              value={deployStrength}
              onChange={(e) => setDeployStrength(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 px-2 py-1 min-h-[32px] rounded border border-wl-line bg-wl-panel text-wl-ink"
            />
          </label>
          {Object.values(MISSION_PRESETS).map((m) => {
            const o = (ov.missions?.[m.id] ?? {}) as Record<string, number>;
            return (
              <div key={m.id} className="rounded border bg-wl-panel p-3">
                <div className="font-semibold mb-2">{m.name}</div>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                  <NumField label="Strength ratio" def={m.ratio} value={o.ratio} onChange={(v) => setMission(m.id, { ratio: v })} />
                  <NumField label="Reward / strength" def={m.rewardCopperPerStrength} value={o.rewardCopperPerStrength} onChange={(v) => setMission(m.id, { rewardCopperPerStrength: v })} />
                  <NumField label="Min enemy tokens" def={m.minTokens} value={o.minTokens} onChange={(v) => setMission(m.id, { minTokens: v })} />
                  <NumField label="Max enemy tokens" def={m.maxTokens} value={o.maxTokens} onChange={(v) => setMission(m.id, { maxTokens: v })} />
                  <NumField label="Enemy morale" def={m.baseMorale} value={o.baseMorale} onChange={(v) => setMission(m.id, { baseMorale: v })} />
                </div>
                <div className="mt-2"><MissionEffect id={m.id} deployedStrength={deployStrength} config={ov} /></div>
                <div className="mt-1 text-xs text-wl-muted">
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
          <p className="text-sm text-wl-muted">
            The full override document. Edit for bulk changes (or to reach fields without a form,
            like mission reward resources), then Apply and Save. Invalid values are ignored by the
            game at load time rather than breaking it.
          </p>
          <textarea
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-96 font-mono text-xs p-3 rounded border border-wl-line bg-wl-panel text-wl-ink"
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
              className="px-3 py-1 rounded border bg-wl-panel hover:bg-wl-panel-muted text-sm"
            >
              Apply to form
            </button>
            <button
              onClick={() => setJsonDraft(JSON.stringify(pruneOverrides(ov), null, 2))}
              className="px-3 py-1 rounded border bg-wl-panel hover:bg-wl-panel-muted text-sm"
            >
              Reload from form
            </button>
            <button
              onClick={() => { setOv({}); setJsonDraft('{}'); }}
              className="px-3 py-1 rounded border border-wl-bad text-wl-bad hover:bg-wl-bad-surface text-sm"
            >
              Clear ALL overrides
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
