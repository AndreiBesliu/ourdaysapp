import { Registry } from '../../logic/registry'
import GameIcon from './GameIcon'
import { getIconForGameItem } from '../../logic/iconHelpers'

export default function InvSummary({
  inv
}: {
  inv: {
    weapons: Record<string, number>
    armors: Record<string, number>
    horses: Record<string, { active: number; inactive: number }>
  }
}) {
  const items = Registry.getAllItems();
  const weapons = items.filter(i => i.type === 'WEAPON');
  const armors = items.filter(i => i.type === 'ARMOR');
  const horses = items.filter(i => i.type === 'HORSE');

  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>
        <h4 className="font-semibold">Weapons</h4>
        {weapons.map(w => (
          <div key={w.id} className="border rounded m-1 p-2 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GameIcon name={getIconForGameItem(w.subtype) || 'sword'} size={24} />
              <span>{w.name}</span>
            </div>
            <span className="font-mono">{inv.weapons[w.subtype] ?? 0}</span>
          </div>
        ))}
      </div>
      <div>
        <h4 className="font-semibold">Armor</h4>
        {armors.map(a => (
          <div key={a.id} className="border rounded m-1 p-2 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GameIcon name={getIconForGameItem(a.subtype) || 'sword'} size={24} />
              <span>{a.name}</span>
            </div>
            <span className="font-mono">{inv.armors[a.subtype] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm">
        <h4 className="font-semibold mt-2">Horses</h4>
        {horses.map(h => (
          <div key={h.id} className="border rounded p-2 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GameIcon name={getIconForGameItem(h.subtype) || 'sword'} size={24} />
              <span>{h.name}</span>
            </div>
            <span className="font-mono">
              {(inv.horses[h.subtype]?.active ?? 0)} active / {(inv.horses[h.subtype]?.inactive ?? 0)} inactive
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
