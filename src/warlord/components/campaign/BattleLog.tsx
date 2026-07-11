import type { BattleState, BattleLogEntry } from '../../logic/combat/types'

function nameFor(battle: BattleState, id?: string): string {
  if (!id) return ''
  const c = battle.combatants.find((x) => x.id === id)
  if (c) return c.name
  return id
}

function line(battle: BattleState, e: BattleLogEntry): string | null {
  switch (e.kind) {
    case 'start': return '⚔ Battle begins.'
    case 'attack': {
      const k = e.detail?.kills ?? 0
      return `${nameFor(battle, e.actorId)} → ${nameFor(battle, e.targetId)}: ${k} killed`
    }
    case 'retaliate': {
      const k = e.detail?.kills ?? 0
      return `↩ ${nameFor(battle, e.actorId)} retaliates: ${k} killed`
    }
    case 'destroyed': return `💀 ${e.detail?.name ?? nameFor(battle, e.targetId)} wiped out`
    case 'rout': return `🏳 ${nameFor(battle, e.actorId)} routs`
    case 'victory': return `🏁 ${String(e.detail?.status ?? '').replace(/_/g, ' ')}`
    case 'end_turn': return `— ${e.side === 'PLAYER' ? 'Your' : 'Enemy'} turn (T${e.turn}) —`
    default: return null
  }
}

export default function BattleLog({ battle }: { battle: BattleState }) {
  const entries = battle.log
    .map((e, i) => ({ e, i, text: line(battle, e) }))
    .filter((x) => x.text)
    .slice(-14)
    .reverse()

  return (
    <div className="text-xs font-mono space-y-0.5 max-h-[380px] overflow-auto">
      {entries.map(({ i, e, text }) => (
        <div key={i} className={e.side === 'PLAYER' ? 'text-blue-800' : e.kind === 'end_turn' || e.kind === 'start' || e.kind === 'victory' ? 'text-stone-500' : 'text-red-800'}>
          {text}
        </div>
      ))}
    </div>
  )
}
