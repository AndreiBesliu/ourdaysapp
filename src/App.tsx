import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, setDoc, updateDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { auth, db } from './firebase';
import { publicMirrorFor } from './utils/publicProfile';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

// Components
import Login from './screens/Login';
import CalendarHome from './screens/CalendarHome';
import Wallet from './screens/Wallet';
import Settings from './screens/Settings';
import Friends from './screens/Friends';
import JoinInvite, { peekPendingInvite } from './screens/JoinInvite';
import Chat from './screens/Chat';
import ErrorBoundary from './components/ErrorBoundary';
import NewVersionNotice from './components/NewVersionNotice';
import { installGlobalErrorHandlers, reportError } from './reportError';
const Admin = lazy(() => import('./screens/Admin')); // owner-only, rarely used → lazy

installGlobalErrorHandlers();
const Warlord = lazy(() => import('./screens/Warlord')); // large embedded game → lazy chunk
const PeriodLog = lazy(() => import('./screens/PeriodLog'));
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
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
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

          // Save user to DB if not exists. Backfill `name` from the Firebase
          // Auth displayName when the Firestore doc has none, so member lists
          // and birthday titles show the real name instead of the email prefix.
          const profileUpdate: {
            email: string | null; lastLogin: string; name?: string; timezone?: string;
          } = {
            email: currentUser.email,
            lastLogin: new Date().toISOString(),
          };
          if (!userDocSnap?.data()?.name && currentUser.displayName) {
            profileUpdate.name = currentUser.displayName;
          }
          // Backfill the zone ONCE, when the account has none.
          //
          // The store has always had one — line ~184 falls back to the device's zone — but it never
          // reached Firestore unless somebody opened Settings and changed the picker, and nobody
          // had. That left `sendDueReminders` with a dead middle link in its chain: event zone →
          // OWNER's zone → "UTC". So a reminder on any event without its own zone, including every
          // all-day one, resolved at 09:00 UTC — three hours late in Bucharest, silently, on the
          // reminder that fires before you leave the house.
          //
          // Only when absent: an explicit choice in Settings is a statement about where you are,
          // and overwriting it from the browser on every login would make that picker decorative.
          if (!userDocSnap?.data()?.timezone) {
            // Validated with the SAME predicate the server uses — eventTime.ts is kept
            // byte-identical on both sides, and a test refuses divergence — so a zone stored here
            // cannot be one `sendDueReminders` will reject and quietly replace with UTC.
            const detected = localZone();
            if (isValidZone(detected)) profileUpdate.timezone = detected;
          }
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
          void setDoc(userDocRef, profileUpdate, { merge: true })
            .catch((e) => reportError(e instanceof Error ? e.message : String(e), { context: 'App.profileUpdate' }));

          // Mirror non-sensitive fields to the public `profiles` collection so
          // other group members can render this user's name/photo/birthday
          // without reading the (owner-only) user doc. Self-populates on login.
          const src: any = { ...(userDocSnap?.data() || {}), ...profileUpdate };
          // The mirror does not INVENT a name.
          //
          // It used to fall back to the e-mail prefix, and on a brand-new account it always
          // reached that fallback: this handler reads `users/{uid}` before Login has written
          // it, and never re-reads. So everybody ELSE saw “besliandrei” instead of the name
          // typed on the form — the new account’s own screens read the user doc and looked
          // right, which is why nobody reported it. Worse, the server reads
          // `profiles.name || users.name`, so the invented one OUTRANKED the real one, and a
          // friendship formed during that first session copied it into the other person’s list.
          //
          // Omitting the key on a merge leaves whatever is there, so the order of the two
          // writes stops mattering. A profile with no name still renders: the readers fall
          // back per viewer, which is transient, rather than persisting a guess.
          void setDoc(
            doc(db, 'profiles', currentUser.uid),
            publicMirrorFor(src, currentUser.displayName),
            { merge: true },
          ).catch((e) => console.error('Failed to sync profile:', e));
          
          // If the document was just created, it won't have familyMembers, 
          // but we can initialize it if it's completely missing
          if (!userDocSnap?.exists() || !userDocSnap.data()?.familyMembers) {
            void updateDoc(userDocRef, { familyMembers: [] }).catch(() => {});
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
            const permStatus = await PushNotifications.requestPermissions();
            if (permStatus.receive === 'granted') {
              await PushNotifications.register();
              
              PushNotifications.addListener('registration', async (token) => {
                // Store native FCM tokens in the `fcmTokens` array (matching the
                // web path in CalendarHome.tsx and what the Cloud Functions read),
                // so remote push reaches Android devices.
                //
                // The try/catch is not decoration: this callback runs later, on its own stack, so
                // the enclosing try around addListener never sees it. Without this, a device that
                // silently never receives a notification again leaves no trace anywhere.
                try {
                  await updateDoc(doc(db, 'users', currentUser.uid), {
                    fcmTokens: arrayUnion(token.value)
                  });
                } catch (err) {
                  reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.token' });
                }
              });

              PushNotifications.addListener('pushNotificationReceived', (notification) => {
                console.log('Push received: ', notification);
              });
            }
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
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
          element={user ? <Wallet /> : <Navigate to="/login" />} 
        />

        <Route
          path="/settings"
          element={user ? <Settings /> : <Navigate to="/login" />}
        />
        <Route
          path="/friends"
          element={user ? <Friends /> : <Navigate to="/login" />}
        />
        <Route
          path="/chat"
          element={user ? <Chat /> : <Navigate to="/login" />}
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
