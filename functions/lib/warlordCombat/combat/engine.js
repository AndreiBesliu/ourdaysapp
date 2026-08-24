"use strict";
// src/logic/combat/engine.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// The pure, deterministic combat reducer. The same code runs client-side for PvE and inside
// a Cloud Function for PvP, which has been live for months. No React, no Firestore, no clock.
//
// applyCommand(state, cmd) -> state is the single entry point for advancing a battle.
// An illegal/stale command returns state unchanged with a `skipped` log entry — it
// never throws, so a bad client message can't desync a PvP match.
Object.defineProperty(exports, "__esModule", { value: true });
exports.moraleMult = moraleMult;
exports.inBounds = inBounds;
exports.terrainAt = terrainAt;
exports.combatantById = combatantById;
exports.combatantAt = combatantAt;
exports.chebyshev = chebyshev;
exports.hasLineOfSight = hasLineOfSight;
exports.legalMoves = legalMoves;
exports.effectiveRange = effectiveRange;
exports.legalTargets = legalTargets;
exports.estimateKills = estimateKills;
exports.forecastAttack = forecastAttack;
exports.applyCommand = applyCommand;
exports.checkVictory = checkVictory;
exports.buildBattle = buildBattle;
const rng_1 = require("./rng");
const stats_1 = require("./stats");
const DEFAULT_CONFIG = { lethality: stats_1.LETHALITY, maxTurns: 40 };
// ---- Small pure helpers ----
function moraleMult(m) {
    return (0, stats_1.moraleCurve)(m);
}
function inBounds(s, x, y) {
    return x >= 0 && y >= 0 && x < s.width && y < s.height;
}
function terrainAt(s, x, y) {
    const row = s.terrain[String(y)];
    return (row && row[x]) || 'PLAINS';
}
function combatantById(s, id) {
    return s.combatants.find((c) => c.id === id);
}
function combatantAt(s, x, y) {
    return s.combatants.find((c) => c.x === x && c.y === y && c.hp > 0);
}
function chebyshev(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
function statsOf(c) {
    return (0, stats_1.resolveStats)(c.type, c.loadoutWeapon, c.statsOverride);
}
function cloneState(s) {
    return structuredClone(s);
}
// Draw one deterministic float in [0,1) and advance the state's rng cursor in place.
function draw(s) {
    const v = (0, rng_1.mulberry32Once)((0, rng_1.hash32)(s.seed, s.rngCursor));
    s.rngCursor++;
    return v;
}
// ---- Line of sight (ranged) ----
// Blocked if any strictly-intermediate tile is FOREST (forest blocks LOS beyond 1 tile).
function hasLineOfSight(s, ax, ay, bx, by) {
    const steps = chebyshev(ax, ay, bx, by);
    if (steps <= 1)
        return true;
    for (let i = 1; i < steps; i++) {
        const x = Math.round(ax + ((bx - ax) * i) / steps);
        const y = Math.round(ay + ((by - ay) * i) / steps);
        if (terrainAt(s, x, y) === 'FOREST')
            return false;
    }
    return true;
}
// ---- Movement ----
const DIRS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];
// Reachable, unoccupied tiles within the unit's move budget (uniform-cost search over
// terrain move cost). Occupied tiles are impassable (can't pass through or stop on them).
function legalMoves(s, id) {
    const c = combatantById(s, id);
    if (!c || c.hp <= 0 || c.routed || c.hasMoved)
        return [];
    const st = statsOf(c);
    const budget = st.speed;
    const key = (x, y) => `${x},${y}`;
    const dist = { [key(c.x, c.y)]: 0 };
    // simple Dijkstra with a linear frontier (grids are tiny)
    const frontier = [{ x: c.x, y: c.y }];
    const out = [];
    while (frontier.length) {
        // pop the lowest-dist node
        let bi = 0;
        for (let i = 1; i < frontier.length; i++) {
            if (dist[key(frontier[i].x, frontier[i].y)] < dist[key(frontier[bi].x, frontier[bi].y)])
                bi = i;
        }
        const cur = frontier.splice(bi, 1)[0];
        const curD = dist[key(cur.x, cur.y)];
        for (const [dx, dy] of DIRS) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (!inBounds(s, nx, ny))
                continue;
            if (combatantAt(s, nx, ny))
                continue; // impassable
            const t = stats_1.TERRAIN[terrainAt(s, nx, ny)];
            const cost = st.mounted ? t.moveCostMounted : t.moveCost;
            const nd = curD + cost;
            if (nd > budget)
                continue;
            const k = key(nx, ny);
            if (dist[k] === undefined || nd < dist[k]) {
                dist[k] = nd;
                frontier.push({ x: nx, y: ny });
                out.push({ x: nx, y: ny });
            }
        }
    }
    // de-dup (a tile may be pushed twice with improving dist)
    const seen = new Set();
    return out.filter((p) => {
        const k = key(p.x, p.y);
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}
function effectiveRange(s, c) {
    const st = statsOf(c);
    const isRanged = st.range >= 2;
    const bonus = isRanged ? stats_1.TERRAIN[terrainAt(s, c.x, c.y)].rangeBonus : 0;
    return st.range + bonus;
}
function legalTargets(s, id) {
    const c = combatantById(s, id);
    if (!c || c.hp <= 0 || c.routed || c.hasActed)
        return [];
    const range = effectiveRange(s, c);
    const out = [];
    for (const t of s.combatants) {
        if (t.side === c.side || t.hp <= 0)
            continue;
        const d = chebyshev(c.x, c.y, t.x, t.y);
        if (d < 1 || d > range)
            continue;
        if (d >= 2 && !hasLineOfSight(s, c.x, c.y, t.x, t.y))
            continue;
        out.push(t.id);
    }
    return out;
}
// Pure kills computation with EXPLICIT variance and attacker position — no rng access,
// no state mutation. Both real resolution (variance from rng) and the AI's mean-damage
// estimate (variance = 1.0, hypothetical position) go through this one function.
function computeKillsCore(s, a, d, o) {
    const sa = statsOf(a);
    const sd = statsOf(d);
    const aTile = stats_1.TERRAIN[terrainAt(s, o.aX, o.aY)];
    const dTile = stats_1.TERRAIN[terrainAt(s, d.x, d.y)];
    const isRanged = !o.isMelee;
    let atk = sa.atk * (1 + 0.1 * a.vet) * (0, stats_1.moraleCurve)(a.morale);
    if (sa.weaponClass === 'bow' && o.isMelee)
        atk *= 0.5; // archers are weak in melee
    const braced = o.isMelee && sa.mounted && (sd.weaponClass === 'spear' || sd.weaponClass === 'halberd');
    const braceMult = braced ? stats_1.BRACE_MULT : 1.0;
    const shieldMult = sd.hasShield && sa.weaponClass === 'bow' ? stats_1.SHIELD_VS_BOW : 1.0;
    const def = sd.def * (1 + 0.08 * d.vet) * dTile.defMult * braceMult * shieldMult;
    let counter = stats_1.weaponVsArmor[sa.weaponClass][sd.armorClass];
    if (sd.mounted && o.isMelee)
        counter *= stats_1.weaponVsMounted[sa.weaponClass];
    if (o.isMelee && sa.mounted && sd.weaponClass === 'bow' && !sd.mounted)
        counter *= stats_1.CAV_VS_RANGED;
    counter = Math.max(stats_1.COUNTER_MIN, Math.min(stats_1.COUNTER_MAX, counter));
    let charge = 1.0;
    if (o.allowCharge && sa.mounted && o.aMoved && o.isMelee) {
        charge = sa.chargeBonus * aTile.chargeMult;
        if (braced)
            charge = 1 + (charge - 1) * stats_1.BRACE_CHARGE_NEGATE;
    }
    const terrainAtk = isRanged ? aTile.rangedAtkMult : aTile.atkMult;
    const ratio = atk / (atk + def);
    const raw = a.hp * ratio * counter * charge * terrainAtk * s.config.lethality * o.variance * o.factor;
    return Math.max(0, Math.min(Math.round(raw), d.hp));
}
// Real damage: consumes exactly one rng draw (variance), advancing the state cursor.
function resolveDamage(s, a, d, opts) {
    const variance = 0.9 + 0.2 * draw(s);
    return computeKillsCore(s, a, d, {
        isMelee: opts.isMelee, allowCharge: opts.allowCharge, factor: opts.factor,
        variance, aX: a.x, aY: a.y, aMoved: a.hasMoved,
    });
}
// Mean-damage estimate for AI planning: no rng, no mutation. Attacker may be evaluated
// at a hypothetical tile (aX/aY) with aMoved=true to score a charge after moving.
function estimateKills(s, a, d, opts) {
    var _a, _b, _c, _d, _e;
    return computeKillsCore(s, a, d, {
        isMelee: opts.isMelee,
        allowCharge: (_a = opts.allowCharge) !== null && _a !== void 0 ? _a : true,
        factor: (_b = opts.factor) !== null && _b !== void 0 ? _b : 1.0,
        variance: 1.0,
        aX: (_c = opts.aX) !== null && _c !== void 0 ? _c : a.x,
        aY: (_d = opts.aY) !== null && _d !== void 0 ? _d : a.y,
        aMoved: (_e = opts.aMoved) !== null && _e !== void 0 ? _e : a.hasMoved,
    });
}
// Player-facing attack preview: mean-variance estimate of an attack and the likely
// retaliation. Pure — consumes NO rng and never mutates state, so showing it cannot
// desync a battle (critical for PvP later). Returns null for illegal targets.
function forecastAttack(s, attackerId, targetId) {
    const a = combatantById(s, attackerId);
    const d = combatantById(s, targetId);
    if (!a || !d)
        return null;
    if (!legalTargets(s, attackerId).includes(targetId))
        return null;
    const melee = chebyshev(a.x, a.y, d.x, d.y) <= 1;
    const kills = estimateKills(s, a, d, { isMelee: melee, allowCharge: true });
    const hpAfter = d.hp - kills;
    let retalKills = 0;
    if (melee && hpAfter > 0) {
        // Mirror the real retaliation rules: survivor retaliates unless the morale hit routs it.
        const lossFrac = kills / Math.max(1, d.hp);
        const moraleAfter = Math.max(0, Math.min(100, d.morale - Math.round(20 * lossFrac)));
        if (moraleAfter > stats_1.ROUT_THRESHOLD) {
            const dAfter = Object.assign(Object.assign({}, d), { hp: hpAfter, morale: moraleAfter });
            retalKills = estimateKills(s, dAfter, a, { isMelee: true, allowCharge: false, factor: stats_1.RETAL_FACTOR });
        }
    }
    return { targetId, targetName: d.name, melee, kills, retalKills, lethal: hpAfter <= 0 };
}
function applyMoraleHit(c, kills, hpBefore) {
    const lossFrac = kills / Math.max(1, hpBefore);
    c.morale = Math.max(0, Math.min(100, c.morale - Math.round(20 * lossFrac)));
    if (c.morale <= stats_1.ROUT_THRESHOLD)
        c.routed = true;
}
// ---- Reducer ----
function applyCommand(state, cmd) {
    if (state.status !== 'ONGOING')
        return state;
    const s = cloneState(state);
    if (cmd.kind === 'END_TURN')
        return endTurn(s);
    const actor = combatantById(s, cmd.id);
    if (!actor || actor.side !== s.side || actor.hp <= 0 || actor.routed) {
        return skip(s, cmd);
    }
    if (cmd.kind === 'MOVE') {
        if (actor.hasMoved)
            return skip(s, cmd);
        const legal = legalMoves(s, actor.id).some((p) => p.x === cmd.to.x && p.y === cmd.to.y);
        if (!legal)
            return skip(s, cmd);
        const fromX = actor.x;
        const fromY = actor.y;
        actor.x = cmd.to.x;
        actor.y = cmd.to.y;
        actor.hasMoved = true;
        s.log.push({ turn: s.turn, side: s.side, kind: 'move', actorId: actor.id, detail: { fromX, fromY, toX: cmd.to.x, toY: cmd.to.y } });
        return s;
    }
    // ATTACK
    if (actor.hasActed)
        return skip(s, cmd);
    if (!legalTargets(s, actor.id).includes(cmd.targetId))
        return skip(s, cmd);
    const target = combatantById(s, cmd.targetId);
    const dist = chebyshev(actor.x, actor.y, target.x, target.y);
    const isMelee = dist <= 1;
    actor.hasActed = true;
    const defHpBefore = target.hp;
    const kills = resolveDamage(s, actor, target, { isMelee, allowCharge: true, factor: 1.0 });
    target.hp -= kills;
    actor.kills += kills;
    applyMoraleHit(target, kills, defHpBefore);
    s.log.push({
        turn: s.turn, side: s.side, kind: 'attack', actorId: actor.id, targetId: target.id,
        detail: { kills, melee: isMelee ? 1 : 0, targetHp: Math.max(0, target.hp), targetMorale: target.morale },
    });
    if (target.hp <= 0) {
        s.log.push({ turn: s.turn, side: s.side, kind: 'destroyed', targetId: target.id, detail: { name: target.name } });
    }
    else if (isMelee && !target.routed) {
        // Melee retaliation (single, no charge, no counter-retaliation)
        const atkHpBefore = actor.hp;
        const rk = resolveDamage(s, target, actor, { isMelee: true, allowCharge: false, factor: stats_1.RETAL_FACTOR });
        actor.hp -= rk;
        target.kills += rk;
        applyMoraleHit(actor, rk, atkHpBefore);
        s.log.push({
            turn: s.turn, side: target.side, kind: 'retaliate', actorId: target.id, targetId: actor.id,
            detail: { kills: rk, targetHp: Math.max(0, actor.hp) },
        });
        if (actor.hp <= 0) {
            s.log.push({ turn: s.turn, side: target.side, kind: 'destroyed', targetId: actor.id, detail: { name: actor.name } });
        }
    }
    // Destroyed combatants STAY in the array (hp 0). Every consumer already filters on
    // hp > 0 (combatantAt, legalTargets, sideActive, the AI, the grid) — keeping them
    // preserves their kill counts for the battle report and post-battle XP write-back.
    return checkVictory(s);
}
function skip(s, cmd) {
    var _a;
    s.log.push({ turn: s.turn, side: s.side, kind: 'skipped', detail: { cmd: cmd.kind, id: (_a = cmd.id) !== null && _a !== void 0 ? _a : '' } });
    return s;
}
function endTurn(s) {
    const nextSide = s.side === 'PLAYER' ? 'ENEMY' : 'PLAYER';
    for (const c of s.combatants) {
        if (c.side === nextSide) {
            c.hasMoved = false;
            c.hasActed = false;
        }
    }
    if (nextSide === 'PLAYER')
        s.turn++;
    s.side = nextSide;
    s.phase = nextSide === 'PLAYER' ? 'PLAYER_TURN' : 'ENEMY_TURN';
    s.log.push({ turn: s.turn, side: s.side, kind: 'end_turn' });
    return checkVictory(s);
}
function sideActive(s, side) {
    return s.combatants.some((c) => c.side === side && c.hp > 0 && !c.routed);
}
function checkVictory(s) {
    const p = sideActive(s, 'PLAYER');
    const e = sideActive(s, 'ENEMY');
    if (!p && !e) {
        s.status = 'DRAW';
        s.winner = null;
        s.phase = 'RESOLVED';
    }
    else if (!e) {
        s.status = 'PLAYER_WON';
        s.winner = 'PLAYER';
        s.phase = 'RESOLVED';
    }
    else if (!p) {
        s.status = 'ENEMY_WON';
        s.winner = 'ENEMY';
        s.phase = 'RESOLVED';
    }
    else if (s.turn > s.config.maxTurns) {
        const hp = (side) => s.combatants.filter((c) => c.side === side).reduce((a, c) => a + c.hp, 0);
        const ph = hp('PLAYER');
        const eh = hp('ENEMY');
        s.status = ph > eh ? 'PLAYER_WON' : eh > ph ? 'ENEMY_WON' : 'DRAW';
        s.winner = s.status === 'PLAYER_WON' ? 'PLAYER' : s.status === 'ENEMY_WON' ? 'ENEMY' : null;
        s.phase = 'RESOLVED';
    }
    if (s.phase === 'RESOLVED' && s.status !== 'ONGOING') {
        s.log.push({ turn: s.turn, side: s.side, kind: 'victory', detail: { status: s.status } });
    }
    return s;
}
function buildBattle(params) {
    var _a;
    const s = {
        version: 1,
        seed: params.seed >>> 0,
        rngCursor: 0,
        width: params.width,
        height: params.height,
        terrain: params.terrain,
        combatants: [...params.playerCombatants, ...params.enemyCombatants],
        turn: 1,
        side: 'PLAYER',
        phase: 'PLAYER_TURN',
        status: 'ONGOING',
        winner: null,
        log: [{ turn: 1, side: 'PLAYER', kind: 'start', detail: { difficulty: params.difficulty } }],
        config: (_a = params.config) !== null && _a !== void 0 ? _a : Object.assign({}, DEFAULT_CONFIG),
        difficulty: params.difficulty,
    };
    return s;
}
//# sourceMappingURL=engine.js.map