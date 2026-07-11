// src/mods/sampleMod.ts
import { Registry } from '../logic/registry';
import { GOLD } from '../logic/types';

export function loadSampleMod() {
    console.log("Loading Sample Mod: Royal Guard Extensions");

    // Add a new Weapon: Gold Sword (Expensive, just for show)
    Registry.registerItem({
        id: 'GOLD_SWORD',
        type: 'WEAPON',
        subtype: 'GOLD_SWORD', // Unique ID
        name: 'Gold Sword',
        price: 50 * GOLD
    });

    // Add a new Unit: Royal Guard
    Registry.registerUnit({
        id: 'ROYAL_GUARD',
        type: 'ROYAL_GUARD',
        name: 'Royal Guard',
        req: {
            weapons: { GOLD_SWORD: 1 },
            armors: { HEAVY_ARMOR: 1, SHIELD: 1 }
        },
        loadout: {
            kind: 'ROYAL_GUARD',
            weapon: 'GOLD_SWORD', // Uses our custom item
            shield: true,
            heavyArmor: true
        }
    });
}
