"use strict";
// functions/src/globalOptions.ts
//
// Options every function in this codebase gets. Imported FIRST in index.ts, before anything that
// defines a function — and that position is the whole point of this file.
//
// firebase-functions v6 builds each function's deploy description (`__endpoint`) when the function
// is DEFINED, reading the global options as they are at that moment. A `setGlobalOptions` call
// applies only to functions defined after it. Until 24.09.2026 the call sat in index.ts below the
// `export … from "./inviteLinks"` lines, whose modules had already run — so 10 of the 51 functions
// (invite links, direct chat, reminders, the error digest, idle games) deployed with no ceiling,
// while a source test that looked for the call's text stayed green. Found by the pre-deploy
// review. `functions/test/globalOptions.test.ts` now reads the ceiling off every exported
// function, where the deploy reads it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CALLABLE_REGIONS = exports.REGION = exports.MAX_INSTANCES = void 0;
const v2_1 = require("firebase-functions/v2");
// A ceiling on instances per function. There was none anywhere, so a burst — a bug in a client
// loop, or somebody calling a callable in a loop — could scale out and bill without limit. Ten is
// far above what eight people need, and low enough to cap a runaway.
exports.MAX_INSTANCES = 10;
// The region (31.10.2026): the database is in europe-central2, and until now every function ran in us-central1,
// so each query crossed the Atlantic (measured on live: 165–188 ms a query; the reminders' series read, 4 queries,
// 842–892 ms). Everything runs next to the database now. The callables ALSO stay in us-central1 (CALLABLE_REGIONS):
// the installed APK runs a frozen bundle that calls them there, and the web app calls europe-central2
// (src/firebase.ts, FUNCTIONS_REGION). Scheduled jobs and triggers run in one region only: a trigger with a
// second copy fires twice per document (two pushes per chat message, two paid Claude calls and two checklists
// per AI event, two announcements per game; the reminders dedupe themselves). functions/test/regions.test.ts
// holds all of it on the compiled endpoints.
exports.REGION = "europe-central2";
exports.CALLABLE_REGIONS = [exports.REGION, "us-central1"];
(0, v2_1.setGlobalOptions)({ maxInstances: exports.MAX_INSTANCES, region: exports.REGION });
//# sourceMappingURL=globalOptions.js.map