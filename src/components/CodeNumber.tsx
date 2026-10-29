// src/components/CodeNumber.tsx
//
// A card's code shown as its NUMBER, large enough to read out at the till or type in, with a line
// saying why there is no barcode. Two places need it: AssetBarcode, for a code it cannot draw as what
// it really is, and LazyAssetBarcode, for when the drawing code itself could not be loaded (29.10.2026).
// Its own module, with no code library in it, so the second can show it without loading them.

import { t } from '../utils/i18n';

/** The number's size at each of the three places a code appears (AssetBarcode's `size`). */
export const NUMBER_SIZE = { lg: 'text-2xl', md: 'text-xl', sm: 'text-lg' } as const;

interface Props {
  value: unknown;
  size: keyof typeof NUMBER_SIZE;
  /** The i18n key of the line under the number. */
  reason: 'walletCodeMismatch' | 'walletCodeNotDrawable' | 'walletCodeNotLoaded';
  language?: string;
}

export default function CodeNumber({ value, size, reason, language }: Props) {
  const code = typeof value === 'string' ? value : '';
  return (
    <div className="w-full text-center py-2">
      <p className={`${NUMBER_SIZE[size]} font-mono font-bold tracking-wider text-zinc-900 break-all`}>
        {code || '—'}
      </p>
      <p className="mt-2 text-xs text-amber-600 font-medium">{t(reason, language)}</p>
    </div>
  );
}
