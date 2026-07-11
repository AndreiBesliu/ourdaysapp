import GameIcon from './GameIcon'
import { GOLD, SILVER } from '../../logic/types'

interface MoneyDisplayProps {
    amount: number
    size?: number
    className?: string
}

export default function MoneyDisplay({ amount, size = 16, className = '' }: MoneyDisplayProps) {
    const g = Math.floor(amount / GOLD)
    const s = Math.floor((amount % GOLD) / SILVER)
    const c = amount % SILVER

    return (
        <div className={`inline-flex items-center gap-2 ${className}`}>
            {g > 0 && (
                <span className="flex items-center gap-1">
                    <GameIcon name="gold" size={size} />
                    <span className="font-mono">{g}</span>
                </span>
            )}
            {(s > 0 || (g > 0 && c > 0)) && (
                <span className="flex items-center gap-1">
                    <GameIcon name="silver" size={size} />
                    <span className="font-mono">{s}</span>
                </span>
            )}
            {(c > 0 || (amount === 0)) && (
                <span className="flex items-center gap-1">
                    <GameIcon name="copper" size={size} />
                    <span className="font-mono">{c}</span>
                </span>
            )}
        </div>
    )
}
