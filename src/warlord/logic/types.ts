// src/logic/types.ts
export const GOLD = 10000; // 1g = 10000c
export const SILVER = 100;
export const COPPER = 1;

export function fmtCopper(c: number) {
  const g = Math.floor(c / GOLD);
  const s = Math.floor((c % GOLD) / SILVER);
  const k = c % SILVER;
  const parts = [];
  if (g) parts.push(`${g}g`);
  if (s || (g && k)) parts.push(`${s}s`);
  if (k || (!g && !s)) parts.push(`${k}c`);
  return parts.join(' ');
}

export type Rank = 'NOVICE' | 'TRAINED' | 'ADVANCED' | 'VETERAN' | 'ELITE';
export const Ranks: Rank[] = ['NOVICE', 'TRAINED', 'ADVANCED', 'VETERAN', 'ELITE'];
export const RankNumber: Record<Rank, number> = {
  NOVICE: 0,
  TRAINED: 1,
  ADVANCED: 2,
  VETERAN: 3,
  ELITE: 4,
}

// Some files import this name specifically:
export const RankIndex = RankNumber

export type SoldierType =
  // Light infantry by weapon
  | 'LIGHT_INF_SWORD' | 'LIGHT_INF_SPEAR' | 'LIGHT_INF_HALBERD'
  // Heavy infantry by weapon
  | 'HEAVY_INF_SWORD' | 'HEAVY_INF_SPEAR' | 'HEAVY_INF_HALBERD'
  // Archers (light/heavy)
  | 'LIGHT_ARCHER' | 'HEAVY_ARCHER'
  // Cavalry
  | 'LIGHT_CAV' | 'HEAVY_CAV'
  // Horse archers
  | 'HORSE_ARCHER';

export const SoldierTypes: SoldierType[] = [
  'LIGHT_INF_SWORD', 'LIGHT_INF_SPEAR', 'LIGHT_INF_HALBERD',
  'HEAVY_INF_SWORD', 'HEAVY_INF_SPEAR', 'HEAVY_INF_HALBERD',
  'LIGHT_ARCHER', 'HEAVY_ARCHER',
  'LIGHT_CAV', 'HEAVY_CAV',
  'HORSE_ARCHER',
];

export const WeaponTypes = ['HALBERD', 'SPEAR', 'SWORD', 'BOW'] as const;
export const ArmorTypes = ['SHIELD', 'HEAVY_ARMOR', 'LIGHT_ARMOR', 'HORSE_ARMOR'] as const;
export const HorseTypes = ['LIGHT_HORSE', 'HEAVY_HORSE'] as const;

// Export concrete union types derived from the const arrays:
export type Weapon = typeof WeaponTypes[number];
export type Armor = typeof ArmorTypes[number];
export type Horse = typeof HorseTypes[number];

export type UnitBucket = { r: Rank; count: number; avgXP: number };
export type Unit = {
  id: string;
  type: SoldierType;
  buckets: UnitBucket[];
  avgXP: number;
  training: boolean;
  morale: number; // 0–100; afectează combat readiness
  equip: {
    weapons: Record<string, number>;
    armors: Record<string, number>;
    horses: Record<string, number>;
  };
  loadout: any;
};

export type Building = {
  id: string;
  type: 'BARRACKS' | 'BLACKSMITH' | 'ARMORY' | 'WOODWORKER' | 'TAILOR' | 'STABLE' | 'MARKET' |
  'LUMBER_MILL' | 'QUARRY' | 'IRON_MINE' | 'COAL_MINE' | 'COPPER_MINE' | 'SILVER_MINE' | 'SMELTER' | 'MINTER' | 'FARM';
  focusCoinPct: 0 | 20 | 40 | 60 | 80 | 100;
  outputItem?: string;
  fractionalBuffer: number;
};

export type ResourceType =
  | 'WOOD' | 'STONE' | 'IRON_ORE' | 'COAL' | 'COPPER_ORE' | 'SILVER_ORE'
  | 'IRON_INGOT' | 'COPPER_INGOT' | 'SILVER_INGOT'
  | 'FOOD';

export const ResourceTypes: ResourceType[] = [
  'WOOD', 'STONE', 'IRON_ORE', 'COAL', 'COPPER_ORE', 'SILVER_ORE',
  'IRON_INGOT', 'COPPER_INGOT', 'SILVER_INGOT', 'FOOD'
];

export type ResourceMap = Record<ResourceType, number>;

export type BuildingType = Building['type'];
export type BarracksPool = Record<SoldierType, Record<Rank, { r: Rank; count: number; avgXP: number }>>;
export type RecruitPool = { count: number; avgXP: number };

export type Inventories = {
  weapons: Record<string, number>;
  armors: Record<string, number>;
  horses: Record<'LIGHT_HORSE' | 'HEAVY_HORSE', { active: number; inactive: number }>;
};

// helpers for type families
export const isLightInf = (t: SoldierType) =>
  t === 'LIGHT_INF_SWORD' || t === 'LIGHT_INF_SPEAR' || t === 'LIGHT_INF_HALBERD';
export const isHeavyInf = (t: SoldierType) =>
  t === 'HEAVY_INF_SWORD' || t === 'HEAVY_INF_SPEAR' || t === 'HEAVY_INF_HALBERD';
export const isLightArcher = (t: SoldierType) => t === 'LIGHT_ARCHER';
export const isHeavyArcher = (t: SoldierType) => t === 'HEAVY_ARCHER';

// Batches
export type BatchKind =
  | 'LIGHT_TRAIN'           // recruits -> light type (NOVICE)
  | 'CONVERT_HEAVY'         // light(ADV+) -> heavy (same family or cav)
  | 'CONVERT_LIGHT_CAV'     // light inf -> light cav
  | 'CONVERT_HORSE_ARCHER'; // light archer(ADV+) -> horse archer

export type RankCount = Partial<Record<Rank, number>>;
export type TrainingBatch = {
  id: string;
  kind: BatchKind;
  target: SoldierType;
  fromType?: SoldierType;
  takeByRank?: RankCount;
  qty: number;
  daysRemaining: number;
};
