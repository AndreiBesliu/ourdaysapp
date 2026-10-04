import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, setDoc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { auth, db } from './firebase';
import { bootstrapPlan, profileReadOf, laterWrites } from './utils/bootstrapWrites';
import type { MirrorFields } from './utils/publicProfile';
import { liveDoc } from './utils/liveQuery';
import { PushNotifications } from '@capacitor/push-notifications';
import { rememberPushToken } from './utils/pushRelease';
import { registerNativePush } from './utils/nativePush';
import { Capacitor } from '@capacitor/core';

// Components
import Login from './screens/Login';
import CalendarHome from './screens/CalendarHome';
import Friends from './screens/Friends';
import JoinInvite, { peekPendingInvite } from './screens/JoinInvite';
import ErrorBoundary from './components/ErrorBoundary';
import NewVersionNotice from './components/NewVersionNotice';
import { installGlobalErrorHandlers, reportError } from './reportError';
const Admin = lazy(() => import('./screens/Admin')); // owner-only, rarely used → lazy

installGlobalErrorHandlers();
const Warlord = lazy(() => import('./screens/Warlord')); // large embedded game → lazy chunk
const PeriodLog = lazy(() => import('./screens/PeriodLog'));
// Out of the entry chunk since 25.09.2026 — the audit found everything but Warlord, Admin and the
// log in one 1.5 MB file. Wallet alone carries the barcode scanner (html5-qrcode / ZXing), about
// 413 kB of it, which almost nobody needs at boot. The loaders are named so the warm-up below can
// fetch the same chunks while the app is idle; `scripts/check-split.mjs` fails a build that pulls
// any of them back into what loads at boot.
const loadWallet = () => import('./screens/Wallet');
const loadChat = () => import('./screens/Chat');
const loadSettings = () => import('./screens/Settings');
const Wallet = lazy(loadWallet);
const Chat = lazy(loadChat);
const Settings = lazy(loadSettings);
import { warmRoutes } from './utils/routeWarmup';
import { forgetOfflineWallet, readOfflineWallet } from './utils/offlineWallet';
import { startOfflineWalletSync, stopOfflineWalletSync } from './utils/offlineWalletSync';
import { offlineCardsEnabled } from './utils/offlineCardsFlag';

/** What a lazy screen shows for the moment its chunk loads: the app's own spinner, no text. */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-transparent">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}
import { useThemeStore } from './store';
import { shouldUseLightText, primaryTokens } from './utils/themeContrast';
import { isValidZone, localZone } from './utils/eventTime';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme, setAdvancedTheme, resetTheme, isDarkMode, customThemeIsDark, primaryColor, backgroundImage, backgroundColor, backgroundStyle, backgroundOverlay, overlayColor } = useThemeStore();

  // The `dark` class flips every `dark:` text colour in the app, so it has to be decided by the
  // colour the text actually LANDS on — not by a toggle with no relationship to it.
  //
  // It used to be `isDarkMode || customThemeIsDark`, while the background came from a free colour
  // picker plus an overlay. "Dark theme on, and my own light background" — the two controls sit
  // next to each other in Settings — put light text on a light page: 1.01–1.46 at a low overlay,
  // i.e. invisible, and still only 3.62 at the default 50%. See src/utils/themeContrast.ts.
  //
  // For a coherent theme this returns exactly what the toggle said, so nothing anyone has set up
  // changes; it only overrides the combinations that contradict themselves.
  useEffect(() => {
    const wantsLightText = shouldUseLightText({
      isDarkMode,
      customThemeIsDark,
      backgroundColor,
      overlayColor,
      backgroundOverlay,
      backgroundImage,
    });
    document.documentElement.classList.toggle('dark', wantsLightText);
  }, [isDarkMode, customThemeIsDark, backgroundColor, overlayColor, backgroundOverlay, backgroundImage]);

  useEffect(() => {
    // Both accent properties come from ONE function now, in `themeContrast.ts`, beside the
    // luminance it uses. This used to be a second copy of that arithmetic written out inline, and
    // it trusted its input: `parseFloat('#3b82f6')` is NaN, every number after it is NaN, and
    // `NaN > 0.179` is FALSE — so a malformed accent quietly chose the LIGHT foreground while
    // `--primary` itself became invalid and the accent background vanished. Near-white text on no
    // background. Both signup paths once wrote this value as a hex, so the shape was real.
    const tokens = primaryTokens(primaryColor);
    document.documentElement.style.setProperty('--primary', tokens.primary);
    document.documentElement.style.setProperty('--primary-foreground', tokens.foreground);
    if (tokens.fellBack) {
      reportError(`Unusable primaryColor: ${JSON.stringify(primaryColor)}`, { context: 'App.primaryTokens' });
    }
    
    // Apply background image and overlay
    if (isDarkMode) {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundColor = '#09090b'; // zinc-950
      document.body.style.backgroundSize = '';
      document.body.style.backgroundRepeat = '';
      document.body.style.backgroundPosition = '';
      document.body.style.backgroundAttachment = '';
    } else {
      // Parse overlay color to RGB
      let r = customThemeIsDark ? 0 : 255;
      let g = customThemeIsDark ? 0 : 255;
      let b = customThemeIsDark ? 0 : 255;
      
      if (overlayColor && overlayColor.startsWith('#')) {
        const hex = overlayColor.replace('#', '');
        if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        }
      }

      const overlayAlpha = ((backgroundOverlay ?? 50) / 100).toFixed(2);
      const gradient = `linear-gradient(rgba(${r},${g},${b}, ${overlayAlpha}), rgba(${r},${g},${b}, ${overlayAlpha}))`;

      if (backgroundImage) {
        document.body.style.backgroundImage = `${gradient}, url(${backgroundImage})`;
        document.body.style.backgroundColor = backgroundColor || (customThemeIsDark ? '#09090b' : '#ffffff');
        if (backgroundStyle === 'stretch') {
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundRepeat = 'no-repeat';
          document.body.style.backgroundPosition = 'center';
          document.body.style.backgroundAttachment = 'fixed';
        } else if (backgroundStyle === 'contain') {
          document.body.style.backgroundSize = 'contain';
          document.body.style.backgroundRepeat = 'no-repeat';
          document.body.style.backgroundPosition = 'center';
          document.body.style.backgroundAttachment = 'fixed';
        } else {
          document.body.style.backgroundSize = 'auto';
          document.body.style.backgroundRepeat = 'repeat';
          document.body.style.backgroundPosition = 'top left';
          document.body.style.backgroundAttachment = 'scroll';
        }
      } else if (backgroundColor) {
        document.body.style.backgroundImage = gradient;
        document.body.style.backgroundColor = backgroundColor;
        document.body.style.backgroundSize = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundAttachment = '';
      } else {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundColor = customThemeIsDark ? '#09090b' : '#ffffff';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundAttachment = '';
      }
    }
  }, [primaryColor, backgroundImage, backgroundColor, backgroundStyle, backgroundOverlay, overlayColor, isDarkMode, customThemeIsDark]);

  useEffect(() => {
    // The listener that finishes a start which could not read the profile from the server (below).
    let postponed: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Whatever an earlier sign-in was still waiting for is not this account's business.
      postponed?.();
      postponed = null;
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          
          // Fetch existing user data to apply preferences
          // Its own try/catch: this sat in one big try with the lastLogin write and the profiles
          // mirror, so a rejected preference read cancelled both — and `setUser` runs regardless,
          // leaving a fully signed-in app on default colours with nothing said. The theme lives
          // only in memory (the store persists just the language), so it really is lost.
          const userDocSnap = await getDoc(userDocRef).catch((err) => {
            reportError(err instanceof Error ? err.message : String(err), { context: 'App.authBootstrap.userDoc' });
            return null;
          });
          if (userDocSnap?.exists()) {
            const data = userDocSnap.data();
            // Unconditional, and BEFORE the theme gate. This is the only path from Firestore into
            // the store, and it used to sit inside `if (data.primaryColor || data.isDarkMode !==
            // undefined)` — a condition most accounts never satisfy, because both signup paths
            // write `theme: { primaryColor, isDarkMode }` NESTED and choosing a language in
            // Settings writes neither top-level field. Once the language is also remembered in
            // localStorage, that gate turned a stale preference into one account inheriting the
            // previous account's language on a shared device.
            // Everything that is NOT the accent colour, restored unconditionally.
            //
            // All of this used to live inside the `if` below, and that condition is false for every
            // account created through signup: Login.tsx writes `theme: { primaryColor, isDarkMode }`
            // NESTED, and nothing has ever read that shape, so neither top-level field exists. Those
            // accounts silently lost their sound, haptics, background AND time zone on every single
            // sign-in — including the time-zone hydration added earlier today, which was sitting in
            // the dead branch. Sound has nothing to do with having picked a colour; it should never
            // have been gated on one.
            setAdvancedTheme({
              language: data.language || 'en-US',
              backgroundImage: data.backgroundImage || null,
              backgroundColor: data.backgroundColor || null,
              backgroundStyle: data.backgroundStyle || 'stretch',
              backgroundOverlay: data.backgroundOverlay ?? 50,
              overlayColor: data.overlayColor || null,
              // The device's own zone is the only honest default; Settings can change it.
              timezone: data.timezone || localZone(),
              customThemeIsDark: data.customThemeIsDark ?? true,
              soundEnabled: data.soundEnabled ?? true,
              hapticsEnabled: data.hapticsEnabled ?? true,
            });

            // The accent colour still needs one, because there is no honest default to restore.
            //
            // The nested `theme.primaryColor` that signup writes is deliberately NOT adopted here:
            // it holds a hex string ('#3b82f6') while this value is assigned straight to the
            // `--primary` custom property, which Tailwind consumes as `hsl(var(--primary))`. Feeding
            // it a hex would produce `hsl(#3b82f6)` and break the accent everywhere. That field is
            // dead weight in the wrong format, and Login no longer writes it.
            if (data.primaryColor || data.isDarkMode !== undefined) {
              setTheme(
                data.primaryColor || '221.2 83.2% 53.3%',
                data.isDarkMode !== undefined ? data.isDarkMode === true : true
              );
            }
          }

          // What this start writes about the account: decided in utils/bootstrapWrites.ts. Only the
          // SERVER's answer may say what the account lacks — a failed read, or a cache that may be
          // older than a change made elsewhere, used to write the old Auth name, the device's zone, an
          // empty familyMembers and a public profile with no photo or birthday over the real ones once
          // the network came back (reproduced on the real App against the emulators, DEVLOG 04.10).
          const detected = localZone();
          const zone = isValidZone(detected) ? detected : null;
          const profileRead = profileReadOf(userDocSnap);
          const plan = bootstrapPlan(
            profileRead,
            { email: currentUser.email, displayName: currentUser.displayName },
            new Date().toISOString(),
            // Validated with the SAME predicate the server uses — eventTime.ts is kept byte-identical
            // on both sides — so a stored zone is never one `sendDueReminders` rejects for UTC.
            zone,
          );
          // ── NOT awaited, and that is the fix ────────────────────────────────────────
          //
          // A Firestore write resolves on SERVER acknowledgement. With IndexedDB persistence on
          // (firebase.ts), an offline write applies to the local cache immediately and its promise
          // simply never settles — there is no error, no timeout, nothing to catch. Awaiting it
          // here held `setLoading(false)` for ever, so opening the app with no connection showed
          // the loading spinner and nothing else, on top of a complete local cache that could have
          // rendered the whole calendar.
          //
          // Nothing below reads what these writes produce: they are bookkeeping — a lastLogin
          // stamp, the public mirror, an empty array. So they are started and left to finish
          // whenever the network returns, which is exactly what the offline queue is for.
          void setDoc(userDocRef, plan.userUpdate, { merge: true })
            .catch((e) => reportError(e instanceof Error ? e.message : String(e), { context: 'App.profileUpdate' }));

          // The public `profiles` mirror (name, photo, birthday for the other members), and an empty
          // `familyMembers` for an account without the field — only from the server's document: from
          // anything less the mirror would publish nulls or an older photo, and the list would be
          // emptied over one the read could not see.
          const writeDerived = (mirror: MirrorFields | null, initFamilyMembers: boolean) => {
            if (mirror) {
              void setDoc(doc(db, 'profiles', currentUser.uid), mirror, { merge: true })
                .catch((e) => console.error('Failed to sync profile:', e));
            }
            if (initFamilyMembers) {
              void updateDoc(userDocRef, { familyMembers: [] }).catch(() => {});
            }
          };
          writeDerived(plan.mirror, plan.initFamilyMembers);

          // Postponed, not dropped (review 04.10): without the server's answer now, what the account
          // lacks is decided at the first answer the server confirms in this session — a brand-new
          // account whose first read missed the server still gets its zone, name and mirror.
          if (profileRead.kind !== 'server') {
            let finished = false;
            let stopLater: (() => void) | null = null;
            const finish = () => {
              finished = true;
              stopLater?.();
              stopLater = null;
              if (postponed === finish) postponed = null;
            };
            stopLater = liveDoc<Record<string, unknown>>(userDocRef, 'App.authBootstrap.later',
              (data, meta) => {
                if (finished) return;
                const later = profileReadOf({ exists: () => data !== null, data: () => data ?? undefined, metadata: meta });
                if (later.kind !== 'server') return;
                finish();
                if (auth.currentUser?.uid !== currentUser.uid) return;
                const rest = laterWrites(bootstrapPlan(
                  later,
                  { email: currentUser.email, displayName: currentUser.displayName },
                  new Date().toISOString(),
                  zone,
                ));
                if (Object.keys(rest.userFields).length) {
                  void setDoc(userDocRef, rest.userFields, { merge: true })
                    .catch((e) => reportError(e instanceof Error ? e.message : String(e), { context: 'App.profileUpdate' }));
                }
                writeDerived(rest.mirror, rest.initFamilyMembers);
              },
              () => finish(),
              { includeMetadataChanges: true });
            if (finished) { stopLater?.(); stopLater = null; } else postponed = finish;
          }
        } catch (error) {
          reportError(error instanceof Error ? error.message : String(error), { context: 'App.userDocSetup' });
          console.error("Failed to update user doc:", error);
        }
        
        setUser(currentUser);

        // Initialize Push Notifications if running natively
        if (Capacitor.isNativePlatform()) {
          // Detached for the same reason as the writes above: this waits on a person tapping a
          // system permission dialog, and the app has no business holding its loading screen for
          // that. Push registration is not a precondition for showing a calendar.
          void (async () => {
          try {
            // Listeners cleared and attached BEFORE register() fires the event — see nativePush.ts.
            await registerNativePush(PushNotifications, async (token) => {
              // Store native FCM tokens in the `fcmTokens` array (matching the
              // web path in CalendarHome.tsx and what the Cloud Functions read),
              // so remote push reaches Android devices.
              //
              // The try/catch is not decoration: this callback runs later, on its own stack, so
              // the enclosing try never sees it. Without this, a device that silently never
              // receives a notification again leaves no trace anywhere.
              try {
                await updateDoc(doc(db, 'users', currentUser.uid), {
                  fcmTokens: arrayUnion(token)
                });
                rememberPushToken(currentUser.uid, token);
              } catch (err) {
                reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.token' });
              }
            });
          } catch (e) {
            reportError(e instanceof Error ? e.message : String(e), { context: 'App.pushSetup' });
            console.error("Push notification setup failed:", e);
          }
          })();
        }
      } else {
        // The store is module-scope and signing out is an SPA navigate, not a reload, so without
        // this the previous account's colours, background PHOTO, sound and haptics are still on
        // screen for whoever signs in next on this device.
        resetTheme();
        // Nor may the previous account's cards stay readable on the offline page. The sync is stopped
        // FIRST: at sign-out the SDK re-emits the old account's documents, and one of them landing
        // after the forget used to write the copy back (review, 28.09.2026).
        stopOfflineWalletSync();
        forgetOfflineWallet();
        setUser(null);
      }
      setLoading(false);
    });
    return () => {
      postponed?.();
      unsubscribe();
    };
  }, []);

  // Fetch the lazy screens once somebody is signed in and the browser is idle. While online, so a
  // first visit to Wallet later — offline, or after a deploy has replaced the chunk — still works:
  // the module is already in memory. Above the `if (loading)` return, like every hook here.
  useEffect(() => {
    if (!user) return;
    const warm = () => { void warmRoutes([loadWallet, loadChat, loadSettings]); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (ric && cic) {
      const id = ric(warm, { timeout: 5000 });
      return () => cic(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, [user]);

  // Keep the offline card copy in step with the server while the app is open, on any screen
  // (utils/offlineWalletSync.ts). Started when the browser is idle, like the warm-up above. A plain
  // function, not a component: a fault in it cannot reach the ErrorBoundary below. The kill switch
  // (VITE_OFFLINE_CARDS=0 at build) stops it and removes any copy already on the device.
  useEffect(() => {
    if (!offlineCardsEnabled()) { forgetOfflineWallet(); return; }
    if (!user) return;
    // Another account's copy on this device (an account switch, or a build that did not know the
    // copy): gone at once, before the sync has had a chance to answer — the offline page reads it
    // with no sign-in at all.
    const held = readOfflineWallet();
    if (held && held.uid !== user.uid) forgetOfflineWallet();
    let stop: (() => void) | null = null;
    const start = () => {
      try { stop = startOfflineWalletSync(user.uid); } catch (err) {
        reportError(err instanceof Error ? err.message : String(err), { context: 'OfflineWallet.start' });
      }
    };
    const idle = typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function';
    const id = idle ? window.requestIdleCallback(start, { timeout: 5000 }) : window.setTimeout(start, 2000);
    return () => {
      if (idle) window.cancelIdleCallback(id); else window.clearTimeout(id);
      stop?.();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-transparent">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Where to land after signing in. Normally the calendar — but somebody who arrived through
  // an invitation link and signed up to accept it should come back to the invitation, not to an
  // empty calendar with no sign that anything happened.
  //
  // Reads WITHOUT consuming: React can render a <Navigate> more than once, and a code taken on
  // the first render would send the second one to the calendar instead. JoinInvite clears it.
  const pendingJoinPath = () => {
    const code = peekPendingInvite();
    return code ? `/join/${encodeURIComponent(code)}` : '/';
  };

  return (
    <ErrorBoundary>
    {/* Outside the router on purpose: a build going stale is not a property of any one route. */}
    <NewVersionNotice />
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to={pendingJoinPath()} />}
        />
        {/*
          The ONE route that renders signed out.
          A link invitation is opened by somebody who may have no account at all — sending them
          to a login form with no explanation is how an invitation gets closed unread. The screen
          says who invited them and to what first, using a callable that runs unauthenticated,
          and asks for an account second.
        */}
        <Route path="/join/:code" element={<JoinInvite />} />
        <Route 
          path="/" 
          element={user ? <CalendarHome /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/wallet" 
          element={user ? <Suspense fallback={<RouteFallback />}><Wallet /></Suspense> : <Navigate to="/login" />} 
        />

        <Route
          path="/settings"
          element={user ? <Suspense fallback={<RouteFallback />}><Settings /></Suspense> : <Navigate to="/login" />}
        />
        <Route
          path="/friends"
          element={user ? <Friends /> : <Navigate to="/login" />}
        />
        <Route
          path="/chat"
          element={user ? <Suspense fallback={<RouteFallback />}><Chat /></Suspense> : <Navigate to="/login" />}
        />
        <Route
          path="/admin"
          element={user ? <Suspense fallback={null}><Admin /></Suspense> : <Navigate to="/login" />}
        />
        <Route
          path="/log"
          element={user ? <Suspense fallback={null}><PeriodLog /></Suspense> : <Navigate to="/login" />}
        />
        <Route
          path="/warlord"
          element={user ? <Suspense fallback={null}><Warlord /></Suspense> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
