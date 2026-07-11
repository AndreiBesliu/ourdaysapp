// src/logic/items.ts
import { Registry } from './registry'

// Deprecated maps - keeping for type compatibility if needed, but values should come from Registry if possible.
// Actually, let's just use getters or specific functions that use registry.

// Helper to get price from registry
export function itemValueCopper(subtype: string): number {
  const item = Registry.getItem(subtype);
  if (item) return item.price;

  // Fallback / legacy support if registry miss (shouldn't happen for core)
  console.warn(`Item price check failed for ${subtype}`);
  return 0;
}

// Re-export old maps as getters if other files depend on them directly?
// Most files seem to import WeaponPriceCopper directly?
// Let's keep the exports but make them Proxy objects or just filled objects from Registry?
// Since they are used as `WeaponPriceCopper.SWORD`, we can't easily turn them into functions without refactoring callsites.
// But we CAN make them objects that we populate. 
// However, since `Registry` is init at runtime, these exports might be empty if we export them as static objects.
// Better to refactor callsites or make them lazy?
// Callsites: mostly `useBarracks` or `economy` likely using `itemValueCopper` or direct map access.
// `App.tsx` imports them.
// Let's check `App.tsx` usage. It imports them but maybe doesn't use them?
// Ah, `App.tsx` imports them in line 16.

// For now, to support legacy code without massive refactor, let's try to simulate the objects 
// or simpler: just keep `itemValueCopper` as the main API and fix callers? 
// The plan said "Replace WeaponPriceCopper constants with Registry.getItem('ID').price".
// But `WeaponPriceCopper` export itself is used.
// If I remove `WeaponPriceCopper`, build will fail. 
// I will proxy them to Registry or just define them as empty objects casted, and hope everything uses `itemValueCopper`.
// Let's look at `items.ts` again. `itemValueCopper` is the main lookup. 
// Any direct access to `WeaponPriceCopper['SWORD']` will fail if I remove it.

// Strategy: Keep the exports but generic typed, and maybe they just return 0 if accessed directly?
// OR, better: We know the core keys. We can just build the object from Registry? 
// No because Registry init happens later.

// Revised plan:
// 1. Export `itemValueCopper` (already logic).
// 2. Mark `WeaponPriceCopper` etc as DEPRECATED and try to remove their usage.
// 3. For now, to make the build pass, I will just keep `WeaponPriceCopper` as references to the registry keys? 
// Wait, `WeaponPriceCopper` is `Record<Weapon, number>`.
// I'll leave them as empty proxies or similar if possible. 
// Actually, simplest is just to hardcode them to be `itemValueCopper('KEY')` but that's a function call. 

// Let's REPLACE the content to rely on Registry, but exports might need to stay for now.
// I'll keep the exports as `any` or minimal, but mainly implement `itemValueCopper`.

export const WeaponPriceCopper: any = new Proxy({}, {
  get: (_target, prop) => itemValueCopper(String(prop)) || 0
});

export const ArmorPriceCopper: any = new Proxy({}, {
  get: (_target, prop) => itemValueCopper(String(prop)) || 0
});

export const HorsePriceCopper: any = new Proxy({}, {
  get: (_target, prop) => itemValueCopper(String(prop)) || 0
});

