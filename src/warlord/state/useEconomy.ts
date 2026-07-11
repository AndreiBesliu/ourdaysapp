import { useState } from 'react'
import { GOLD, fmtCopper, type Building, type ResourceMap, ResourceTypes, WeaponTypes, ArmorTypes } from '../logic/types'
import { BuildingCostCopper, BuildingOutputChoices, passiveIncomeAndProduction, SmelterRecipes, ManufacturingRecipes } from '../logic/economy'

export function useEconomy(initialWallet = 5 * GOLD, defaultBuildings: () => Building[]) {
  const [wallet, setWallet] = useState(initialWallet)
  const [inv, setInv] = useState({
    weapons: { HALBERD: 0, SPEAR: 0, SWORD: 0, BOW: 0 } as Record<string, number>,
    armors: { SHIELD: 0, HEAVY_ARMOR: 0, LIGHT_ARMOR: 0, HORSE_ARMOR: 0 } as Record<string, number>,
    horses: {
      LIGHT_HORSE: { active: 0, inactive: 0 },
      HEAVY_HORSE: { active: 0, inactive: 0 }
    } as Record<'LIGHT_HORSE' | 'HEAVY_HORSE', { active: number; inactive: number }>
  })
  const [buildings, setBuildings] = useState<Building[]>(defaultBuildings())
  const [resources, setResources] = useState<ResourceMap>({
    WOOD: 100, STONE: 0,
    IRON_ORE: 0, COAL: 0, COPPER_ORE: 0, SILVER_ORE: 0,
    IRON_INGOT: 0, COPPER_INGOT: 0, SILVER_INGOT: 0,
    FOOD: 50,
  })

  const hasStable = buildings.some(b => b.type === 'STABLE')

  function applyBuildingIncome(addNote: (s: string) => void) {
    let walletDelta = 0
    const ninv = structuredClone(inv)
    const nres = { ...resources }

    // Passive Income
    nres.WOOD = (nres.WOOD || 0) + 1
    addNote('Nature → +1 Wood')


    const updated = buildings.map(b => {
      const row = { ...b }

      // Stable/Market/Barracks handled separately or are passive
      if (['STABLE', 'MARKET', 'BARRACKS'].includes(row.type)) return row

      // 1. Calculate Potential Output based on Investment (Cost)
      const cost = BuildingCostCopper[row.type] || 0
      const { coinGain, items, newBuffer } = passiveIncomeAndProduction({
        costCopper: cost,
        focusCoinPct: row.focusCoinPct,
        outputItem: row.outputItem ?? BuildingOutputChoices[row.type].options[0] ?? '',
        fractionalBuffer: row.fractionalBuffer ?? 0,
      })

      walletDelta += coinGain
      row.fractionalBuffer = newBuffer

      const outItem = row.outputItem ?? BuildingOutputChoices[row.type].options[0] ?? ''

      // 2. Handle Logic based on Type
      if (row.type === 'SMELTER') {
        // Recipe check
        const recipe = SmelterRecipes[outItem]
        if (recipe && items > 0) {
          // Check inputs
          let maxAfford = items
          for (const [res, qty] of Object.entries(recipe.input)) {
            const avail = nres[res as keyof ResourceMap] || 0
            const affordable = Math.floor(avail / qty)
            maxAfford = Math.min(maxAfford, affordable)
          }

          if (maxAfford > 0) {
            // Consume
            for (const [res, qty] of Object.entries(recipe.input)) {
              nres[res as keyof ResourceMap] -= (qty * maxAfford)
            }
            // Produce
            nres[outItem as keyof ResourceMap] += maxAfford
            addNote(`${row.type} → Smelted ${maxAfford} ${outItem} (gain ${fmtCopper(coinGain)})`)
          } else {
            addNote(`${row.type} → Idle (missing ore/coal)`)
          }
        }
      } else if (row.type === 'MINTER') {
        // Minter: Silver Ingot -> Coin
        // Assume 1 Silver Ingot -> 500c (5s) value? Or just use market value logic?
        // Let's say Minter converts Silver Ingots to Coin at a bonus?
        // Or simply: Input: SILVER_INGOT 1 -> Output: 500c + Bonus?
        // Allow it to run `items` times.
        if (items > 0) {
          const avail = nres['SILVER_INGOT']
          const run = Math.min(items, avail)
          if (run > 0) {
            nres['SILVER_INGOT'] -= run
            const mintedValue = run * 600 // 6s per ingot (profit over 5s base?)
            walletDelta += mintedValue
            addNote(`${row.type} → Minted ${run} Silver Ingots into ${fmtCopper(mintedValue)}`)
          } else {
            addNote(`${row.type} → Idle (missing silver)`)
          }
        }
      } else {
        // Standard Production (Weapon/Armor OR Resource)
        if (items > 0 && outItem) {
          // Check Manufacturing Recipes (e.g. Woodworker needs Wood)
          const recipe = ManufacturingRecipes[outItem]
          let actualItems = items

          if (recipe) {
            let maxAfford = items
            for (const [res, qty] of Object.entries(recipe)) {
              const avail = nres[res as keyof ResourceMap] || 0
              maxAfford = Math.min(maxAfford, Math.floor(avail / qty))
            }
            actualItems = maxAfford

            if (actualItems > 0) {
              // Consume resources
              for (const [res, qty] of Object.entries(recipe)) {
                nres[res as keyof ResourceMap] -= (qty * actualItems)
              }
            }
          }

          if (actualItems > 0) {
            if ((ResourceTypes as readonly string[]).includes(outItem)) {
              nres[outItem as keyof ResourceMap] = (nres[outItem as keyof ResourceMap] || 0) + actualItems
              addNote(`${row.type} → +${actualItems} ${outItem}, +${fmtCopper(coinGain)}`)
            } else if ((WeaponTypes as readonly string[]).includes(outItem)) {
              ninv.weapons[outItem] = (ninv.weapons[outItem] ?? 0) + actualItems
              addNote(`${row.type} → +${actualItems} ${outItem}, +${fmtCopper(coinGain)}`)
            } else if ((ArmorTypes as readonly string[]).includes(outItem)) {
              ninv.armors[outItem] = (ninv.armors[outItem] ?? 0) + actualItems
              addNote(`${row.type} → +${actualItems} ${outItem}, +${fmtCopper(coinGain)}`)
            }
          } else {
            // Failed to produce items due to lack of resources
            if (items > 0) addNote(`${row.type} → Idle (missing resources for ${outItem}), +${fmtCopper(coinGain)}`)
            else if (coinGain > 0) addNote(`${row.type} → +${fmtCopper(coinGain)}`)
          }
        } else if (coinGain > 0) {
          addNote(`${row.type} → +${fmtCopper(coinGain)}`)
        }
      }

      return row
    })

    // Stable: breeding + upkeep (once per day)
    if (hasStable) {
      const breedL = Math.floor(0.01 * (ninv.horses.LIGHT_HORSE.active || 0))
      const breedH = Math.floor(0.01 * (ninv.horses.HEAVY_HORSE.active || 0))
      ninv.horses.LIGHT_HORSE.active += breedL
      ninv.horses.HEAVY_HORSE.active += breedH
      const activeTotal = (ninv.horses.LIGHT_HORSE.active || 0) + (ninv.horses.HEAVY_HORSE.active || 0)
      const upkeep = Math.round(activeTotal * (0.005 * GOLD))
      walletDelta -= upkeep
      addNote(`Stable: +${breedL + breedH} foals; upkeep ${fmtCopper(upkeep)} for ${activeTotal} horses`)
    }

    setBuildings(updated)
    setInv(ninv)
    setResources(nres)
    setWallet(w => w + walletDelta)
    return walletDelta
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
