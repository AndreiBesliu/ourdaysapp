// src/utils/barcodeFormat.ts
//
// How a saved loyalty card should be drawn on screen.
//
// This is the one decision in the app where being wrong is worse than doing nothing: the card is
// held up to a scanner at a till, and a barcode drawn in the WRONG SYMBOLOGY reads back as a
// different number than the one that was scanned in. Until 16.09.2026 the viewer mapped four
// formats and sent the other twelve the scanner can produce to CODE128 — including UPC_E, which is
// a COMPRESSED form of UPC-A: the same eight digits drawn as Code 128 are read as eight digits,
// while the UPC-E symbol they came from expands to a twelve-digit number. Different number, same
// card, no warning.
//
// Nobody was bitten, because every one of the ten codes in the live database is EAN-13 or UPC-A,
// both of which were mapped correctly. The first person to add a card in any other format would
// have been.
//
// Two rules follow, and the second matters as much as the first:
//   1. draw it properly when the library can;
//   2. when it cannot, show the NUMBER and say so — never a barcode that is not the card.
// A number can be typed in at a till. A wrong barcode cannot be detected by the person holding it.

/** What the viewer should put on screen. */
export type BarcodeRender =
  /** A 2D matrix code, drawn by the QR renderer. */
  | { kind: 'qr' }
  /** A 1D barcode, drawn by JsBarcode under this exact format name. */
  | { kind: 'barcode'; format: string }
  /**
   * Not drawable as the code it actually is. `reason` says why, so the screen can tell the person
   * whether the card simply cannot be drawn or whether the value does not fit its own format.
   */
  | { kind: 'text'; reason: 'not-drawable' | 'value-mismatch' | 'empty' };

/**
 * Every format `BarcodeScanner` is configured to recognise (html5-qrcode formatsToSupport 0..16).
 * Kept here so `barcodeFormat.test.ts` can assert that each one has a decided answer — adding a
 * format to the scanner without deciding how to draw it should fail a test, not fall through to
 * whatever the last `else` happens to be.
 */
export const SCANNER_FORMATS = [
  'QR_CODE', 'AZTEC', 'CODABAR', 'CODE_39', 'CODE_93', 'CODE_128', 'DATA_MATRIX', 'MAXICODE',
  'ITF', 'EAN_13', 'EAN_8', 'PDF_417', 'RSS_14', 'RSS_EXPANDED', 'UPC_A', 'UPC_E',
  'UPC_EAN_EXTENSION',
] as const;

/** Scanner name → the name JsBarcode knows it by. Only formats the library can actually draw. */
const DRAWABLE: Record<string, string> = {
  CODABAR: 'codabar',
  CODE_39: 'CODE39',
  CODE_93: 'CODE93',
  CODE_128: 'CODE128',
  ITF: 'ITF',
  EAN_13: 'EAN13',
  EAN_8: 'EAN8',
  UPC_A: 'UPC',
  UPC_E: 'UPCE',
};

/** 2D codes the QR renderer handles. */
const MATRIX = new Set(['QR_CODE']);

/**
 * Codes that are neither drawable by JsBarcode nor QR. AZTEC, DATA_MATRIX, PDF_417 and MAXICODE
 * are 2D and cannot be a row of bars at all; RSS_14 and RSS_EXPANDED (GS1 DataBar) have no
 * JsBarcode encoder; UPC_EAN_EXTENSION is a 2- or 5-digit ADD-ON printed beside another code, never
 * a card of its own.
 */
const NOT_DRAWABLE = new Set([
  'AZTEC', 'DATA_MATRIX', 'PDF_417', 'MAXICODE', 'RSS_14', 'RSS_EXPANDED', 'UPC_EAN_EXTENSION',
]);

/** What a value must look like for the formats that are strict about it. */
const SHAPE: Record<string, RegExp> = {
  EAN13: /^\d{13}$/,
  EAN8: /^\d{8}$/,
  UPC: /^\d{12}$/,
  UPCE: /^\d{6}$|^\d{8}$/,
  ITF: /^(\d\d)+$/,       // interleaved 2 of 5: digits, and an EVEN number of them
  codabar: /^[A-Da-d][0-9\-$:/.+]+[A-Da-d]$/,
};

/**
 * Decide how to draw a stored card.
 *
 * `format` is what the scanner reported when the card was added — absent for a code typed in by
 * hand, which every card added before the scanner existed will be.
 */
export function renderFor(format: unknown, value: unknown): BarcodeRender {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!code) return { kind: 'text', reason: 'empty' };

  const name = typeof format === 'string' ? format.trim().toUpperCase() : '';

  if (MATRIX.has(name) || name.includes('QR')) return { kind: 'qr' };
  if (NOT_DRAWABLE.has(name)) return { kind: 'text', reason: 'not-drawable' };

  // No format, or one nobody recognises: CODE128 encodes any ASCII, so it is the honest default
  // for a hand-typed code — and it is what every such card has been drawn as until now, so this
  // keeps them exactly as they are.
  const drawn = DRAWABLE[name] || 'CODE128';

  // A value that does not fit its own format is the other way to get a blank card: JsBarcode
  // refuses to encode it and renders nothing at all, which looks like a bug in the app rather than
  // a problem with the card. Showing the digits is more use than showing white space.
  const shape = SHAPE[drawn];
  if (shape && !shape.test(code)) return { kind: 'text', reason: 'value-mismatch' };

  return { kind: 'barcode', format: drawn };
}
