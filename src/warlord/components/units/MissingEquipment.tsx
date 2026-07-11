import { missingEquipmentList } from '../../logic/units'
import type { Unit } from '../../logic/types'

export default function MissingEquipment({ unit }: { unit: Unit }) {
  const missing = missingEquipmentList(unit)
  return (
    <div className="mt-1 text-xs">
      {missing.length
        ? <span className="text-red-700">Missing: {missing.join(', ')}</span>
        : <span className="text-green-700">Fully equipped</span>}
    </div>
  )
}
