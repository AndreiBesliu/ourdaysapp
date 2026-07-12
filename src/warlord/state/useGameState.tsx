import { useEffect, useState } from 'react'

//logic
import { GOLD, fmtCopper, Ranks, type Rank, type SoldierType, type Building, type ResourceMap } from '../logic/types'
import type { Unit } from '../logic/types'
import { BuildingOutputChoices, BuildingCostCopper, FocusOptions, ResourceBuildingCosts } from '../logic/economy'
import { makeEmptyInventories, isHorseKey, type HorseKey } from '../logic/helpers'
import { demandFor, ensureEquipOrBuy } from '../logic/equipment'
import { itemValueCopper } from '../logic/items'  // if you use buy/sell here
import { batchSlots, batchDurationDays } from '../logic/batches' // or from your batches helper
import {
  queueLightTraining as qLight, queueLightCavConversion as qLC,
  queueHeavyConversion as qHC, queueHorseArcherConversion as qHA
} from '../logic/training'

//state
import { dailyUpkeepCopper, dailyFoodConsumption, buildingUpgradeCostCopper, buildingLevelMult, BUILDING_MAX_LEVEL } from '../logic/economy'
import { useEconomy } from './useEconomy'
import { useUnits } from './useUnits'
import useBarracks, { emptyBarracks } from './useBarracks'
import { computeReady, mergeUnits, splitUnit, applyMoraleChange, trainingGainPerDay, promoteBuckets, computeUnitAvgXP } from '../logic/units'
import { Registry } from '../logic/registry'
import { rollDailyEvent } from '../logic/events'
import { loadSampleMod } from '../mods/sampleMod';
import { useCampaign, emptyCampaign, hydrateCampaign, type CampaignReward } from './useCampaign'
import { applyCommand } from '../logic/combat/engine'
import { chooseEnemyCommands } from '../logic/combat/ai'
import { createBattle, MISSION_PRESETS, DIFFICULTIES, escalationMult, streakLootMult } from '../logic/combat/enemies'
import { applyBattleResult, prettyName } from '../logic/combat/army'
import type { Command, Difficulty } from '../logic/combat/types'

// Initialize registry with core data
Registry.init();
// Load mods (in a real app, this would be dynamic)
loadSampleMod();

function defaultBuildings(): Building[] {
  return [
    { id: 'barracks', type: 'BARRACKS', focusCoinPct: 100, fractionalBuffer: 0 },
    // { id: 'wood1', type: 'WOODWORKER', focusCoinPct: 60, outputItem: 'BOW', fractionalBuffer: 0 },
    { id: 'market', type: 'MARKET', focusCoinPct: 100, fractionalBuffer: 0 },
  ]
}

const emptyResources: ResourceMap = {
  WOOD: 100, STONE: 0,
  IRON_ORE: 0, COAL: 0, COPPER_ORE: 0, SILVER_ORE: 0,
  IRON_INGOT: 0, COPPER_INGOT: 0, SILVER_INGOT: 0,
  FOOD: 50,
}

function readSaveBlob(saveKey: string): any {
  try {
    const raw = localStorage.getItem(saveKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function useGameState(saveKey = 'warlord_save') {
  // Hydrate-on-init: read the save ONCE, synchronously, before any state exists.
  // (Previously the save-effect below ran on mount with fresh state and clobbered the
  // stored save before the player could press Load — a page refresh lost all progress.)
  const [saved] = useState(() => readSaveBlob(saveKey))
  // Defense-in-depth: remember which key this state was hydrated from. If the caller
  // ever changes saveKey without remounting (they should pass key={saveKey}), the
  // persist effect must NOT write state hydrated from another user's key.
  const [hydratedKey] = useState(saveKey)

  // day + log
  const [day, setDay] = useState<number>(() => saved?.day ?? 1)
  const [log, setLog] = useState<string[]>(() => saved?.log ?? [])
  const addLog = (s: string) => setLog(l => [`${new Date().toLocaleString()} — ${s} `, ...l])

  const [mergePick, setMergePick] = useState<string[]>([])

  // slices (each hydrates from the same save blob)
  const econ = useEconomy(10 * GOLD, defaultBuildings, saved ?? undefined)
  const barr = useBarracks(saved ?? undefined)
  const unit = useUnits(saved?.units ?? undefined)
  const camp = useCampaign(saved?.campaign)

  useEffect(() => {
    if (saveKey !== hydratedKey) return // never clobber another key's save (see above)
    localStorage.setItem(saveKey, JSON.stringify({
      day, log,
      wallet: econ.wallet, inv: econ.inv, buildings: econ.buildings, resources: econ.resources,
      barracks: barr.barracks, barracksLevel: barr.barracksLevel,
      recruits: barr.recruits, batches: barr.batches,
      units: unit.units,
      campaign: camp.campaign,
    }))
  }, [saveKey, day, log, econ.wallet, econ.inv, econ.buildings, econ.resources, barr.barracks, barr.barracksLevel, barr.recruits, barr.batches, unit.units, camp.campaign]) // econ.resources & camp.campaign included so those-only changes persist

  function loadSave() {
    const raw = localStorage.getItem(saveKey)
    if (!raw) return addLog('No save found.')
    try {
      const s = JSON.parse(raw)
      setDay(s.day ?? 1); setLog(s.log ?? [])
      econ.setWallet(s.wallet ?? 5 * GOLD)
      econ.setInv(s.inv ?? econ.inv)
      econ.setBuildings(s.buildings ?? econ.buildings)
      econ.setResources(s.resources ?? emptyResources)
      barr.setBarracks(s.barracks ?? barr.barracks)
      barr.setBarracksLevel(s.barracksLevel ?? 1)
      barr.setRecruits(s.recruits ?? { count: 0, avgXP: 0 })
      barr.setBatches(s.batches ?? [])
      unit.setUnits(s.units ?? [])
      camp.setCampaign(hydrateCampaign(s.campaign))
      addLog('Loaded save.')
    } catch { addLog('Failed to load save.') }
  }

  function resetAll() {
    setDay(1); setLog([])
    econ.setWallet(10 * GOLD)
    econ.setInv(makeEmptyInventories())
    econ.setBuildings(defaultBuildings())
    econ.setResources({ ...emptyResources })
    barr.setBarracks(emptyBarracks())
    barr.setBarracksLevel(1)
    barr.setRecruits({ count: 0, avgXP: 0 })
    barr.setBatches([])
    unit.setUnits([])
    camp.setCampaign(emptyCampaign())
    setMergePick([])
  }

  // type HorseKey = 'LIGHT_HORSE' | 'HEAVY_HORSE'
  // const isHorseKey = (x: string): x is HorseKey => x === 'LIGHT_HORSE' || x === 'HEAVY_HORSE'

  function buy(kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE', subtype: string, qty: number) {
    if (qty <= 0 || !Number.isFinite(qty)) return
    if (kind === 'HORSE') {
      if (!econ.hasStable) { addLog('You need a STABLE to buy horses.'); return }
      if (!isHorseKey(subtype)) { addLog('Invalid horse type.'); return }
    }

    const price = itemValueCopper(subtype) * qty
    if (econ.wallet < price) { addLog('Not enough funds.'); return }

    econ.setWallet(w => w - price)
    if (kind === 'RESOURCE') {
      econ.setResources(prev => {
        const n = { ...prev }
        n[subtype as keyof ResourceMap] = (n[subtype as keyof ResourceMap] || 0) + qty
        return n
      })
    } else {
      econ.setInv(prev => {
        const n = structuredClone(prev)
        if (kind === 'WEAPON') n.weapons[subtype] = (n.weapons[subtype] ?? 0) + qty
        else if (kind === 'ARMOR') n.armors[subtype] = (n.armors[subtype] ?? 0) + qty
        else n.horses[subtype as HorseKey].active += qty
        return n
      })
    }
    addLog(`Bought ${qty} ${subtype} for ${fmtCopper(price)}.`)
  }

  function sell(kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE', subtype: string, qty: number) {
    if (qty <= 0 || !Number.isFinite(qty)) return

    if (kind === 'RESOURCE') {
      const have = econ.resources[subtype as keyof ResourceMap] || 0
      if (have < qty) { addLog('Not enough resources to sell.'); return }
      const price = itemValueCopper(subtype) * qty
      econ.setResources(prev => {
        const n = { ...prev }
        n[subtype as keyof ResourceMap] -= qty
        return n
      })
      econ.setWallet(w => w + price)
      addLog(`Sold ${qty} ${subtype} for ${fmtCopper(price)}.`)
    } else {
      let have = 0
      if (kind === 'WEAPON') have = econ.inv.weapons[subtype] ?? 0
      else if (kind === 'ARMOR') have = econ.inv.armors[subtype] ?? 0
      else {
        if (!isHorseKey(subtype)) { addLog('Invalid horse type.'); return }
        have = econ.inv.horses[subtype as HorseKey].active
      }
      if (have < qty) { addLog('Not enough items to sell.'); return }

      const price = itemValueCopper(subtype) * qty
      econ.setInv(prev => {
        const n = structuredClone(prev)
        if (kind === 'WEAPON') n.weapons[subtype] -= qty
        else if (kind === 'ARMOR') n.armors[subtype] -= qty
        else n.horses[subtype as HorseKey].active -= qty
        return n
      })
      econ.setWallet(w => w + price)
      addLog(`Sold ${qty} ${subtype} for ${fmtCopper(price)}.`)
    }
  }

  function buyBuilding(type: Building['type']) {
    if (econ.buildings.some(b => b.type === type)) { addLog(`You already own a ${type}.`); return }
    const cost = BuildingCostCopper[type] || 0
    if (econ.wallet < cost) { addLog(`Not enough funds to buy ${type}. Need ${fmtCopper(cost)}.`); return }

    // Check Resources
    const resCost = ResourceBuildingCosts[type] || {}
    const missing: string[] = []
    for (const [res, amt] of Object.entries(resCost)) {
      if ((econ.resources[res as keyof ResourceMap] || 0) < amt) {
        missing.push(`${amt} ${res} `)
      }
    }
    if (missing.length > 0) {
      addLog(`Not enough resources: need ${missing.join(', ')}.`)
      return;
    }

    // Deduct
    econ.setWallet(w => w - cost)
    econ.setResources(prev => {
      const n = { ...prev }
      for (const [res, amt] of Object.entries(resCost)) {
        n[res as keyof ResourceMap] -= amt
      }
      return n
    })

    const id = `${type.toLowerCase()}_${Math.random().toString(36).slice(2, 8)} `
    const outputItem = BuildingOutputChoices[type].options[0]
    econ.setBuildings(bs => [...bs, { id, type, focusCoinPct: 100, outputItem, fractionalBuffer: 0 }])
    addLog(`Bought ${type} for ${fmtCopper(cost)} and resources.`)
  }

  function setBuildingFocus(id: string, pct: number) {
    econ.setBuildings(bs => bs.map(b => b.id === id ? { ...b, focusCoinPct: pct as any } : b))
  }

  // Generic building upgrade (BARRACKS has its own leveling; MARKET/STABLE have no
  // passive production to scale, so none of the three is upgradable here).
  function upgradeBuilding(id: string) {
    const b = econ.buildings.find(x => x.id === id)
    if (!b) return
    if (['BARRACKS', 'MARKET', 'STABLE'].includes(b.type)) { addLog(`${b.type} cannot be upgraded here.`); return }
    const lvl = b.level ?? 1
    if (lvl >= BUILDING_MAX_LEVEL) { addLog(`${b.type} is already at max level (L${BUILDING_MAX_LEVEL}).`); return }
    const cost = buildingUpgradeCostCopper(b.type, lvl)
    if (cost <= 0) { addLog(`${b.type} cannot be upgraded.`); return }
    if (econ.wallet < cost) { addLog(`Not enough funds to upgrade ${b.type}. Need ${fmtCopper(cost)}.`); return }
    econ.setWallet(w => w - cost)
    econ.setBuildings(bs => bs.map(x => x.id === id ? { ...x, level: lvl + 1 } : x))
    addLog(`⬆ Upgraded ${b.type} to L${lvl + 1} for ${fmtCopper(cost)} (output ×${buildingLevelMult(lvl + 1).toFixed(1)}).`)
  }

  function setBuildingOutput(id: string, item: string) {
    econ.setBuildings(bs => bs.map(b => b.id === id ? { ...b, outputItem: item } : b))
  }

  function upgradeBarracks() {
    if (barr.barracksLevel >= 5) return
    const cost = barr.barracksUpgradeCost(barr.barracksLevel)
    if (!Number.isFinite(cost)) return

    // Resource cost for upgrades (scale with level?)
    // Basic scaling: (Level+1) * Base Cost
    const baseRes = ResourceBuildingCosts['BARRACKS'] || {}
    const scale = barr.barracksLevel
    const missing: string[] = []

    for (const [res, amt] of Object.entries(baseRes)) {
      const required = amt * scale
      if ((econ.resources[res as keyof ResourceMap] || 0) < required) {
        missing.push(`${required} ${res} `)
      }
    }

    if (econ.wallet < cost) {
      addLog(`Not enough funds to upgrade.Need ${fmtCopper(cost)}.`)
      return
    }
    if (missing.length > 0) {
      addLog(`Not enough resources: need ${missing.join(', ')}.`)
      return
    }

    econ.setWallet(w => w - cost)
    econ.setResources(prev => {
      const n = { ...prev }
      for (const [res, amt] of Object.entries(baseRes)) {
        n[res as keyof ResourceMap] -= (amt * scale)
      }
      return n
    })

    barr.setBarracksLevel(prev => {
      const next = Math.min(prev + 1, 5)
      addLog(`Upgraded Barracks to L${next}.`)
      return next
    })
  }


  // NOTE: these used to write to a local, never-rendered `units` state — the buttons
  // silently did nothing. They now operate on the real list (unit.setUnits).
  function toggleTraining(unitId: string) {
    // checks BEFORE setState (no addLog inside the updater)
    const used = unit.units.filter(u => u.training).length
    const target = unit.units.find(u => u.id === unitId)
    if (!target) return
    if (!target.training && used >= barr.barracksLevel) {
      addLog(`Training queue full: ${used}/${barr.barracksLevel}.`)
      return
    }
    unit.setUnits(us => us.map(u => u.id === unitId ? { ...u, training: !u.training } : u))
  }

  function doSplit(unitId: string, count: number) {
    unit.setUnits(us => {
      const i = us.findIndex(x => x.id === unitId)
      if (i === -1) return us
      const u = us[i]
      const size = u.buckets.reduce((a, b) => a + b.count, 0)
      if (count <= 0 || count >= size) return us
      const { taken, remaining } = splitUnit(u, count)
      const copy = [...us]
      copy.splice(i, 1, remaining)
      copy.unshift(taken)
      return copy
    })
  }

  function togglePickForMerge(unitId: string) {
    setMergePick(prev => {
      if (prev.includes(unitId)) return prev.filter(id => id !== unitId)
      if (prev.length >= 2) return [prev[1], unitId]
      return [...prev, unitId]
    })
  }

  function doMergeIfReady() {
    if (mergePick.length !== 2) return
    const [aId, bId] = mergePick
    unit.setUnits(us => {
      const a = us.find(x => x.id === aId)
      const b = us.find(x => x.id === bId)
      if (!a || !b || a.type !== b.type) return us
      const merged = mergeUnits(a, b)
      return [merged, ...us.filter(x => x.id !== aId && x.id !== bId)]
    })
    setMergePick([])
  }

  function queueLightTraining(target: SoldierType, qty: number) {
    qLight({ econ, barr, addLog }, target, qty)
  }
  function queueLightCavConversion(fromType: SoldierType, qty: number) {
    qLC({ econ, barr, addLog }, fromType, qty)
  }
  function queueHeavyConversion(fromType: SoldierType, qty: number) {
    qHC({ econ, barr, addLog }, fromType, qty)
  }
  function queueHorseArcherConversion(qty: number) {
    qHA({ econ, barr, addLog }, qty)
  }

  function runDailyTick() {
    const notes: string[] = []
    const income = econ.applyBuildingIncome(s => notes.push(s))
    const delta = income.walletDelta
    // Post-income/production values for this tick's checks: the setState updates from
    // applyBuildingIncome are queued, so the render snapshot is one day behind.
    const postWallet = econ.wallet + delta
    const postRes = income.resources

    // Unit upkeep
    const upkeep = dailyUpkeepCopper(unit.units)
    if (upkeep > 0) {
      econ.setWallet(w => w - upkeep)
      notes.push(`Upkeep ${fmtCopper(upkeep)}`)
      if (postWallet - upkeep < 0) {
        notes.push('⚠ Nu poți plăti upkeep-ul!')
      }
    }

    // Food consumption (checked against TODAY's production, matching the decrement below)
    const foodNeeded = dailyFoodConsumption(unit.units)
    const foodHave = postRes.FOOD ?? 0
    const foodShortage = foodNeeded > 0 && foodHave < foodNeeded
    if (foodNeeded > 0) {
      const foodConsumed = Math.min(foodNeeded, foodHave)
      econ.setResources(prev => ({ ...prev, FOOD: Math.max(0, (prev.FOOD ?? 0) - foodNeeded) }))
      notes.push(`Hrană: -${foodConsumed}/${foodNeeded}`)
      if (foodShortage) {
        notes.push(`⚠ Hrană insuficientă! Lipsesc ${foodNeeded - foodConsumed} unități`)
      }
    }

    // Morale update
    const canPayUpkeep = postWallet >= upkeep
    unit.setUnits(us => us.map(u => applyMoraleChange(u, canPayUpkeep, foodShortage)))

    // Training XP + rank promotions. Logging is computed in a pre-pass over the current
    // snapshot (buckets/XP are untouched by the morale update above, so the outcome is
    // identical) — the state write itself stays a pure functional update.
    const applyDailyXP = (u: Unit) => {
      const base = u.training
        ? u.buckets.map(b => ({ ...b, avgXP: b.avgXP + trainingGainPerDay(b.r) }))
        : u.buckets
      return promoteBuckets(base)
    }
    for (const u of unit.units) {
      const promo = applyDailyXP(u)
      for (const p of promo.promotions) {
        notes.push(`⬆ ${p.count} ${prettyName(u.type)}: ${p.from} → ${p.to}`)
        addLog(`⬆ ${p.count} ${prettyName(u.type)} promoted ${p.from} → ${p.to}.`)
      }
    }
    unit.setUnits(us => us.map(u => {
      const promo = applyDailyXP(u)
      if (!u.training && promo.promotions.length === 0) return u
      return { ...u, buckets: promo.buckets, avgXP: computeUnitAvgXP(promo.buckets) }
    }))

    // Random daily event
    const event = rollDailyEvent()
    if (event) {
      const { effect } = event
      if (effect.walletDelta) econ.setWallet(w => w + effect.walletDelta!)
      if (effect.resourceDelta) {
        econ.setResources(prev => {
          const n = { ...prev }
          for (const [k, v] of Object.entries(effect.resourceDelta!)) {
            n[k as keyof ResourceMap] = Math.max(0, (n[k as keyof ResourceMap] || 0) + (v || 0))
          }
          return n
        })
      }
      if (effect.moraleAllDelta) {
        unit.setUnits(us => us.map(u => ({
          ...u,
          morale: Math.max(0, Math.min(100, (u.morale ?? 100) + effect.moraleAllDelta!))
        })))
      }
      if (effect.recruitLoss) {
        barr.setRecruits(prev => ({ ...prev, count: Math.max(0, prev.count - effect.recruitLoss!) }))
      }
      notes.push(`${event.title} — ${event.description}`)
      addLog(`📅 Eveniment: ${event.title} — ${event.description}`)
    }

    const nextDay = day + 1
    setDay(nextDay)
    addLog(`Day ${nextDay} — ${notes.join(' | ')} | Wallet Δ ${fmtCopper(delta - upkeep)}`)
    // Add: training batch progress here if you want (uses barr.batches etc)

    // Process training batches. Completion is computed in a pre-pass over the current
    // snapshot (nothing else in this tick touches batches), so every setState below is
    // a pure, side-effect-free updater — per the hard rule: no setState inside setState.
    const keptBatches: typeof barr.batches = []
    const finished: { pool: SoldierType; qty: number; note: string }[] = []
    for (const b of barr.batches) {
      const nextDays = b.daysRemaining - 1
      if (nextDays > 0) {
        keptBatches.push({ ...b, daysRemaining: nextDays })
        continue
      }
      const { kind, target, qty } = b
      if (kind === 'LIGHT_TRAIN' && target) {
        finished.push({ pool: target, qty, note: `Training finished: ${qty} ${target} (ROOKIE).` })
      } else if (kind === 'LIGHT_CAV') {
        finished.push({ pool: 'LIGHT_CAV', qty, note: `Conversion finished: ${qty} LIGHT_CAV.` })
      } else if (kind === 'HEAVY_CAV') {
        finished.push({ pool: 'HEAVY_CAV', qty, note: `Conversion finished: ${qty} HEAVY_CAV.` })
      } else if (kind === 'HORSE_ARCHER') {
        finished.push({ pool: 'HORSE_ARCHER', qty, note: `Conversion finished: ${qty} HORSE_ARCHER.` })
      }
    }
    barr.setBatches(keptBatches)
    if (finished.length) {
      barr.setBarracks(prev => {
        const pool = structuredClone(prev)
        for (const f of finished) pool[f.pool]['NOVICE'].count += f.qty
        return pool
      })
      finished.forEach(f => addLog(f.note))
    }
  }

  function createUnitFromBarracks(
    type: SoldierType,
    take: Partial<Record<Rank, number>>,
    opts?: { autoBuy?: boolean }
  ) {
    const autoBuy = !!opts?.autoBuy

    // 1) build buckets & check availability
    const pool = structuredClone(barr.barracks)
    const buckets: Unit['buckets'] = []
    let total = 0
    for (const r of Ranks) {
      const want = take[r] || 0
      if (!want) continue
      if (pool[type][r].count < want) { addLog(`Not enough ${r} in ${type}.`); return }
      const avg = pool[type][r].avgXP
      pool[type][r].count -= want
      buckets.push({ r, count: want, avgXP: avg })
      total += want
    }
    if (total === 0) { addLog('Select at least one soldier.'); return }

    // 2) equipment check / auto-buy
    const need = demandFor(type, total)
    const invClone = structuredClone(econ.inv)
    const res = ensureEquipOrBuy(invClone, econ.wallet, need, autoBuy)
    if (!res.ok) { addLog('Not enough equipment. Enable auto-buy or adjust.'); return }

    // 3) commit inventory + wallet + barracks pool
    econ.setInv(invClone)
    if (res.spent > 0) econ.setWallet(w => w - res.spent)
    barr.setBarracks(pool)

    // 4) create unit
    const totalCount = buckets.reduce((a, b) => a + b.count, 0)
    const wx = buckets.reduce((a, b) => a + b.count * b.avgXP, 0)
    const avgXP = totalCount ? Math.floor(wx / totalCount) : 0

    const unitObj: Unit = {
      id: `U_${Math.random().toString(36).slice(2, 7)}`,
      type,
      buckets,
      avgXP,
      training: false,
      morale: 100,
      equip: { weapons: {}, armors: {}, horses: {} },
      loadout: { kind: type } as any
    }
    unit.setUnits(us => [unitObj, ...us])

    addLog(`Equipped & created ${total} ${type} ${res.spent > 0 ? `(auto-bought ${fmtCopper(res.spent)})` : '(used stock)'}. AvgXP ${avgXP}.`)
  }

  function replenishUnit(
    unitId: string,
    plan: Partial<Record<Rank, number>>,
    opts?: { autoBuy?: boolean }
  ) {
    const autoBuy = !!opts?.autoBuy
    const u = unit.units.find(x => x.id === unitId)
    if (!u) { addLog('Replenish failed: unit not found.'); return }
    const type = u.type as SoldierType

    // 1) check pool availability
    const pool = structuredClone(barr.barracks)
    let total = 0
    for (const r of Ranks) {
      const want = Math.max(0, plan[r] || 0)
      if (!want) continue
      if (pool[type][r].count < want) { addLog(`Not enough ${r} in pool for ${type}.`); return }
      pool[type][r].count -= want
      total += want
    }
    if (total === 0) { addLog('Select at least one soldier to replenish.'); return }

    // 2) equipment check / auto-buy
    const need = demandFor(type, total)
    const invClone = structuredClone(econ.inv)
    const res = ensureEquipOrBuy(invClone, econ.wallet, need, autoBuy)
    if (!res.ok) { addLog('Replenish blocked: missing gear.'); return }

    // 3) commit inventory + wallet + barracks pool
    econ.setInv(invClone)
    if (res.spent > 0) econ.setWallet(w => w - res.spent)
    barr.setBarracks(pool)

    // 4) add to unit with +10% avgXP bonus
    const xpBonus = Math.floor(u.avgXP * 0.10)
    const newBuckets: Unit['buckets'] = u.buckets.map(b => ({ ...b }))
    for (const r of Ranks) {
      const qty = plan[r] || 0
      if (!qty) continue
      const incomingAvgXP = (barr.barracks[type][r].avgXP || 0) + xpBonus // use pre-change avg
      const i = newBuckets.findIndex(b => b.r === r)
      if (i >= 0) {
        const prev = newBuckets[i]
        const newCount = prev.count + qty
        const newWx = prev.count * prev.avgXP + qty * incomingAvgXP
        newBuckets[i] = { r, count: newCount, avgXP: Math.floor(newWx / newCount) }
      } else {
        newBuckets.push({ r, count: qty, avgXP: incomingAvgXP })
      }
    }

    const totalCount = newBuckets.reduce((a, b) => a + b.count, 0)
    const wx = newBuckets.reduce((a, b) => a + b.count * b.avgXP, 0)
    const newAvgXP = totalCount ? Math.floor(wx / totalCount) : 0

    unit.setUnits(us => us.map(x => x.id === unitId ? { ...x, buckets: newBuckets, avgXP: newAvgXP } : x))

    addLog(`Replenished ${total} → ${u.id} (${type}) ${res.spent > 0 ? `(auto-bought ${fmtCopper(res.spent)})` : '(used stock)'}. +XP bonus ${xpBonus}. New size ${totalCount}, avgXP ${newAvgXP}.`)
  }

  // const [recruits, setRecruits] = useState<RecruitPool>({ count: 0, avgXP: 0 })

  function recruit(qty: number) {
    const n = Math.max(1, Math.floor(qty || 0))
    barr.recruit(n)
    addLog(`Recruited ${n} untyped recruits.`)
  }

  // ---- Campaign / Combat ----

  // Grant battle loot. Validation-free (loot is always non-negative); mirrors the
  // daily-event effect applier — independent setState calls, never nested.
  function grantLoot(reward: CampaignReward) {
    if (reward.copper) econ.setWallet(w => w + reward.copper)
    const res = reward.resources || {}
    if (Object.keys(res).length) {
      econ.setResources(prev => {
        const n = { ...prev }
        for (const [k, v] of Object.entries(res)) {
          n[k as keyof ResourceMap] = Math.max(0, (n[k as keyof ResourceMap] || 0) + (v || 0))
        }
        return n
      })
    }
  }

  function startBattle(deployedUnitIds: string[], difficulty: Difficulty) {
    if (camp.campaign.battle) { addLog('A battle is already in progress.'); return }
    if (camp.campaign.lastBattleDay === day) { addLog('⚔ Your host has already taken the field today. March again tomorrow.'); return }
    const chosen = unit.units.filter(u => deployedUnitIds.includes(u.id))
    if (chosen.length === 0) { addLog('Select at least one unit to deploy.'); return }
    // Seed selection is UI-level (not part of the deterministic engine); the battle is
    // fully reproducible from the seed stored inside its state.
    const seed = (Math.floor(Math.random() * 0x7fffffff)) >>> 0
    const ratioMult = escalationMult(camp.campaign.clears?.[difficulty] ?? 0)
    const rewardMult = streakLootMult(camp.campaign.streak ?? 0)
    const created = createBattle(chosen, difficulty, seed, { ratioMult, rewardMult })
    camp.setCampaign(c => ({
      ...c,
      battle: created.state,
      deployedIds: created.deployedIds,
      reward: created.reward,
      lastResult: null,
      lastBattleDay: day,
    }))
    const esc = ratioMult > 1 ? ` (escalated ×${ratioMult.toFixed(2)})` : ''
    addLog(`⚔ Battle started: ${MISSION_PRESETS[difficulty].name}${esc} (${chosen.length} units vs enemy strength ${created.enemyStrength}).`)
  }

  // Apply one player command to the active battle.
  function battleCommand(cmd: Command) {
    camp.setCampaign(c => {
      if (!c.battle) return c
      return { ...c, battle: applyCommand(c.battle, cmd) }
    })
  }

  // Resolve the whole ENEMY turn deterministically (AI plans, engine applies).
  function runEnemyTurn() {
    camp.setCampaign(c => {
      if (!c.battle || c.battle.status !== 'ONGOING' || c.battle.side !== 'ENEMY') return c
      let b = c.battle
      for (const cmd of chooseEnemyCommands(b)) b = applyCommand(b, cmd)
      return { ...c, battle: b }
    })
  }

  // Collect the outcome of a finished battle: write casualties back into the army,
  // pay loot on a win, update the W/L record, then clear the active battle.
  function finishBattle() {
    const c = camp.campaign
    const b = c.battle
    if (!b || b.status === 'ONGOING') return
    const outcome = applyBattleResult(unit.units, b, c.deployedIds)
    unit.setUnits(outcome.units)
    const won = outcome.won
    if (won && c.reward) grantLoot(c.reward)
    const rewardText = won && c.reward
      ? ` Loot: ${fmtCopper(c.reward.copper)}${Object.keys(c.reward.resources).length ? ' + resources' : ''}.`
      : ''
    addLog(`⚔ ${won ? 'Victory' : 'Defeat'} at ${MISSION_PRESETS[b.difficulty].name}! Lost ${outcome.totalLosses} soldiers${outcome.destroyed ? `, ${outcome.destroyed} units wiped out` : ''}, killed ${outcome.totalKills}.${rewardText}`)
    for (const r of outcome.report) {
      for (const p of r.promotions) addLog(`⬆ ${p.count} ${r.name} promoted ${p.from} → ${p.to} in battle.`)
    }
    camp.setCampaign(prev => ({
      ...prev,
      battle: null,
      deployedIds: [],
      reward: null,
      record: { wins: prev.record.wins + (won ? 1 : 0), losses: prev.record.losses + (won ? 0 : 1) },
      streak: won ? (prev.streak ?? 0) + 1 : 0,
      clears: won
        ? { ...prev.clears, [b.difficulty]: (prev.clears?.[b.difficulty] ?? 0) + 1 }
        : prev.clears,
      lastResult: {
        difficulty: b.difficulty,
        won,
        totalLosses: outcome.totalLosses,
        totalKills: outcome.totalKills,
        destroyed: outcome.destroyed,
        reward: won ? c.reward : null,
        report: outcome.report,
      },
    }))
  }

  function abandonBattle() {
    if (!camp.campaign.battle) return
    // Abandon = treat as a loss with the casualties taken so far (write-back still applies).
    const b = camp.campaign.battle
    const outcome = applyBattleResult(unit.units, { ...b, winner: 'ENEMY' }, camp.campaign.deployedIds)
    unit.setUnits(outcome.units)
    addLog(`⚑ Retreated from ${MISSION_PRESETS[b.difficulty].name}. Lost ${outcome.totalLosses} soldiers.`)
    camp.setCampaign(prev => ({
      ...prev,
      battle: null,
      deployedIds: [],
      reward: null,
      record: { ...prev.record, losses: prev.record.losses + 1 },
      streak: 0,
      lastResult: { difficulty: b.difficulty, won: false, totalLosses: outcome.totalLosses, totalKills: outcome.totalKills, destroyed: outcome.destroyed, reward: null, report: outcome.report },
    }))
  }

  function dismissBattleResult() {
    camp.setCampaign(c => ({ ...c, lastResult: null }))
  }


  // Re-export everything your tabs need (keep names the same as today)
  return {
    // core
    day, log, addLog, runDailyTick, loadSave, resetAll, fmtCopper,

    // economy
    wallet: econ.wallet, inv: econ.inv, buildings: econ.buildings, hasStable: econ.hasStable,
    resources: econ.resources, // Export resources
    setWallet: econ.setWallet, setInv: econ.setInv, setBuildings: econ.setBuildings,
    BuildingCostCopper, BuildingOutputChoices, FocusOptions, ResourceBuildingCosts,
    buy, sell, buyBuilding, setBuildingFocus, setBuildingOutput, upgradeBuilding,

    // barracks (state)
    recruits: barr.recruits,
    barracks: barr.barracks,
    barracksLevel: barr.barracksLevel,
    batches: barr.batches,
    batchSlots,
    batchDurationDays: (lvl: number) => batchDurationDays(lvl),

    // barracks actions (wrappers)
    barracksUpgradeCost: (lvl: number) => barr.barracksUpgradeCost(lvl),
    recruit,
    upgradeBarracks: upgradeBarracks,

    queueLightTraining,
    queueLightCavConversion,  // implement like above
    queueHeavyConversion,     // implement like above
    queueHorseArcherConversion, // implement like above

    // units
    units: unit.units,
    mergePick,
    computeReady,
    doSplit,
    togglePickForMerge,
    doMergeIfReady,
    toggleTraining,
    // units slice passthroughs you had before…
    createUnitFromBarracks,   // <-- add this
    replenishUnit,            // <-- and this

    // campaign / combat
    campaign: camp.campaign,
    MISSION_PRESETS,
    DIFFICULTIES,
    startBattle,
    battleCommand,
    runEnemyTurn,
    finishBattle,
    abandonBattle,
    dismissBattleResult,
    grantLoot,
  }


}

export type GameStateShape = ReturnType<typeof useGameState>
