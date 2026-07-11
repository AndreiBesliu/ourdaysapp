import type { IconName } from '../components/common/GameIcon'

export function getIconForGameItem(item: string): IconName | undefined {
    if (item.includes('SWORD')) return 'sword'
    if (item.includes('SPEAR')) return 'spear'
    if (item.includes('HALBERD')) return 'halberd'
    if (item.includes('BOW') || item.includes('ARCHER')) return 'bow'

    if (item === 'HEAVY_ARMOR') return 'heavy_armor'
    if (item === 'LIGHT_ARMOR') return 'light_armor'
    if (item === 'HORSE_ARMOR') return 'horse_armor'
    if (item === 'SHIELD') return 'shield'

    if (item === 'LIGHT_HORSE') return 'light_horse'
    if (item === 'HEAVY_HORSE') return 'heavy_horse'
    if (item === 'HORSE_ARCHER') return 'light_horse' // fallback

    if (item === 'gold') return 'gold'
    if (item === 'silver') return 'silver'
    if (item === 'copper') return 'copper'

    // Resources
    if (item === 'WOOD') return 'wood'
    if (item === 'STONE') return 'stone'
    if (item === 'COAL') return 'coal'
    if (item === 'IRON_ORE') return 'iron_ore'
    if (item === 'COPPER_ORE') return 'copper_ore'
    if (item === 'SILVER_ORE') return 'silver_ore'
    if (item === 'IRON_INGOT') return 'iron_ingot'
    if (item === 'COPPER_INGOT') return 'copper_ingot'
    if (item === 'SILVER_INGOT') return 'silver_ingot'

    // Semantic mappings
    if (item.match(/^foal/i)) return 'light_horse'
    if (item.match(/^horse/i)) return 'heavy_horse'
    if (item === 'Wallet') return 'gold'

    return undefined
}

export function formatGameTooltip(text: string): string {
    return text.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
