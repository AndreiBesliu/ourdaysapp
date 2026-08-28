// src/utils/i18nSpelling.test.ts
// Words that are not words.
//
// ── Why this is separate from i18n.test.ts ────────────────────────────────────────────
//
// The parity test there counts accented LINES per language block and asks for more than fifteen.
// That catches a whole block typed in ASCII. It structurally cannot catch an ISLAND — eight
// stripped keys sitting inside four hundred correct ones still leaves the block far over the
// threshold. An audit found exactly that: the entire expenses cluster in ro/fr/es/it read
// `incarcate`, `fara`, `etre`, `depenses`, `securite`, `correccion`, `non e stata`.
//
// A blanket "long value with no accents" rule is useless here — plenty of correct Italian and
// Spanish carries no accent at all ("Impossibile caricare la conversazione."). So this checks
// something narrower and certain: specific word forms that are never correct unstressed. Each
// entry below is a word whose accented spelling is the ONLY spelling.
//
// Keep the list conservative. A false positive here is a test that gets ignored, which is worse
// than the gap it was meant to close.

import { describe, it, expect } from 'vitest';
import { translations } from './i18n';

/** word (lowercase, matched whole) → what it should have been */
const NEVER_UNACCENTED: Record<string, Record<string, string>> = {
  'ro-RO': {
    fara: 'fără',
    asa: 'așa',
    incarcate: 'încărcate',
    incarcat: 'încărcat',
    reparatie: 'reparație',
    reincercare: 'reîncercare',
    salvata: 'salvată',
    imparte: 'împarte',
    inainte: 'înainte',
    sterge: 'șterge',
    incearca: 'încearcă',
    inregistrata: 'înregistrată',
  },
  'fr-FR': {
    etre: 'être',
    depense: 'dépense',
    depenses: 'dépenses',
    securite: 'sécurité',
    regles: 'règles',
    chargees: 'chargées',
    enregistrees: 'enregistrées',
    enregistree: 'enregistrée',
    partagee: 'partagée',
    deja: 'déjà',
    apres: 'après',
    tres: 'très',
    ete: 'été',
  },
  'es-ES': {
    correccion: 'corrección',
    informacion: 'información',
    sesion: 'sesión',
    numero: 'número',
    guardo: 'guardó',
    aun: 'aún',
  },
  'it-IT': {
    piu: 'più',
    puo: 'può',
    perche: 'perché',
    gia: 'già',
    citta: 'città',
    percio: 'perciò',
  },
};

describe('no language block contains a word that is only ever accented', () => {
  it('checks languages that actually have accents', () => {
    expect(Object.keys(NEVER_UNACCENTED).sort()).toEqual(['es-ES', 'fr-FR', 'it-IT', 'ro-RO']);
  });

  for (const [lang, words] of Object.entries(NEVER_UNACCENTED)) {
    it(`${lang}`, () => {
      const offenders: string[] = [];
      for (const [key, value] of Object.entries(translations[lang])) {
        // Split on anything that is not a letter, so punctuation and placeholders drop out.
        const tokens = String(value).toLowerCase().split(/[^\p{L}]+/u);
        for (const [bad, good] of Object.entries(words)) {
          if (tokens.includes(bad)) offenders.push(`${key}: "${bad}" should be "${good}" — ${value}`);
        }
      }
      expect(offenders, `${lang} has stripped spellings:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});

describe('the check itself is not vacuous', () => {
  it('would catch a stripped word if one were introduced', () => {
    const sample = 'Cheltuielile nu au putut fi incarcate. Sunt salvate fara grup.';
    const tokens = sample.toLowerCase().split(/[^\p{L}]+/u);
    expect(tokens).toContain('incarcate');
    expect(tokens).toContain('fara');
  });

  it('does not fire on the corrected spelling', () => {
    const fixed = 'Cheltuielile nu au putut fi încărcate. Sunt salvate fără grup.';
    const tokens = fixed.toLowerCase().split(/[^\p{L}]+/u);
    expect(tokens).not.toContain('incarcate');
    expect(tokens).not.toContain('fara');
  });
});
