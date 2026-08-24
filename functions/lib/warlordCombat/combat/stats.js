"use strict";
// src/logic/combat/stats.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// Combat stat tables + counter matrices + terrain modifiers. Pure data + resolvers.
// These numbers are a first pass, tuned for a real rock-paper-scissors and multi-turn
// battles; expect playtest calibration. Mirrors the flat Record<SoldierType, ...> style
// of UPKEEP_BASE/FOOD_BASE in economy.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERRAIN = exports.BRACE_CHARGE_NEGATE = exports.BRACE_MULT = exports.SHIELD_VS_BOW = exports.CAV_VS_RANGED = exports.weaponVsMounted = exports.weaponVsArmor = exports.DEFAULT_COMBAT_STATS = exports.COUNTER_MAX = exports.COUNTER_MIN = exports.RETAL_FACTOR = exports.ROUT_THRESHOLD = exports.XP_CAP = exports.COMBAT_XP_K = exports.LETHALITY = void 0;
exports.moraleCurve = moraleCurve;
exports.weaponClassFromLoadout = weaponClassFromLoadout;
exports.resolveStats = resolveStats;
// ---- Global tunables ----
exports.LETHALITY = 0.35; // scales kills-per-attack → battle length
exports.COMBAT_XP_K = 100; // survivor XP = XP_K * kills / survivors
exports.XP_CAP = 60;
exports.ROUT_THRESHOLD = 10; // morale <= this → unit can only flee, deals 0 damage
exports.RETAL_FACTOR = 0.5; // melee retaliation strength multiplier
exports.COUNTER_MIN = 0.4;
exports.COUNTER_MAX = 2.5;
// Morale → effectiveness multiplier (same curve as computeReady): 100→1.0, 50→0.75, 0→0.5.
function moraleCurve(m) {
    const c = Math.max(0, Math.min(100, m));
    return 0.5 + 0.5 * (c / 100);
}
exports.DEFAULT_COMBAT_STATS = {
    LIGHT_INF_SWORD: { atk: 12, def: 8, range: 1, speed: 4, armorClass: 'light', weaponClass: 'sword', mounted: false, chargeBonus: 1.0, hasShield: true },
    LIGHT_INF_SPEAR: { atk: 10, def: 9, range: 1, speed: 4, armorClass: 'light', weaponClass: 'spear', mounted: false, chargeBonus: 1.0, hasShield: true },
    LIGHT_INF_HALBERD: { atk: 13, def: 7, range: 1, speed: 4, armorClass: 'light', weaponClass: 'halberd', mounted: false, chargeBonus: 1.0, hasShield: true },
    HEAVY_INF_SWORD: { atk: 14, def: 16, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'sword', mounted: false, chargeBonus: 1.0, hasShield: true },
    HEAVY_INF_SPEAR: { atk: 12, def: 17, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'spear', mounted: false, chargeBonus: 1.0, hasShield: true },
    HEAVY_INF_HALBERD: { atk: 16, def: 15, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'halberd', mounted: false, chargeBonus: 1.0, hasShield: true },
    LIGHT_ARCHER: { atk: 11, def: 4, range: 3, speed: 4, armorClass: 'light', weaponClass: 'bow', mounted: false, chargeBonus: 1.0, hasShield: false },
    HEAVY_ARCHER: { atk: 12, def: 10, range: 3, speed: 3, armorClass: 'heavy', weaponClass: 'bow', mounted: false, chargeBonus: 1.0, hasShield: false },
    LIGHT_CAV: { atk: 16, def: 9, range: 1, speed: 7, armorClass: 'light', weaponClass: 'spear', mounted: true, chargeBonus: 1.6, hasShield: false },
    HEAVY_CAV: { atk: 20, def: 16, range: 1, speed: 6, armorClass: 'heavy', weaponClass: 'halberd', mounted: true, chargeBonus: 1.8, hasShield: false },
    HORSE_ARCHER: { atk: 11, def: 6, range: 3, speed: 7, armorClass: 'light', weaponClass: 'bow', mounted: true, chargeBonus: 1.0, hasShield: false },
};
// weaponVsArmor[weapon][defenderArmorClass]
exports.weaponVsArmor = {
    sword: { none: 1.2, light: 1.1, heavy: 0.8 },
    spear: { none: 1.0, light: 1.0, heavy: 0.9 },
    halberd: { none: 1.0, light: 1.1, heavy: 1.5 },
    bow: { none: 1.3, light: 1.0, heavy: 0.5 },
};
// weaponVsMounted[weapon] applied when the DEFENDER is mounted (×1.0 otherwise)
exports.weaponVsMounted = {
    spear: 1.75,
    halberd: 1.5,
    sword: 0.9,
    bow: 1.0,
};
exports.CAV_VS_RANGED = 1.4; // mounted melee attacker vs a non-mounted bow user
exports.SHIELD_VS_BOW = 1.3; // defender def multiplier vs bow when they carry a shield
exports.BRACE_MULT = 1.5; // spear/halberd def bonus when receiving a mounted charge
exports.BRACE_CHARGE_NEGATE = 0.3; // braced defender keeps only 30% of the charge bonus
function weaponClassFromLoadout(w) {
    if (!w)
        return undefined;
    if (w === 'SWORD')
        return 'sword';
    if (w === 'SPEAR')
        return 'spear';
    if (w === 'HALBERD')
        return 'halberd';
    if (w === 'BOW')
        return 'bow';
    return undefined;
}
// Resolve stats: mod override wins, else default table; weaponClass may be overridden
// by the unit's actual loadout weapon. `override` is INJECTED (never read from the
// Registry singleton) so a Cloud Function can resolve stats without booting the client.
function resolveStats(type, loadoutWeapon, override) {
    const base = exports.DEFAULT_COMBAT_STATS[type];
    const merged = override ? Object.assign(Object.assign({}, base), override) : Object.assign({}, base);
    const wc = weaponClassFromLoadout(loadoutWeapon);
    if (wc)
        merged.weaponClass = wc;
    return merged;
}
exports.TERRAIN = {
    PLAINS: { moveCost: 1, moveCostMounted: 1, defMult: 1.0, atkMult: 1.0, chargeMult: 1.0, rangedAtkMult: 1.0, rangeBonus: 0, blocksLosBeyond: 0 },
    FOREST: { moveCost: 2, moveCostMounted: 3, defMult: 1.1, atkMult: 1.0, chargeMult: 0.5, rangedAtkMult: 0.8, rangeBonus: 0, blocksLosBeyond: 1 },
    HILL: { moveCost: 2, moveCostMounted: 2, defMult: 1.25, atkMult: 1.1, chargeMult: 1.0, rangedAtkMult: 1.15, rangeBonus: 1, blocksLosBeyond: 0 },
    RIVER: { moveCost: 3, moveCostMounted: 3, defMult: 0.8, atkMult: 0.7, chargeMult: 0.0, rangedAtkMult: 1.0, rangeBonus: 0, blocksLosBeyond: 0 },
};
//# sourceMappingURL=stats.js.map