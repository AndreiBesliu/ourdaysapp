// src/components/AssetBarcode.tsx
//
// One renderer for a saved card's code, wherever it is shown.
//
// ── Why it exists ─────────────────────────────────────────────────────────────────────
//
// On 16.09 the wallet stopped guessing how to draw a card and started asking `barcodeFormat.ts`,
// because the old chain mapped four of the seventeen formats the scanner can report and sent the
// rest to CODE128 — including UPC_E, a COMPRESSED UPC-A, which a till then reads back as a
// different number than the card holds. A wrong barcode is the one failure the person holding the
// phone cannot see.
//
// That fix reached one of THREE places. `EventDetailsModal` still carried the old chain twice: on
// the event's linked card, and on the card attached to a checklist item — which is the copy people
// actually hold up at the till, since it is the one that appears next to "buy milk".
//
// So the decision is not just in a module now, it is in a COMPONENT. Three call sites cannot drift
// from each other if there is only one, and `barcodeAdoption.test.ts` refuses a fourth.

import Barcode from 'react-barcode';
import QRCode from 'react-qr-code';
import { renderFor } from '../utils/barcodeFormat';
import { t } from '../utils/i18n';

interface Props {
  value: unknown;
  format: unknown;
  /**
   * The three places a code appears, at the sizes they already had: `lg` is the wallet's
   * hold-this-up view, `md` the card linked to an event, `sm` the one inside a checklist row.
   */
  size?: 'sm' | 'md' | 'lg';
  /** Optional because the theme store types it so; `t()` falls back to en-US. */
  language?: string;
}

// `font` is only set where the site it replaces set it. The wallet and the event's linked card
// never passed one, so they took react-barcode's default of 20; giving them 14 would have shrunk
// the printed digits by a third — the digits somebody reads out when the scanner refuses. Caught
// by review, and invisible to every gate: nothing in a test knows what the old JSX did not say.
const SIZES = {
  lg: { qr: 200, width: 2, height: 100, font: undefined, number: 'text-2xl' },
  md: { qr: 150, width: 2, height: 80, font: undefined, number: 'text-xl' },
  sm: { qr: 100, width: 1.5, height: 50, font: 12, number: 'text-lg' },
} as const;

export default function AssetBarcode({ value, format, size = 'lg', language }: Props) {
  const how = renderFor(format, value);
  const s = SIZES[size];
  const code = typeof value === 'string' ? value : '';

  if (how.kind === 'qr') return <QRCode value={code} size={s.qr} />;

  if (how.kind === 'barcode') {
    return (
      <div className="w-full flex justify-center overflow-hidden">
        <Barcode
          value={code}
          // Cast because react-barcode's typings are STALE: they omit CODE93, which the JsBarcode
          // 3.12.3 it actually bundles supports. Backed by a test — barcodeFormat.test.ts loads the
          // real encoders and refuses any format this module can name that the library cannot draw.
          format={how.format as React.ComponentProps<typeof Barcode>['format']}
          width={s.width}
          height={s.height}
          displayValue={true}
          background="#ffffff"
          lineColor="#000000"
          {...(s.font === undefined ? {} : { fontSize: s.font })}
        />
      </div>
    );
  }

  // Not drawable as the code it really is. The NUMBER is shown instead, large enough to read out
  // or type in, with a line saying why.
  return (
    <div className="w-full text-center py-2">
      <p className={`${s.number} font-mono font-bold tracking-wider text-zinc-900 break-all`}>
        {code || '—'}
      </p>
      <p className="mt-2 text-xs text-amber-600 font-medium">
        {t(how.reason === 'value-mismatch' ? 'walletCodeMismatch' : 'walletCodeNotDrawable', language)}
      </p>
    </div>
  );
}
