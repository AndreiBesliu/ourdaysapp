// src/firebaseStorage.ts
//
// Firebase Storage, apart from src/firebase.ts (07.11.2026). It sat in the chunk every person loads at boot, although
// only screens that load on demand use it: the wallet, and every upload (utils/uploadFile.ts, from the add window, the
// chat, settings and the wallet). Imported from here, it loads with the first of them; the app also fetches those while
// idle (App.tsx, `warmRoutes`). `scripts/check-split.mjs` refuses a build that brings it back into boot.

import { getStorage } from 'firebase/storage';
import { app } from './firebase';

export const storage = getStorage(app);
