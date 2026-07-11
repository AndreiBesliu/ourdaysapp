import type { CombatStats } from './combat/types';

// Generic definition for an Item (Weapon, Armor, Horse)
export interface ItemDef {
    id: string;
    type: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE';
    subtype: string; // e.g. 'SWORD', 'HEAVY_ARMOR', 'LIGHT_HORSE'
    name: string;
    price: number; // in copper
}

// Definition for a Unit Template
export interface UnitDef {
    id: string;
    type: string; // matches SoldierType
    name: string;
    // Base requirements to sustain/recruit (size 1)
    req: {
        weapons?: Record<string, number>;
        armors?: Record<string, number>;
        horses?: Record<string, number>;
    };
    // Default loadout for equipping
    loadout: any;
    // Optional combat stat overrides (moddable). Baked onto the Combatant at battle
    // setup so the engine stays pure and the override travels in serialized state.
    combat?: Partial<CombatStats>;
}

class GameRegistry {
    private items = new Map<string, ItemDef>();
    private units = new Map<string, UnitDef>();
    private initialized = false;

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // --- Core Items ---
        const GOLD = 10000;
        const SILVER = 100;

        // Resources
        this.registerItem({ id: 'FOOD', type: 'RESOURCE', subtype: 'FOOD', name: 'Food', price: 50 });
        this.registerItem({ id: 'WOOD', type: 'RESOURCE', subtype: 'WOOD', name: 'Wood', price: 50 });
        this.registerItem({ id: 'STONE', type: 'RESOURCE', subtype: 'STONE', name: 'Stone', price: 50 });
        this.registerItem({ id: 'COAL', type: 'RESOURCE', subtype: 'COAL', name: 'Coal', price: 100 });
        this.registerItem({ id: 'IRON_ORE', type: 'RESOURCE', subtype: 'IRON_ORE', name: 'Iron Ore', price: 100 });
        this.registerItem({ id: 'COPPER_ORE', type: 'RESOURCE', subtype: 'COPPER_ORE', name: 'Copper Ore', price: 80 });
        this.registerItem({ id: 'SILVER_ORE', type: 'RESOURCE', subtype: 'SILVER_ORE', name: 'Silver Ore', price: 200 });
        this.registerItem({ id: 'IRON_INGOT', type: 'RESOURCE', subtype: 'IRON_INGOT', name: 'Iron Ingot', price: 300 });
        this.registerItem({ id: 'COPPER_INGOT', type: 'RESOURCE', subtype: 'COPPER_INGOT', name: 'Copper Ingot', price: 250 });
        this.registerItem({ id: 'SILVER_INGOT', type: 'RESOURCE', subtype: 'SILVER_INGOT', name: 'Silver Ingot', price: 600 });

        // Weapons
        this.registerItem({ id: 'HALBERD', type: 'WEAPON', subtype: 'HALBERD', name: 'Halberd', price: 12 * SILVER });
        this.registerItem({ id: 'SPEAR', type: 'WEAPON', subtype: 'SPEAR', name: 'Spear', price: 3 * SILVER });
        this.registerItem({ id: 'SWORD', type: 'WEAPON', subtype: 'SWORD', name: 'Sword', price: 15 * SILVER });
        this.registerItem({ id: 'BOW', type: 'WEAPON', subtype: 'BOW', name: 'Bow', price: 70 }); // 0.7s = 70c

        // Armors
        this.registerItem({ id: 'SHIELD', type: 'ARMOR', subtype: 'SHIELD', name: 'Shield', price: 1 * SILVER });
        this.registerItem({ id: 'HEAVY_ARMOR', type: 'ARMOR', subtype: 'HEAVY_ARMOR', name: 'Heavy Armor', price: 10 * GOLD });
        this.registerItem({ id: 'LIGHT_ARMOR', type: 'ARMOR', subtype: 'LIGHT_ARMOR', name: 'Light Armor', price: 3 * SILVER });
        this.registerItem({ id: 'HORSE_ARMOR', type: 'ARMOR', subtype: 'HORSE_ARMOR', name: 'Horse Armor', price: 8 * GOLD });

        // Horses
        this.registerItem({ id: 'LIGHT_HORSE', type: 'HORSE', subtype: 'LIGHT_HORSE', name: 'Light Horse', price: 5 * GOLD });
        this.registerItem({ id: 'HEAVY_HORSE', type: 'HORSE', subtype: 'HEAVY_HORSE', name: 'Heavy Horse', price: 15 * GOLD });

        // --- Core Units ---
        // Light Infantry
        this.registerUnit({
            id: 'LIGHT_INF_SWORD', type: 'LIGHT_INF_SWORD', name: 'Light Infantry (Sword)',
            req: { weapons: { SWORD: 1 }, armors: { LIGHT_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'LIGHT_INF_SWORD', weapon: 'SWORD', shield: true, lightArmor: true }
        });
        this.registerUnit({
            id: 'LIGHT_INF_SPEAR', type: 'LIGHT_INF_SPEAR', name: 'Light Infantry (Spear)',
            req: { weapons: { SPEAR: 1 }, armors: { LIGHT_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'LIGHT_INF_SPEAR', weapon: 'SPEAR', shield: true, lightArmor: true }
        });
        this.registerUnit({
            id: 'LIGHT_INF_HALBERD', type: 'LIGHT_INF_HALBERD', name: 'Light Infantry (Halberd)',
            req: { weapons: { HALBERD: 1 }, armors: { LIGHT_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'LIGHT_INF_HALBERD', weapon: 'HALBERD', shield: true, lightArmor: true }
        });

        // Heavy Infantry
        this.registerUnit({
            id: 'HEAVY_INF_SWORD', type: 'HEAVY_INF_SWORD', name: 'Heavy Infantry (Sword)',
            req: { weapons: { SWORD: 1 }, armors: { HEAVY_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'HEAVY_INF_SWORD', weapon: 'SWORD', shield: true, heavyArmor: true }
        });
        this.registerUnit({
            id: 'HEAVY_INF_SPEAR', type: 'HEAVY_INF_SPEAR', name: 'Heavy Infantry (Spear)',
            req: { weapons: { SPEAR: 1 }, armors: { HEAVY_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'HEAVY_INF_SPEAR', weapon: 'SPEAR', shield: true, heavyArmor: true }
        });
        this.registerUnit({
            id: 'HEAVY_INF_HALBERD', type: 'HEAVY_INF_HALBERD', name: 'Heavy Infantry (Halberd)',
            req: { weapons: { HALBERD: 1 }, armors: { HEAVY_ARMOR: 1, SHIELD: 1 } },
            loadout: { kind: 'HEAVY_INF_HALBERD', weapon: 'HALBERD', shield: true, heavyArmor: true }
        });

        // Archers
        this.registerUnit({
            id: 'LIGHT_ARCHER', type: 'LIGHT_ARCHER', name: 'Light Archer',
            req: { weapons: { BOW: 1 }, armors: { LIGHT_ARMOR: 1 } },
            loadout: { kind: 'LIGHT_ARCHER', weapon: 'BOW', shield: false, lightArmor: true }
        });
        this.registerUnit({
            id: 'HEAVY_ARCHER', type: 'HEAVY_ARCHER', name: 'Heavy Archer',
            req: { weapons: { BOW: 1 }, armors: { HEAVY_ARMOR: 1 } },
            loadout: { kind: 'HEAVY_ARCHER', weapon: 'BOW', shield: false, heavyArmor: true }
        });

        // Cavalry
        this.registerUnit({
            id: 'LIGHT_CAV', type: 'LIGHT_CAV', name: 'Light Cavalry',
            req: { weapons: { SPEAR: 1 }, armors: { LIGHT_ARMOR: 1 }, horses: { LIGHT_HORSE: 1 } },
            loadout: { kind: 'LIGHT_CAV', weapon: 'SPEAR', lightArmor: true }
        });
        this.registerUnit({
            id: 'HEAVY_CAV', type: 'HEAVY_CAV', name: 'Heavy Cavalry',
            req: { weapons: { HALBERD: 1 }, armors: { HEAVY_ARMOR: 1, HORSE_ARMOR: 1 }, horses: { HEAVY_HORSE: 1 } },
            loadout: { kind: 'HEAVY_CAV', weapon: 'HALBERD', heavyArmor: true, horseArmor: true }
        });
        this.registerUnit({
            id: 'HORSE_ARCHER', type: 'HORSE_ARCHER', name: 'Horse Archer',
            req: { weapons: { BOW: 1 }, armors: { LIGHT_ARMOR: 1 }, horses: { LIGHT_HORSE: 1 } },
            loadout: { kind: 'HORSE_ARCHER', weapon: 'BOW', lightArmor: true }
        });

        console.log("Registry initialized with Core Data");
    }

    // --- Items ---
    registerItem(def: ItemDef) {
        if (!def.id || !def.name || def.price == null) {
            throw new Error(`Invalid item definition: ${JSON.stringify(def)}`);
        }
        if (this.items.has(def.id)) {
            console.warn(`Registry: overwriting item "${def.id}"`);
        }
        this.items.set(def.id, def);
    }

    getItem(id: string): ItemDef | undefined {
        return this.items.get(id);
    }

    getAllItems() {
        return Array.from(this.items.values());
    }

    // --- Units ---
    registerUnit(def: UnitDef) {
        if (!def.id || !def.name || !def.type) {
            throw new Error(`Invalid unit definition: ${JSON.stringify(def)}`);
        }
        if (this.units.has(def.id)) {
            console.warn(`Registry: overwriting unit "${def.id}"`);
        }
        this.units.set(def.id, def);
    }

    getUnit(id: string): UnitDef | undefined {
        return this.units.get(id);
    }

    getAllUnits() {
        return Array.from(this.units.values());
    }
}

export const Registry = new GameRegistry();
