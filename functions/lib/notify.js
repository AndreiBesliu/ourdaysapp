"use strict";
// functions/src/notify.ts
// One way to tell somebody something.
//
// ── The problem this replaces ─────────────────────────────────────────────────────────
//
// There were two independent channels that did not agree about what was worth saying:
//
//   the `notifications` collection — the in-app bell. Written by four places. Correctly
//     translated, because it stores keys and the READER's client renders them.
//   FCM push — sent by four DIFFERENT places, none of which wrote a bell row, all of them in
//     hardcoded English, to everybody, in an app that ships in six languages.
//
// So a chat message pushed but left no trace in the bell; a friend request being accepted left a
// bell row and pushed nothing; and an invitation accepted did the same. Whether you found out
// depended on which of two unrelated code paths somebody had happened to wire.
//
// This is the single path. It writes the row AND sends the push, from one description of the
// event, in each recipient's own language.
//
// ── Dead tokens ──────────────────────────────────────────────────────────────────────
//
// Nothing in this codebase has ever pruned `fcmTokens`. `sendEachForMulticast` reports per-token
// failures and every send discarded that report, so the array only ever grew: a new browser, a
// reinstall, a cleared site — each adds one and none is ever removed. Every send then spends
// calls on addresses that can never arrive. Pruning happens here, once, for every caller.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LANG = void 0;
exports.notify = notify;
const admin = require("firebase-admin");
const notifyStrings_1 = require("./notifyStrings");
Object.defineProperty(exports, "DEFAULT_LANG", { enumerable: true, get: function () { return notifyStrings_1.DEFAULT_LANG; } });
const CAP = 200;
/** Where a tapped push opens. The project is fixed in .firebaserc; there is no runtime lookup for it. */
const APP_ORIGIN = "https://our-days-2a939.web.app";
/**
 * Tell people something, in their own language, through both channels.
 *
 * Deliberately NOT transactional. A caller already inside a transaction has done the thing that
 * matters — joined a group, accepted a request — and a failure to deliver news about it must not
 * roll that back. Call it after the transaction commits.
 */
async function notify(spec) {
    var _a, _b;
    const db = admin.firestore();
    const targets = [...new Set(spec.userIds)]
        .filter((u) => typeof u === "string" && u && (spec.includeActor || u !== spec.createdBy))
        .slice(0, 50);
    if (targets.length === 0)
        return { rows: 0, pushed: 0, pruned: 0 };
    const snaps = await db.getAll(...targets.map((u) => db.doc(`users/${u}`)));
    const recipients = snaps.map((s, i) => {
        var _a, _b;
        return ({
            uid: targets[i],
            lang: (0, notifyStrings_1.normaliseLang)((_a = s.data()) === null || _a === void 0 ? void 0 : _a.language),
            tokens: Array.isArray((_b = s.data()) === null || _b === void 0 ? void 0 : _b.fcmTokens)
                ? s.data().fcmTokens.filter((t) => typeof t === "string" && !!t)
                : [],
        });
    });
    // ── the bell row ───────────────────────────────────────────────────────────
    //
    // The keys are what a reader actually renders. The rendered strings are written too, but in the
    // RECIPIENT's language rather than the sender's — they are the fallback for a client too old to
    // know the key, and a fallback in the wrong language is how a Romanian account came to read one
    // English line among four Romanian ones.
    const batch = db.batch();
    for (const r of recipients) {
        batch.set(db.collection("notifications").doc(), Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ userId: r.uid, createdBy: spec.createdBy, type: spec.type }, (spec.titleText ? {} : { titleKey: spec.titleKey.slice(0, 60) })), (spec.titleParam && !spec.titleText ? { titleParam: spec.titleParam.slice(0, CAP) } : {})), (spec.bodyKey ? { bodyKey: spec.bodyKey.slice(0, 60) } : {})), (spec.param ? { param: spec.param.slice(0, CAP) } : {})), { title: (spec.titleText || (0, notifyStrings_1.renderNotify)(spec.titleKey, r.lang, spec.titleParam)).slice(0, CAP), body: spec.bodyText
                ? spec.bodyText.slice(0, 500)
                : spec.bodyKey ? (0, notifyStrings_1.renderNotify)(spec.bodyKey, r.lang, spec.param).slice(0, 500) : "", read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
    }
    await batch.commit();
    if (spec.push === false)
        return { rows: recipients.length, pushed: 0, pruned: 0 };
    const byLang = new Map();
    for (const r of recipients) {
        if (r.tokens.length === 0)
            continue;
        // The annotation is load-bearing: an inline `{ tokens: [] }` infers `never[]`, so the push
        // below is a type error rather than a list.
        const bucket = (_a = byLang.get(r.lang)) !== null && _a !== void 0 ? _a : { tokens: [], owners: new Map() };
        for (const tok of r.tokens) {
            bucket.tokens.push(tok);
            bucket.owners.set(tok, r.uid);
        }
        byLang.set(r.lang, bucket);
    }
    // One tag per call: the same notification reaching two subscriptions on one device collapses
    // into one entry instead of showing twice. Distinct calls get distinct tags, so two broadcasts a
    // minute apart both show. A tap opens the app at the route the caller asked for; before this,
    // a tap did nothing — the payload carried no link and the worker set none.
    const tag = `${spec.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const route = (_b = spec.data) === null || _b === void 0 ? void 0 : _b.route;
    const link = APP_ORIGIN + (typeof route === "string" && route.startsWith("/") ? route : "/");
    let pushed = 0;
    const deadByUser = new Map();
    for (const [lang, bucket] of byLang) {
        const tokens = [...new Set(bucket.tokens)];
        if (tokens.length === 0)
            continue;
        try {
            const res = await admin.messaging().sendEachForMulticast({
                tokens,
                notification: {
                    title: spec.titleText || (0, notifyStrings_1.renderNotify)(spec.titleKey, lang, spec.titleParam),
                    body: spec.bodyText || (spec.bodyKey ? (0, notifyStrings_1.renderNotify)(spec.bodyKey, lang, spec.param) : ""),
                },
                // `tag` also rides in data so the page's foreground handler can use the same one.
                data: Object.assign(Object.assign({}, (spec.data || {})), { tag }),
                webpush: {
                    notification: { icon: "/icons.svg", tag },
                    fcmOptions: { link },
                },
            });
            pushed += res.successCount;
            // The report every previous sender threw away.
            res.responses.forEach((r, i) => {
                var _a, _b;
                if (r.success)
                    return;
                const code = ((_a = r.error) === null || _a === void 0 ? void 0 : _a.code) || "";
                // ONLY these three mean the address itself is gone. Every other failure — a quota, a
                // timeout, a transient server error — must not cost somebody their token, or one bad
                // minute on Google's side would silently unsubscribe the whole family.
                if (code.includes("registration-token-not-registered") ||
                    code.includes("invalid-registration-token") ||
                    code.includes("invalid-argument")) {
                    const owner = bucket.owners.get(tokens[i]);
                    if (!owner)
                        return;
                    deadByUser.set(owner, [...((_b = deadByUser.get(owner)) !== null && _b !== void 0 ? _b : []), tokens[i]]);
                }
            });
        }
        catch (err) {
            // Never fail the caller: the thing being announced has already happened.
            console.error("notify: push failed for", lang, err);
        }
    }
    let pruned = 0;
    for (const [uid, dead] of deadByUser) {
        try {
            await db.doc(`users/${uid}`).update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead),
            });
            pruned += dead.length;
        }
        catch (err) {
            console.error("notify: could not prune tokens for", uid, err);
        }
    }
    return { rows: recipients.length, pushed, pruned };
}
//# sourceMappingURL=notify.js.map