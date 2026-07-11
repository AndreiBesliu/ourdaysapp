import { useState } from 'react'
import type { BattleState, Difficulty } from '../logic/combat/types'

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
}

export interface CampaignState {
  battle: BattleState | null
  deployedIds: string[]
  reward: CampaignReward | null
  record: { wins: number; losses: number }
  lastResult: LastBattleResult | null
}

export function emptyCampaign(): CampaignState {
  return { battle: null, deployedIds: [], reward: null, record: { wins: 0, losses: 0 }, lastResult: null }
}

export function useCampaign() {
  const [campaign, setCampaign] = useState<CampaignState>(emptyCampaign())
  return { campaign, setCampaign }
}
