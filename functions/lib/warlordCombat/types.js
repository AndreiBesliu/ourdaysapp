"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHeavyArcher = exports.isLightArcher = exports.isHeavyInf = exports.isLightInf = exports.ResourceTypes = exports.HorseTypes = exports.ArmorTypes = exports.WeaponTypes = exports.SoldierTypes = exports.RankIndex = exports.RankNumber = exports.Ranks = exports.COPPER = exports.SILVER = exports.GOLD = void 0;
exports.fmtCopper = fmtCopper;
// src/logic/types.ts
exports.GOLD = 10000; // 1g = 10000c
exports.SILVER = 100;
exports.COPPER = 1;
function fmtCopper(c) {
    const g = Math.floor(c / exports.GOLD);
    const s = Math.floor((c % exports.GOLD) / exports.SILVER);
    const k = c % exports.SILVER;
    const parts = [];
    if (g)
        parts.push(`${g}g`);
    if (s || (g && k))
        parts.push(`${s}s`);
    if (k || (!g && !s))
        parts.push(`${k}c`);
    return parts.join(' ');
}
exports.Ranks = ['NOVICE', 'TRAINED', 'ADVANCED', 'VETERAN', 'ELITE'];
exports.RankNumber = {
    NOVICE: 0,
    TRAINED: 1,
    ADVANCED: 2,
    VETERAN: 3,
    ELITE: 4,
};
// Some files import this name specifically:
exports.RankIndex = exports.RankNumber;
exports.SoldierTypes = [
    'LIGHT_INF_SWORD', 'LIGHT_INF_SPEAR', 'LIGHT_INF_HALBERD',
    'HEAVY_INF_SWORD', 'HEAVY_INF_SPEAR', 'HEAVY_INF_HALBERD',
    'LIGHT_ARCHER', 'HEAVY_ARCHER',
    'LIGHT_CAV', 'HEAVY_CAV',
    'HORSE_ARCHER',
];
exports.WeaponTypes = ['HALBERD', 'SPEAR', 'SWORD', 'BOW'];
exports.ArmorTypes = ['SHIELD', 'HEAVY_ARMOR', 'LIGHT_ARMOR', 'HORSE_ARMOR'];
exports.HorseTypes = ['LIGHT_HORSE', 'HEAVY_HORSE'];
exports.ResourceTypes = [
    'WOOD', 'STONE', 'IRON_ORE', 'COAL', 'COPPER_ORE', 'SILVER_ORE',
    'IRON_INGOT', 'COPPER_INGOT', 'SILVER_INGOT', 'FOOD'
];
// helpers for type families
const isLightInf = (t) => t === 'LIGHT_INF_SWORD' || t === 'LIGHT_INF_SPEAR' || t === 'LIGHT_INF_HALBERD';
exports.isLightInf = isLightInf;
const isHeavyInf = (t) => t === 'HEAVY_INF_SWORD' || t === 'HEAVY_INF_SPEAR' || t === 'HEAVY_INF_HALBERD';
exports.isHeavyInf = isHeavyInf;
const isLightArcher = (t) => t === 'LIGHT_ARCHER';
exports.isLightArcher = isLightArcher;
const isHeavyArcher = (t) => t === 'HEAVY_ARCHER';
exports.isHeavyArcher = isHeavyArcher;
//# sourceMappingURL=types.js.map