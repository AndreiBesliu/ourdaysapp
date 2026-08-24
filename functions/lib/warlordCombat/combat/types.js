"use strict";
// src/logic/combat/types.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// Pure, JSON-serializable types for the tactical grid combat engine.
// NO React, NO Firestore, NO class instances, NO Map/Set — everything here must
// round-trip through JSON.stringify so the exact same BattleState can run on the
// client (PvE) today and inside a Cloud Function (PvP) later.
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map