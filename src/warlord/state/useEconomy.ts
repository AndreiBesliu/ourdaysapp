import { useState } from 'react'
import { GOLD, type Building, type ResourceMap } from '../logic/types'
import { simulateEconomyDay } from '../logic/economy'

// Optional pre-parsed save blob for hydrate-on-init (fixes the save being clobbered
// by the first render's save-effect before the player could press Load).
export interface EconomySaved {
  wallet?: number
  inv?: any
  buildings?: Building[]
  resources?: ResourceMap
}

export interface Inv {
  weapons: Record<string, number>
  armors: Record<string, number>
  horses: Record<'LIGHT_HORSE' | 'HEAVY_HORSE', { active: number; inactive: number }>
}

export function useEconomy(initialWallet = 5 * GOLD, defaultBuildings: () => Building[], saved?: EconomySaved) {
  const [wallet, setWallet] = useState<number>(() => saved?.wallet ?? initialWallet)
  const [inv, setInv] = useState<Inv>(() => saved?.inv ?? {
    weapons: { HALBERD: 0, SPEAR: 0, SWORD: 0, BOW: 0 },
    armors: { SHIELD: 0, HEAVY_ARMOR: 0, LIGHT_ARMOR: 0, HORSE_ARMOR: 0 },
    horses: {
      LIGHT_HORSE: { active: 0, inactive: 0 },
      HEAVY_HORSE: { active: 0, inactive: 0 }
    }
  })
  const [buildings, setBuildings] = useState<Building[]>(() => saved?.buildings ?? defaultBuildings())
  const [resources, setResources] = useState<ResourceMap>(() => saved?.resources ?? {
    WOOD: 100, STONE: 0,
    IRON_ORE: 0, COAL: 0, COPPER_ORE: 0, SILVER_ORE: 0,
    IRON_INGOT: 0, COPPER_INGOT: 0, SILVER_INGOT: 0,
    FOOD: 50,
  })

  const hasStable = buildings.some(b => b.type === 'STABLE')

  // Thin commit wrapper. ALL the arithmetic lives in `simulateEconomyDay` so the daily
  // tick and the topbar forecast literally run the same code — the one way a forecast
  // cannot drift from what the game pays. `units: []` keeps the split the tick expects:
  // the income step commits here, soldier upkeep and food stay in runDailyTick.
  function applyBuildingIncome(
    addNote: (s: string) => void,
    mods?: { prodMult?: number; craftEfficiency?: number },
  ) {
    const day = simulateEconomyDay({ buildings, resources, inv, units: [], mods })
    for (const n of day.notes) addNote(n)

    setBuildings(day.buildings)
    setInv(day.inv)
    setResources(day.resources)
    setWallet(w => w + day.incomeWalletDelta)
    // Return the post-production values too: same-tick checks (upkeep affordability,
    // food shortage) must be computed against TODAY's income/production, not the stale
    // render snapshot — the queued setState updates aren't visible to the caller yet.
    return { walletDelta: day.incomeWalletDelta, resources: day.resources }
  }

  return {
    wallet, setWallet,
    inv, setInv,
    resources, setResources, // New export
    buildings, setBuildings,
    hasStable,
    applyBuildingIncome,
  }
}
