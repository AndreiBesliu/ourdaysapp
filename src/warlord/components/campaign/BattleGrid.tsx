import React from 'react'
import type { BattleState, Combatant, TerrainType } from '../../logic/combat/types'
import { legalMoves, legalTargets, terrainAt, combatantAt } from '../../logic/combat/engine'
import GameIcon from '../common/GameIcon'
import { getIconForGameItem } from '../../logic/iconHelpers'

const TILE = 46

const TERRAIN_CLASS: Record<TerrainType, string> = {
  PLAINS: 'bg-lime-100',
  FOREST: 'bg-green-700/60',
  HILL: 'bg-amber-300/70',
  RIVER: 'bg-sky-300',
}

const TERRAIN_LABEL: Record<TerrainType, string> = {
  PLAINS: 'Plains', FOREST: 'Forest', HILL: 'Hill', RIVER: 'River',
}

function Token({ c, selected, dim }: { c: Combatant; selected: boolean; dim: boolean }) {
  const isPlayer = c.side === 'PLAYER'
  const pct = Math.max(0, Math.min(100, (c.hp / Math.max(1, c.hpStart)) * 100))
  return (
    <div
      className={`absolute inset-0.5 rounded-md border-2 flex flex-col items-center justify-center overflow-hidden
        ${isPlayer ? 'border-blue-600 bg-blue-50' : 'border-red-600 bg-red-50'}
        ${selected ? 'ring-2 ring-yellow-400 ring-offset-1' : ''}
        ${dim ? 'opacity-50' : ''}
        ${c.routed ? 'grayscale opacity-60' : ''}`}
      title={`${c.name} — ${c.hp}/${c.hpStart} soldiers, morale ${Math.round(c.morale)}${c.routed ? ' (routed)' : ''}`}
    >
      <GameIcon name={getIconForGameItem(c.type) || 'sword'} size={20} />
      <span className={`text-[10px] font-mono leading-none font-bold ${isPlayer ? 'text-blue-800' : 'text-red-800'}`}>{c.hp}</span>
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-black/10">
        <div className={`h-full ${pct > 50 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {c.routed && <span className="absolute bottom-0 right-0 text-[9px]">🏳</span>}
    </div>
  )
}

interface Props {
  battle: BattleState
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (x: number, y: number) => void
  onAttack: (targetId: string) => void
}

export default function BattleGrid({ battle, selectedId, onSelect, onMove, onAttack }: Props) {
  const canControl = battle.side === 'PLAYER' && battle.status === 'ONGOING'
  const moves = selectedId && canControl ? legalMoves(battle, selectedId) : []
  const targets = selectedId && canControl ? legalTargets(battle, selectedId) : []
  const moveSet = new Set(moves.map((m) => `${m.x},${m.y}`))
  const targetSet = new Set(targets)

  const cells: React.ReactNode[] = []
  for (let y = 0; y < battle.height; y++) {
    for (let x = 0; x < battle.width; x++) {
      const t: TerrainType = terrainAt(battle, x, y)
      const occ = combatantAt(battle, x, y)
      const isMove = moveSet.has(`${x},${y}`)
      const isTarget = !!occ && targetSet.has(occ.id)
      const selected = !!occ && occ.id === selectedId
      const dim = !!occ && occ.side === 'PLAYER' && canControl && occ.hasActed && occ.hasMoved

      const onClick = () => {
        if (occ) {
          if (occ.side === 'PLAYER' && canControl) onSelect(occ.id)
          else if (isTarget) onAttack(occ.id)
        } else if (isMove) {
          onMove(x, y)
        }
      }

      cells.push(
        <div
          key={`${x},${y}`}
          onClick={onClick}
          className={`relative ${TERRAIN_CLASS[t]} border border-black/10
            ${isMove ? 'cursor-pointer' : occ ? 'cursor-pointer' : ''}
            ${isMove ? 'outline outline-2 outline-green-500/70 -outline-offset-2' : ''}
            ${isTarget ? 'outline outline-2 outline-red-500 -outline-offset-2' : ''}`}
          style={{ width: TILE, height: TILE }}
          title={TERRAIN_LABEL[t]}
        >
          {isMove && !occ && <div className="absolute inset-0 flex items-center justify-center"><div className="w-2.5 h-2.5 rounded-full bg-green-600/70" /></div>}
          {occ && <Token c={occ} selected={selected} dim={dim} />}
        </div>,
      )
    }
  }

  return (
    <div className="inline-block">
      <div
        className="grid select-none shadow-inner rounded-lg overflow-hidden border border-stone-700"
        style={{ gridTemplateColumns: `repeat(${battle.width}, ${TILE}px)` }}
      >
        {cells}
      </div>
      <div className="flex flex-wrap gap-3 mt-2 text-xs text-stone-600">
        {(['PLAINS', 'FOREST', 'HILL', 'RIVER'] as TerrainType[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className={`inline-block w-3 h-3 rounded ${TERRAIN_CLASS[t]} border border-black/20`} />
            {TERRAIN_LABEL[t]}
          </span>
        ))}
      </div>
    </div>
  )
}
