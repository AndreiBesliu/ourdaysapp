// src/logic/events.ts
import type { ResourceMap } from './types'

export type EventKind = 'RAID' | 'EPIDEMIE' | 'PIATA_FLUCTUANTA' | 'RECOLTA_BUNA' | 'DONATII' | 'DEZERTORI'

export interface GameEvent {
  kind: EventKind
  title: string
  description: string
  // Effect applied to state — undefined means no effect for that slice
  effect: {
    resourceDelta?: Partial<ResourceMap>
    walletDelta?: number
    moraleAllDelta?: number     // applied to all units
    recruitLoss?: number        // recruits lost
  }
}

const EVENTS: GameEvent[] = [
  {
    kind: 'RAID',
    title: '⚔ Raid inamic!',
    description: 'Bandiți au atacat depozitele. Pierzi resurse.',
    effect: { resourceDelta: { WOOD: -20, FOOD: -15 }, walletDelta: -500 },
  },
  {
    kind: 'EPIDEMIE',
    title: '🦠 Epidemie în tabără!',
    description: 'O boală se răspândește. Moralul trupelor scade.',
    effect: { moraleAllDelta: -20, recruitLoss: 5 },
  },
  {
    kind: 'PIATA_FLUCTUANTA',
    title: '📈 Prețuri în creștere!',
    description: 'Negustorii au adus marfă scumpă. Câștig neașteptat din stocuri.',
    effect: { walletDelta: 2000 },
  },
  {
    kind: 'RECOLTA_BUNA',
    title: '🌾 Recoltă abundentă!',
    description: 'Fermierii au adus provizii suplimentare.',
    effect: { resourceDelta: { FOOD: 30, WOOD: 10 } },
  },
  {
    kind: 'DONATII',
    title: '💰 Donații de la nobili!',
    description: 'Un nobil local ți-a trimis ajutor financiar.',
    effect: { walletDelta: 5000, moraleAllDelta: 5 },
  },
  {
    kind: 'DEZERTORI',
    title: '🚪 Dezertori!',
    description: 'Câțiva recruți au fugit noaptea. Moralul scade.',
    effect: { recruitLoss: 10, moraleAllDelta: -10 },
  },
]

// ~15% șansă per zi de eveniment
export function rollDailyEvent(): GameEvent | null {
  if (Math.random() > 0.15) return null
  return EVENTS[Math.floor(Math.random() * EVENTS.length)]
}
