import { useState } from 'react'
import type { BattleState, Difficulty } from '../logic/combat/types'
import type { UnitReport } from '../logic/combat/army'

export interface CampaignReward {
  copper: number
  resources: Partial<Record<string, number>>
}

export interface LastBattleResult {
  difficulty: Difficulty
  won: boolean
  totalLosses: number
  totalKills: number
  destroyed: number
  reward: CampaignReward | null
  report?: UnitReport[] // absent in pre-report saves
}

export interface CampaignState {
  battle: BattleState | null
  deployedIds: string[]
  reward: CampaignReward | null
  record: { wins: number; losses: number }
  lastResult: LastBattleResult | null
  // progression
  lastBattleDay: number | null // day the host last took the field (one battle per day)
  streak: number // consecutive victories (loot bonus); resets on loss/retreat
  clears: Partial<Record<Difficulty, number>> // victories per mission (enemy escalation)
}

export function emptyCampaign(): CampaignState {
  return {
    battle: null,
    deployedIds: [],
    reward: null,
    record: { wins: 0, losses: 0 },
    lastResult: null,
    lastBattleDay: null,
    streak: 0,
    clears: {},
  }
}

// Merge a (possibly older) saved campaign over fresh defaults so new fields exist.
export function hydrateCampaign(saved: unknown): CampaignState {
  if (!saved || typeof saved !== 'object') return emptyCampaign()
  return { ...emptyCampaign(), ...(saved as Partial<CampaignState>) }
}

export function useCampaign(saved?: unknown) {
  const [campaign, setCampaign] = useState<CampaignState>(() => hydrateCampaign(saved))
  return { campaign, setCampaign }
}
