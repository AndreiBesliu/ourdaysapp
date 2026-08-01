import { useState } from 'react'
import type { TechId } from '../logic/research/catalog'
import type { ActiveBuff } from '../logic/research/momentum'

// One research project in progress. Mirrors the training-batch shape (daysRemaining
// counted down by the daily tick) so both queues behave identically.
export interface ResearchProject {
  id: TechId
  name: string
  daysRemaining: number
}

export interface ResearchState {
  unlocked: TechId[]
  queue: ResearchProject[]
  buffs: ActiveBuff[] // temporary momentum effects (victories, discoveries, defeats)
}

export function emptyResearch(): ResearchState {
  return { unlocked: [], queue: [], buffs: [] }
}

// Merge a (possibly older) saved blob over fresh defaults so new fields always exist —
// same forward-compatible pattern as hydrateCampaign.
export function hydrateResearch(saved: unknown): ResearchState {
  if (!saved || typeof saved !== 'object') return emptyResearch()
  const s = saved as Partial<ResearchState>
  return {
    unlocked: Array.isArray(s.unlocked) ? s.unlocked : [],
    queue: Array.isArray(s.queue) ? s.queue : [],
    buffs: Array.isArray(s.buffs) ? s.buffs : [],
  }
}

export function useResearch(saved?: unknown) {
  const [research, setResearch] = useState<ResearchState>(() => hydrateResearch(saved))
  return { research, setResearch }
}
