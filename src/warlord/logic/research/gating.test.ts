import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TECHS, resolveCatalog, techById, missingBuildings, buildingReqsMet,
  hasResearchBuilding, RESEARCH_BUILDING,
} from './catalog'
import type { Building } from '../types'

const b = (type: Building['type'], level = 1): Pick<Building, 'type' | 'level'> => ({ type, level })
const tech = (id: string) => techById(DEFAULT_TECHS, id)!

describe('the Scriptorium gates research entirely', () => {
  it('is absent from a starting domain', () => {
    expect(hasResearchBuilding([b('BARRACKS'), b('MARKET'), b('LUMBER_MILL')])).toBe(false)
  })

  it('opens once built, at any level', () => {
    expect(hasResearchBuilding([b(RESEARCH_BUILDING)])).toBe(true)
  })
})

describe('techs demand the infrastructure that makes them plausible', () => {
  it('every default tech declares at least one building requirement', () => {
    for (const t of DEFAULT_TECHS) {
      expect(t.requiresBuildings, `${t.id} has no building requirement`).toBeDefined()
      expect(t.requiresBuildings!.length).toBeGreaterThan(0)
    }
  })

  it('Improved Kilns needs a level-2 smelter', () => {
    const t = tech('ECO_KILNS')
    expect(buildingReqsMet(t, [b('SMELTER', 1)])).toBe(false)
    expect(buildingReqsMet(t, [b('SMELTER', 2)])).toBe(true)
    expect(buildingReqsMet(t, [b('SMELTER', 3)])).toBe(true)
  })

  it('names what is missing, and how far off it is', () => {
    const t = tech('ECO_KILNS')
    expect(missingBuildings(t, [])).toEqual(['Smelter L2'])
    expect(missingBuildings(t, [b('SMELTER', 1)])).toEqual(['Smelter L2 (you have L1)'])
    expect(missingBuildings(t, [b('SMELTER', 2)])).toEqual([])
  })

  it('reports every missing building, not just the first', () => {
    const t = tech('ARM_ACADEMY') // Barracks L3 + Armory L2
    expect(missingBuildings(t, [])).toHaveLength(2)
    expect(missingBuildings(t, [b('BARRACKS', 3)])).toEqual(['Armory L2'])
  })

  it('takes the BEST of several buildings of the same type', () => {
    const t = tech('ECO_KILNS')
    expect(buildingReqsMet(t, [b('SMELTER', 1), b('SMELTER', 2)])).toBe(true)
  })

  it('treats a missing level field as level 1 (old saves)', () => {
    const t = tech('ECO_TOOLS') // Blacksmith L1
    expect(buildingReqsMet(t, [{ type: 'BLACKSMITH' } as Building])).toBe(true)
  })

  it('a tech with no declared requirement is never blocked', () => {
    expect(buildingReqsMet({ ...tech('ECO_TOOLS'), requiresBuildings: undefined }, [])).toBe(true)
  })
})

describe('requirements are admin-tunable like everything else', () => {
  it('an override replaces the requirement, and the default table is untouched', () => {
    const resolved = resolveCatalog({ techs: { ECO_KILNS: { requiresBuildings: [{ type: 'MARKET', level: 1 }] } } })
    const t = techById(resolved, 'ECO_KILNS')!
    expect(buildingReqsMet(t, [b('MARKET', 1)])).toBe(true)
    expect(buildingReqsMet(t, [b('SMELTER', 3)])).toBe(false)
    expect(tech('ECO_KILNS').requiresBuildings).toEqual([{ type: 'SMELTER', level: 2 }])
  })

  it('an override can drop the requirement entirely', () => {
    const resolved = resolveCatalog({ techs: { ARM_ACADEMY: { requiresBuildings: [] } } })
    expect(buildingReqsMet(techById(resolved, 'ARM_ACADEMY')!, [])).toBe(true)
  })
})
