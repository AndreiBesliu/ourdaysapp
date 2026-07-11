// logic/helpers.ts
export function makeEmptyInventories() {
    return {
      weapons: { HALBERD:0, SPEAR:0, SWORD:0, BOW:0 },
      armors:  { SHIELD:0, HEAVY_ARMOR:0, LIGHT_ARMOR:0, HORSE_ARMOR:0 },
      horses:  {
        LIGHT_HORSE: { active:0, inactive:0 },
        HEAVY_HORSE: { active:0, inactive:0 }
      }
    }
  }
  
  export type HorseKey = 'LIGHT_HORSE' | 'HEAVY_HORSE'

  export function isHorseKey(x: string): x is HorseKey {
    return x === 'LIGHT_HORSE' || x === 'HEAVY_HORSE'
  }