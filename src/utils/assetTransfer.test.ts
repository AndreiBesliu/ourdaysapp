// src/utils/assetTransfer.test.ts
//
// Handing a wallet card to somebody, and what must not travel with it.
//
// The module lives in `functions/` because only the server performs a transfer; the test lives
// here because this is where `npm test` looks. Same arrangement as aiProviderError and errorFixes.

import { describe, it, expect } from 'vitest';
import { transferredCopy, PRIVATE_ON_TRANSFER } from '../../functions/src/assetTransfer';

const ME = 'u1', FRIEND = 'u7';
const NOW = '2026-09-18T12:00:00.000Z';

const sharedCard = {
  name: 'Card Kaufland',
  categories: ['Shopping'],
  imageUrl: 'https://example.test/card.png',
  barcodeValue: '5901234123457',
  barcodeFormat: 'EAN_13',
  ownerId: ME,
  createdAt: '2026-01-01T00:00:00.000Z',
  sharedGroupId: 'g_family',
  sharedWithFamily: true,
};

describe('the defect: the sender’s group came with the card', () => {
  it('hands over a PRIVATE card, whatever the sender had shared', () => {
    // The read rule resolves `sharedGroupId` at read time, so carrying it over means every member
    // of the SENDER's group can read a card in the RECIPIENT's wallet — a group they may not be in
    // and cannot even see named, because the wallet can only print a group name it knows.
    const copy = transferredCopy(sharedCard, ME, FRIEND, NOW);
    expect(copy.sharedGroupId).toBe(null);
    expect(copy.sharedWithFamily).toBe(false);
  });

  it('keeps the legacy twin in step with the real field', () => {
    // `sharedWithFamily` is DERIVED from `sharedGroupId` everywhere else (src/utils/assetSharing.ts).
    // Leaving it behind would let the two disagree, which is how that field earned its reputation.
    expect(PRIVATE_ON_TRANSFER).toEqual({ sharedGroupId: null, sharedWithFamily: false });
    const copy = transferredCopy(sharedCard, ME, FRIEND, NOW);
    expect(Boolean(copy.sharedWithFamily)).toBe(copy.sharedGroupId !== null);
  });

  it('was harmless until sharing worked, which is the point', () => {
    // Eighteen assets on live this morning, `sharedGroupId` null on every one — nothing could leak
    // because nothing was shared. Attaching a card to a group event sets it now.
    const neverShared = { ...sharedCard, sharedGroupId: null, sharedWithFamily: false };
    expect(transferredCopy(neverShared, ME, FRIEND, NOW).sharedGroupId).toBe(null);
  });
});

describe('what the card keeps', () => {
  it('everything that makes it that card', () => {
    const copy = transferredCopy(sharedCard, ME, FRIEND, NOW);
    expect(copy.name).toBe('Card Kaufland');
    expect(copy.barcodeValue).toBe('5901234123457');
    expect(copy.barcodeFormat).toBe('EAN_13');
    expect(copy.imageUrl).toBe('https://example.test/card.png');
    expect(copy.categories).toEqual(['Shopping']);
  });

  it('belongs to the recipient, stamped now, and says where it came from', () => {
    const copy = transferredCopy(sharedCard, ME, FRIEND, NOW);
    expect(copy.ownerId).toBe(FRIEND);
    expect(copy.createdAt).toBe(NOW);
    expect(copy.transferredFrom).toBe(ME);
  });

  it('does not carry the sender’s ownership or the original date', () => {
    const copy = transferredCopy(sharedCard, ME, FRIEND, NOW);
    expect(copy.ownerId).not.toBe(ME);
    expect(copy.createdAt).not.toBe(sharedCard.createdAt);
  });

  it('carries a field nobody has thought of yet', () => {
    // The copy is a denylist, on purpose: a new field on a card is part of the card until somebody
    // decides otherwise. Only the two that decide WHO MAY READ IT are held back.
    const withExtra = { ...sharedCard, expiryDate: '2027-01-01', notes: 'la intrare' };
    const copy = transferredCopy(withExtra, ME, FRIEND, NOW);
    expect(copy.expiryDate).toBe('2027-01-01');
    expect(copy.notes).toBe('la intrare');
  });
});

describe('documents that are not the shape anybody expects', () => {
  it('survives a card with almost nothing on it', () => {
    const copy = transferredCopy({}, ME, FRIEND, NOW);
    expect(copy).toEqual({ sharedGroupId: null, sharedWithFamily: false, ownerId: FRIEND, createdAt: NOW, transferredFrom: ME });
  });

  it('overrides rather than inherits, whatever the source claims', () => {
    // A source that already names the recipient as owner, or carries its own transferredFrom, must
    // not be able to dictate the copy's provenance.
    const bent = { ...sharedCard, transferredFrom: 'somebody-else', ownerId: FRIEND };
    const copy = transferredCopy(bent, ME, FRIEND, NOW);
    expect(copy.transferredFrom).toBe(ME);
    expect(copy.ownerId).toBe(FRIEND);
  });
});
