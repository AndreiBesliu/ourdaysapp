// src/utils/walletAsset.test.ts
//
// A wallet card as the screens may use it, the numbers the rules hold it to, and the places that
// read cards through it (08.10.2026).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ASSET_CATEGORY_MAX, ASSET_NAME_MAX, assetImageSrc, assetNameFrom, normaliseAsset } from './walletAsset';
import { fieldsOf } from './walletLedger';
import { transferredCopy } from '../../functions/src/assetTransfer';

const MAP = { a: 1 };
const POISON = { toString: 0 };
const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/assets%2Fu%2F1_x.jpg?alt=media&token=ab-1';

const card = {
  id: 'c', name: 'Library card', categories: ['Shopping', 'Kids'], category: 'Shopping', imageUrl: URL_OK,
  barcodeValue: '5901234123457', barcodeFormat: 'EAN_13', sharedGroupId: 'g', ownerId: 'a', sharedWithFamily: true,
};

describe('a card as the screens may use it', () => {
  it('one the app wrote comes through as it was', () => {
    expect(normaliseAsset(card)).toEqual(card);
  });

  it('what a member could plant comes through as harmless kinds', () => {
    const got = normaliseAsset({
      id: 'c', name: MAP, categories: 'x', category: POISON, imageUrl: MAP, barcodeValue: 5,
      barcodeFormat: MAP, sharedGroupId: 7, ownerId: null,
    });
    expect(got).toMatchObject({
      name: '', categories: [], category: '', imageUrl: null, barcodeValue: null, barcodeFormat: null, sharedGroupId: null, ownerId: '',
    });
    expect(normaliseAsset({ id: 'c', categories: ['a', 5, null, 'b'] }).categories).toEqual(['a', 'b']);
  });

  it('the wallet’s ledger judges a card the same before and after', () => {
    // fieldsOf is what tells a landed edit from a lost one; normalising must not change its verdict.
    for (const raw of [card, { ...card, name: MAP, categories: [1, 'x'], barcodeValue: '', barcodeFormat: 5, sharedGroupId: '' }, {}]) {
      expect(fieldsOf(normaliseAsset(raw))).toEqual(fieldsOf(raw));
    }
  });

  it('a photo is shown only if it is a Storage link; the stored link is kept for the edit form', () => {
    expect(assetImageSrc(card)).toBe(URL_OK);
    expect(normaliseAsset({ imageUrl: 'https://tracker.example/p.gif' }).imageUrl).toBe('https://tracker.example/p.gif');
    for (const u of ['https://tracker.example/p.gif', 'javascript:alert(1)', MAP, null, undefined]) {
      expect(assetImageSrc({ imageUrl: u }), String(u)).toBeNull();
    }
    expect(assetImageSrc(undefined)).toBeNull();
  });

  it('a name made from other text is cut to whole characters within the limit', () => {
    expect(assetNameFrom('Dinner', 'Event Image')).toBe('Dinner');
    expect(assetNameFrom('', 'Event Image')).toBe('Event Image');
    expect(assetNameFrom(MAP, 'Checklist Item')).toBe('Checklist Item');
    expect(assetNameFrom('x'.repeat(ASSET_NAME_MAX + 50), 'n')).toHaveLength(ASSET_NAME_MAX);
    // An emoji straddling the limit is left out whole, never cut in half.
    const cut = assetNameFrom('x'.repeat(ASSET_NAME_MAX - 1) + '\u{1F37D}', 'n');
    expect(cut).toBe('x'.repeat(ASSET_NAME_MAX - 1));
    expect(assetNameFrom('x'.repeat(ASSET_NAME_MAX - 2) + '\u{1F37D}', 'n')).toHaveLength(ASSET_NAME_MAX);
  });
});

describe('a card handed to somebody keeps only shown fields of the app’s kind', () => {
  it('a field of the wrong kind is left off the copy, the rest travels', () => {
    const copy = transferredCopy({ ...card, name: MAP, barcodeValue: 5, categories: ['a', 7], notes: 'n' }, 'a', 'b', '2026-10-08T00:00:00.000Z');
    expect('name' in copy).toBe(false);
    expect('barcodeValue' in copy).toBe(false);
    for (const [field, value] of [['category', MAP], ['imageUrl', MAP], ['barcodeFormat', 5], ['categories', 'x']] as const) {
      expect(field in transferredCopy({ ...card, [field]: value }, 'a', 'b', 'now'), field).toBe(false);
    }
    expect(copy.categories).toEqual(['a']);
    expect(copy.barcodeFormat).toBe('EAN_13');
    expect(copy.imageUrl).toBe(URL_OK);
    expect(copy.notes).toBe('n');
    // A card that is right is copied as it is.
    expect(transferredCopy(card, 'a', 'b', 'now')).toMatchObject({ name: card.name, categories: card.categories, barcodeValue: card.barcodeValue });
    expect(transferredCopy({ ...card, imageUrl: null, barcodeValue: null }, 'a', 'b', 'now')).toMatchObject({ imageUrl: null, barcodeValue: null });
  });
});

describe('the rules hold a card to the same numbers', () => {
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n');
  const fn = rules.slice(rules.indexOf('function assetFieldsOk('));
  it('the name, the category and the list of them by their kind only: the installed APK limits none', () => {
    expect(fn).toContain("(!keys.hasAny(['name']) || d.get('name', null) is string)");
    expect(fn).toContain("(!keys.hasAny(['category']) || d.get('category', null) is string)");
    expect(fn).toContain("(!keys.hasAny(['categories']) || d.get('categories', null) is list)");
    // The web form limits them itself.
    expect(ASSET_NAME_MAX).toBeGreaterThan(0);
    expect(ASSET_CATEGORY_MAX).toBeGreaterThan(0);
  });
  it('and limits no real card reaches, where no free text goes: a Storage link, a scanner format, a code', () => {
    // Each well above what is stored (links of ~240 characters, formats of at most 17, codes of 13).
    expect(fn).toContain("evOptText(d.get('imageUrl', null), 4096)");
    expect(fn).toContain("evOptText(d.get('barcodeFormat', null), 64)");
    expect(fn).toContain("evOptText(d.get('barcodeValue', null), 7089)");
  });
  it('on create every key, on an edit the keys it changes — or every key when it is shared into a group', () => {
    const block = rules.slice(rules.indexOf('match /assets/{assetId}'), rules.indexOf('match /aiLedger/{rowId}'));
    const create = block.slice(block.indexOf('allow create:'), block.indexOf('allow delete:'));
    const update = block.slice(block.indexOf('allow update:'));
    expect(create).toContain('assetFieldsOk(request.resource.data, request.resource.data.keys())');
    expect(update).toContain("!= resource.data.get('sharedGroupId', null))\n               ? request.resource.data.keys()\n               : request.resource.data.diff(resource.data).affectedKeys());");
  });
});

describe('every place that shows other members’ cards uses it', () => {
  const wallet = readFileSync('src/screens/Wallet.tsx', 'utf8').replace(/\r\n/g, '\n');
  const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
  const details = readFileSync('src/components/EventDetailsModal.tsx', 'utf8');
  it.each([
    ['the Wallet’s own cards', 'setOwnedAssets(docs.map(normaliseAsset));', wallet],
    ['the cards shared with my groups', 'setSharedAssets((prev) => ({ ...prev, [groupId]: docs.map(normaliseAsset) }))', wallet],
    ['grouped on an object with no prototype ("constructor" is a category name too)', '}, Object.create(null)) : {};', wallet],
    ['each card in a boundary of its own', 'context="Wallet.card"', wallet],
    ['in the filtered view', 'filteredAssets.map(asset => cardInBoundary(asset))', wallet],
    ['and in the grouped one', 'groupedAssets[catName].map((asset: any) => cardInBoundary(asset))', wallet],
    ['the code viewer too', 'context="Wallet.codeViewer"', wallet],
    ['the expenses tab too', 'context="ExpensesTab"', wallet],
    ['a card’s photo only through assetImageSrc', 'const photo = assetImageSrc(asset);', wallet],
    ['the name input stops at the rule', 'maxLength={ASSET_NAME_MAX}', wallet],
    ['the category inputs too', 'maxLength={ASSET_CATEGORY_MAX}', wallet],
    ['the event form’s own cards', 'setOwnedAssets(docs.map(normaliseAsset));', form],
    ['the event form’s shared cards', 'setGroupSharedAssets(docs.map(normaliseAsset))', form],
    ['a card made from an event photo is named within the limit', "name: assetNameFrom(title, 'Event Image'),", form],
    ['and from a checklist photo', "name: assetNameFrom(item.text, 'Checklist Item'),", form],
    ['a card’s photo is copied into an event only if it is a Storage link', 'setSelectedAssetUrl(assetImageSrc(asset));', form],
    ['the linked card on an event', 'setLinkedAsset(normaliseAsset({ ...docSnap.data(), id: docSnap.id }));', details],
    ['the cards on its checklist', 'newMap[item.assetId] = normaliseAsset({ ...docSnap.data(), id: docSnap.id });', details],
  ])('%s', (_label, line, source) => {
    expect(source).toContain(line);
  });

  it('no card photo is drawn straight from the stored link', () => {
    expect(wallet).not.toMatch(/src=\{asset\.imageUrl\}/);
    expect(form).not.toMatch(/src=\{asset\.imageUrl\}/);
  });

  it('a category named like an Object.prototype member groups like any other', () => {
    const grouped = ['constructor', 'toString', '__proto__', 'Shopping'].reduce((acc: Record<string, string[]>, c) => {
      if (!acc[c]) acc[c] = [];
      acc[c].push(c);
      return acc;
    }, Object.create(null));
    expect(Object.keys(grouped)).toEqual(['constructor', 'toString', '__proto__', 'Shopping']);
  });
});
