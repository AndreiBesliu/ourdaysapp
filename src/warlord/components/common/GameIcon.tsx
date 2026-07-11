import coinSheet from '../../assets/game_icons/coins.png'
import shieldIcon from '../../assets/game_icons/shield.png'
import iconSword from '../../assets/game_icons/icon_sword.png'
import iconSpear from '../../assets/game_icons/icon_spear.png'
import iconHalberd from '../../assets/game_icons/icon_halberd.png'
import iconBow from '../../assets/game_icons/icon_bow.png'
import iconHeavyArmor from '../../assets/game_icons/icon_heavy_armor.png'
import iconLightArmor from '../../assets/game_icons/icon_light_armor.png'
import iconHorseArmor from '../../assets/game_icons/icon_horse_armor.png'
import iconLightHorse from '../../assets/game_icons/icon_light_horse.png'
import iconHeavyHorse from '../../assets/game_icons/icon_heavy_horse.png'

import iconWood from '../../assets/game_icons/icon_wood.png'
import iconStone from '../../assets/game_icons/icon_stone.png'
import iconCoal from '../../assets/game_icons/icon_coal.png'
import iconIronOre from '../../assets/game_icons/icon_iron_ore.png'
import iconCopperOre from '../../assets/game_icons/icon_copper_ore.png'
import iconSilverOre from '../../assets/game_icons/icon_silver_ore.png'
import iconIronIngot from '../../assets/game_icons/icon_iron_ingot.png'
import iconCopperIngot from '../../assets/game_icons/icon_copper_ingot.png'
import iconSilverIngot from '../../assets/game_icons/icon_silver_ingot.png'

export type IconName =
    | 'sword' | 'spear' | 'halberd'
    | 'bow' | 'heavy_armor' | 'light_armor'
    | 'horse_armor' | 'light_horse' | 'heavy_horse'
    | 'gold' | 'silver' | 'copper'
    | 'shield'
    | 'wood' | 'stone' | 'coal'
    | 'iron_ore' | 'copper_ore' | 'silver_ore'
    | 'iron_ingot' | 'copper_ingot' | 'silver_ingot'

interface GameIconProps {
    name: IconName
    size?: number
    className?: string
}

export default function GameIcon({ name, size = 32, className = '' }: GameIconProps) {
    const iconMap: Record<string, string> = {
        'sword': iconSword,
        'spear': iconSpear,
        'halberd': iconHalberd,
        'bow': iconBow,
        'heavy_armor': iconHeavyArmor,
        'light_armor': iconLightArmor,
        'horse_armor': iconHorseArmor,
        'light_horse': iconLightHorse,
        'heavy_horse': iconHeavyHorse,
        'shield': shieldIcon,

        'wood': iconWood,
        'stone': iconStone,
        'coal': iconCoal,
        'iron_ore': iconIronOre,
        'copper_ore': iconCopperOre,
        'silver_ore': iconSilverOre,
        'iron_ingot': iconIronIngot,
        'copper_ingot': iconCopperIngot,
        'silver_ingot': iconSilverIngot,
    }

    // Mapping for coins.png
    const coinMap: Record<string, { x: number, y: number }> = {
        'gold': { x: 0, y: 1 },
        'silver': { x: 1, y: 1 },
        'copper': { x: 2, y: 1 },
    }

    const titleText = name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

    if (iconMap[name]) {
        return (
            <img
                src={iconMap[name]}
                alt={titleText}
                className={`inline-block shrink-0 object-contain ${className}`}
                style={{ width: size, height: size }}
                title={titleText}
            />
        )
    }

    if (name in coinMap) {
        const { x, y } = coinMap[name]
        const cols = 3
        const rows = 3
        const xPos = cols > 1 ? (x / (cols - 1)) * 100 : 0
        const yPos = rows > 1 ? (y / (rows - 1)) * 100 : 0

        return (
            <div
                className={`inline-block shrink-0 bg-no-repeat ${className}`}
                style={{
                    backgroundImage: `url(${coinSheet})`,
                    backgroundSize: `${cols * 100}% ${rows * 100}%`,
                    backgroundPosition: `${xPos}% ${yPos}%`,
                    width: size,
                    height: size,
                }}
                title={titleText}
                aria-label={titleText}
            />
        )
    }

    return null
}
