import { useState, useEffect, useRef, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { auth, db, messaging } from '../firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { collection, query, doc, updateDoc, where, arrayUnion, getDoc } from 'firebase/firestore';
import { liveQuery, liveDoc } from '../utils/liveQuery';
import { eventsForTab, pendingInvitesFor } from '../utils/eventScope';
import { reportError } from '../reportError';
import { vapidKeyProblem } from '../utils/webPush';
import { Calendar as CalendarIcon, Users, User, Settings, Plus, Bell, Check, X, Wallet, UserPlus, Clock, CheckCircle2, Circle, Briefcase, Heart, Wrench, Star, Gamepad2, ShoppingCart, RefreshCw, Repeat, Menu, ShieldCheck, Swords, ClipboardList, MessageCircle } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import CalendarGrid from '../components/CalendarGrid';
import DayTimeline from '../components/DayTimeline';
import AddEventModal from '../components/AddEventModal';
import EventDetailsModal from '../components/EventDetailsModal';
import InviteFamilyModal from '../components/InviteFamilyModal';
import CreateGroupModal from '../components/CreateGroupModal';
import LeaveGroupModal from '../components/LeaveGroupModal';
import GroupSettingsModal from '../components/GroupSettingsModal';
import NotificationsDropdown from '../components/NotificationsDropdown';
import VerifyEmailBanner from '../components/VerifyEmailBanner';
import { useVerifiedEmail } from '../hooks/useVerifiedEmail';
import GroupChatWidget from '../components/GroupChatWidget';
import GamesHubModal from '../components/games/GamesHubModal';
import RecurringEventsPanel from '../components/RecurringEventsPanel';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store';
import { t, getDateLocale } from '../utils/i18n';
import { expandRecurringEvents } from '../utils/recurrence';
import { acceptGroupInvite, ADMIN_BOOTSTRAP_EMAILS } from '../serverActions';
import { displayTime, localZone, occursOn, localDayKey } from '../utils/eventTime';
import { eventColorClass } from '../utils/eventColors';
import { useDialog } from '../hooks/useDialog';
import { useMenu } from '../hooks/useMenu';

export default function CalendarHome() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | 'personal'>('personal');
  const [groups, setGroups] = useState<any[]>([]);
  const [groupsLoadError, setGroupsLoadError] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [isLeaveGroupModalOpen, setIsLeaveGroupModalOpen] = useState(false);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [eventToEdit, setEventToEdit] = useState<any | null>(null);
  const [initialTemplate, setInitialTemplate] = useState<any | null>(null);
  // Everything the three listeners can see, BEFORE it is narrowed to the tab on screen.
  // Which tab an event belongs on is decided in one place: src/utils/eventScope.ts.
  const [allEvents, setAllEvents] = useState<any[]>([]);
  // A calendar that could not be READ must not look like a calendar with nothing in it.
  const [eventsLoadError, setEventsLoadError] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [pendingFamilyInvites, setPendingFamilyInvites] = useState<any[]>([]);
  // The address the RULES will accept for an email-addressed invitation, which is the token
  // claim and not the user record. Null while it is unknown or unproved.
  const { email: verifiedEmail } = useVerifiedEmail();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [overviewModalType, setOverviewModalType] = useState<'total' | 'pending' | 'completed' | null>(null);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(false);
  const [userMap, setUserMap] = useState<Record<string, any>>({});
  const [activeGames, setActiveGames] = useState<any[]>([]);
  const [isFabExpanded, setIsFabExpanded] = useState(false);
  const [isRecurringPanelOpen, setIsRecurringPanelOpen] = useState(false);
  const [pendingFriendCount, setPendingFriendCount] = useState(0);
  const navigate = useNavigate();
  const { language, timezone } = useThemeStore();

  // Placed after `language`, not beside the state it reads: the label needs the language,
  // and a const is not in scope above its own declaration.
  const overviewDialog = useDialog(overviewModalType !== null, () => setOverviewModalType(null), {
    label: overviewModalType === 'total' ? t('todaysEventsTasks', language)
      : overviewModalType === 'pending' ? t('pendingTasksToday', language)
      : overviewModalType === 'completed' ? t('completedTasksToday', language)
      : undefined,
  });
  // Two menus, same reason they are here and not beside their state: both want a translated label.
  const mobileMenu = useMenu(isMobileMenuOpen, () => setIsMobileMenuOpen(false), {
    label: t('menuLabel', language),
  });
  const fabMenu = useMenu(isFabExpanded, () => setIsFabExpanded(false), {
    label: t('quickAddLabel', language),
  });
  const dateLocale = getDateLocale(language);
  // Cosmetic gate for the Admin entry (the /admin screen + callables re-check server-side).
  const isAdminEmail = ADMIN_BOOTSTRAP_EMAILS.includes((auth.currentUser?.email || '').toLowerCase());

  // Pull to refresh states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current > 0) {
      const y = e.touches[0].clientY;
      const dist = y - startY.current;
      if (dist > 0 && dist < 150) {
        setPullDistance(dist);
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setIsRefreshing(true);
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      
      // Simulate refresh of data
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }, 1000);
    } else {
      setPullDistance(0);
    }
    startY.current = 0;
  };

  // Listen to user's groups and build userMap
  useEffect(() => {
    if (!auth.currentUser) return;
    
    // Legacy support for familyMembers just in case
    let legacyFamily: string[] = [];
    const unsubUser = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'CalendarHome.userDoc',
      (data) => { if (data) legacyFamily = data.familyMembers || []; },
      // Legacy-only enrichment: losing it costs a few avatars, not the calendar. Reported anyway,
      // because a failing read of your OWN document usually means something bigger is wrong.
      () => {});

    const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', auth.currentUser.uid));
    const unsubscribeGroups = liveQuery<any>(qGroups, 'CalendarHome.groups', async (fetchedGroups) => {
      setGroupsLoadError(false);
      setGroups(fetchedGroups);
      
      const map: Record<string, any> = {};
      // Seed current user from auth first, then enrich with Firestore doc (which has photoURL)
      map[auth.currentUser!.uid] = { id: auth.currentUser!.uid, email: auth.currentUser!.email, name: auth.currentUser!.displayName || 'Me' };
      
      const memberIds = new Set<string>([auth.currentUser!.uid, ...legacyFamily]);
      fetchedGroups.forEach((g: any) => g.members?.forEach((id: string) => memberIds.add(id)));
      
      // Each read is guarded on its own, and the map is published in a `finally`.
      //
      // This loop runs inside liveQuery's async callback, which nothing awaits — so before, one
      // rejected getDoc escaped as an unhandled rejection, `setUserMap` never ran, and everything
      // already read (including the caller's own entry, seeded above) was discarded. The groups
      // state had already been set by then, so the screen looked healthy while every avatar, every
      // member name and every birthday vanished.
      try {
        for (const id of Array.from(memberIds)) {
          try {
            if (id === auth.currentUser!.uid) {
              // Own doc: read the full (owner-only) user doc — needed for birthday,
              // photoURL, hideBirthdayPrompt, etc.
              const userDoc = await getDoc(doc(db, 'users', id));
              if (userDoc.exists()) map[id] = { id, ...userDoc.data() };
            } else {
              // Other members: read the public profile (name/photoURL/birthday) so
              // we don't depend on the (soon owner-only) users collection.
              const profileDoc = await getDoc(doc(db, 'profiles', id));
              if (profileDoc.exists()) map[id] = { id, ...profileDoc.data() };
            }
          } catch (err) {
            // One member we could not read costs that member's avatar, not the whole screen.
            reportError(err instanceof Error ? err.message : String(err), { context: 'CalendarHome.memberProfile' });
          }
        }
      } finally {
        setUserMap(map);
      }
    },
    // Your groups failing to load is the loudest possible failure on this screen: every shared
    // calendar, every member avatar and the group switcher all go quiet at once, and the app
    // looks exactly like a brand-new account. It says so instead.
    () => setGroupsLoadError(true));
    
    return () => {
      unsubUser();
      unsubscribeGroups();
    };
  }, []);

  // Listen to active games for the group today
  useEffect(() => {
    if (activeGroupId === 'personal' || !selectedDate) {
      setActiveGames([]);
      return;
    }

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const q = query(
      collection(db, 'games'),
      where('groupId', '==', activeGroupId),
      where('date', '==', dateStr)
    );

    const unsubscribe = liveQuery<any>(q, 'CalendarHome.activeGames', (games) => {
      const active = games.filter((g: any) => g.status === 'playing' || g.status === 'waiting');
      setActiveGames(active);
    }, () => setActiveGames([]));

    return () => unsubscribe();
  }, [activeGroupId, selectedDate]);

  // Listen to incoming group invites.
  //
  // Only for an address this account has PROVED. Since 20.09 the rules honour the `toEmail`
  // branch only for a verified address — and a LIST query is validated against the rule without
  // reading any document, so subscribing while unverified is not a shorter list, it is a refusal
  // for the whole listener, reported to the health panel on every mount. `VerifyEmailBanner`,
  // rendered further down this screen, is what tells the person why.
  useEffect(() => {
    if (!auth.currentUser || !verifiedEmail) { setPendingFamilyInvites([]); return; }
    const q = query(
      collection(db, 'group_invites'),
      where('toEmail', '==', verifiedEmail),
      where('status', '==', 'pending')
    );
    // Reported rather than swallowed: an invitation you were never shown is indistinguishable
    // from one that was never sent, and the person who invited you has no way to tell either.
    const unsubscribe = liveQuery<any>(q, 'CalendarHome.groupInvites',
      (docs) => setPendingFamilyInvites(docs),
      () => setPendingFamilyInvites([]));
    return () => unsubscribe();
  }, [verifiedEmail]);

  // Count incoming pending friend requests (by uid or email) for the menu badge.
  //
  // The uid half needs nothing: a uid cannot be spoofed, so it is never gated. Only the email
  // half waits for a verified address — see the invite listener above for why asking anyway is
  // worse than not asking.
  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    let byId = new Set<string>();
    let byEmail = new Set<string>();
    const update = () => setPendingFriendCount(new Set([...byId, ...byEmail]).size);
    const qId = query(collection(db, 'friend_requests'), where('toId', '==', uid), where('status', '==', 'pending'));
    const unsubId = liveQuery<any>(qId, 'CalendarHome.pendingById',
      (docs) => { byId = new Set(docs.map((d) => d.id)); update(); }, () => {});
    let unsubEmail = () => {};
    if (verifiedEmail) {
      const qEmail = query(collection(db, 'friend_requests'), where('toEmail', '==', verifiedEmail), where('status', '==', 'pending'));
      unsubEmail = liveQuery<any>(qEmail, 'CalendarHome.pendingByEmail',
        (docs) => { byEmail = new Set(docs.map((d) => d.id)); update(); }, () => {});
    }
    return () => { unsubId(); unsubEmail(); };
  }, [verifiedEmail]);

  // Request notification permissions and save FCM token
  useEffect(() => {
    if (!auth.currentUser || !messaging) return;

    const requestPermission = async () => {
      // This registration had been failing on every browser, for every account, since May. The key
      // below used to be a hard-coded 44-character string where a Web Push application server key
      // must be 87 — so `subscribe()` rejected every time, the `updateDoc` never ran, and
      // `users/{uid}.fcmTokens` was never written on a single one of the eight accounts. Every push
      // the app has ever tried to send skipped every recipient for want of a token, including the
      // reminders whose entire purpose is to reach a phone.
      //
      // Nothing said so. The catch wrote to the console rather than the error log, and the browser
      // still showed the permission prompt, so even the user's own feedback said it had worked.
      const problem = vapidKeyProblem(import.meta.env.VITE_FIREBASE_VAPID_KEY);
      if (problem) {
        // Reported, never merely logged: a configuration fault that reaches only the console is a
        // fault nobody learns about, which is exactly how this survived four months.
        reportError(`Web push is not configured: ${problem}`, { context: 'fcm.token.web' });
        return;
      }

      try {
        // Asked AFTER the key is known good. Prompting first would burn the single chance to ask
        // somebody for notification permission on a registration that cannot succeed anyway.
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const token = await getToken(messaging!, {
            vapidKey: String(import.meta.env.VITE_FIREBASE_VAPID_KEY).trim(),
          });
          if (token) {
            await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
              fcmTokens: arrayUnion(token)
            });
          }
        }
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.token.web' });
      }
    };

    requestPermission();

    // A push that arrives while the app is in the FOREGROUND is not shown by the service worker;
    // it is handed to the page, and a page with no handler drops it on the floor. That is what
    // happened to the very first test: the broadcast was sent from inside the app.
    //
    // Shown through the FCM worker's registration when it can be found, so the notification is
    // owned by the same worker that shows background pushes. It is asked for by SCOPE: the SDK
    // registers firebase-messaging-sw.js under '/firebase-cloud-messaging-push-scope', while
    // `navigator.serviceWorker.ready` resolves to the PWA worker at '/' — a first draft used
    // `.ready` and claimed otherwise in this comment. (Review finding.) Any registration can show
    // a notification, so `.ready` remains the fallback.
    const stopForeground = onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title;
      if (!title) return;
      const body = payload.notification?.body || payload.data?.body || '';
      void (async () => {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
          const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
          const reg = sw
            ? (await sw.getRegistration('/firebase-cloud-messaging-push-scope')) || (await sw.ready)
            : null;
          // Same icon and the same collapsing `tag` the server puts on the background copy, so a
          // device holding two subscriptions shows one notification, not one per subscription.
          const tag = payload.data?.tag;
          const options: NotificationOptions = { body, icon: '/icons.svg', data: payload.data, ...(tag ? { tag } : {}) };
          if (reg) await reg.showNotification(title, options);
          else new Notification(title, options);
        } catch (err) {
          reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.foreground' });
        }
      })();
    });
    return stopForeground;
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const unsubs: (() => void)[] = [];

    // Accumulator: merge results from multiple queries, deduplicating by id
    const eventBuckets: Record<string, Record<string, any>> = { main: {}, assigned: {}, invited: {} };

    const mergeAndSet = () => {
      const merged = new Map<string, any>();
      Object.values(eventBuckets).forEach(bucket => {
        Object.values(bucket).forEach(ev => merged.set(ev.id, ev));
      });
      const rows = Array.from(merged.values());

      // Narrowing to the tab does NOT happen here. It happens once, in the memo below, because a
      // rule written inside a listener is a rule the other two listeners can forget — which is
      // exactly how this screen came to show one group's events under another group's name.
      setAllEvents(rows);
      setPendingInvites(pendingInvitesFor(rows, uid));

      setSelectedEvent((prev: any) => {
        if (!prev) return null;
        return rows.find((e: any) => e.id === prev.id) || prev;
      });
    };

    // ── Query 1: Main events (owner's own or group's) ──
    let mainQuery;
    if (activeGroupId === 'personal') {
      mainQuery = query(collection(db, 'events'), where('ownerId', '==', uid));
    } else {
      mainQuery = query(collection(db, 'events'), where('groupId', '==', activeGroupId));
    }
    // All three listeners report. A denied read here used to render as a calendar with no events
    // — the same shape as a calendar that genuinely has none — and nothing reached errorLogs,
    // because the SDK neither throws nor rejects when no error handler is given.
    unsubs.push(liveQuery<any>(mainQuery, 'CalendarHome.events.main', (docs) => {
      setEventsLoadError(false);
      eventBuckets.main = {};
      // No tab filtering here either — this listener used to be the only one that did any, which
      // is precisely why the other two leaked.
      docs.forEach(ev => { eventBuckets.main[ev.id] = ev; });
      mergeAndSet();
    }, () => setEventsLoadError(true)));

    // ── Query 2: Events assigned to me ──
    const assignedQuery = query(collection(db, 'events'), where('assigneeIds', 'array-contains', uid));
    unsubs.push(liveQuery<any>(assignedQuery, 'CalendarHome.events.assigned', (docs) => {
      eventBuckets.assigned = {};
      docs.forEach(ev => { eventBuckets.assigned[ev.id] = ev; });
      mergeAndSet();
    }, () => setEventsLoadError(true)));

    // ── Query 3: Events where I'm invited ──
    const invitedQuery = query(collection(db, 'events'), where('inviteeId', '==', uid));
    unsubs.push(liveQuery<any>(invitedQuery, 'CalendarHome.events.invited', (docs) => {
      eventBuckets.invited = {};
      docs.forEach(ev => { eventBuckets.invited[ev.id] = ev; });
      mergeAndSet();
    }, () => setEventsLoadError(true)));

    return () => unsubs.forEach(u => u());
  }, [activeGroupId]);

  // The one question asked of every row, whichever listener brought it: is this event filed on the
  // calendar currently in front of me? Andrei, 16.09.2026: "am niste evenimente din grupul de
  // familie in grupul de gym" — measured on live, the Gym tab was showing him nine foreign events
  // out of twelve, because two of the three listeners are scoped to the PERSON, not the tab.
  const events = useMemo(
    () => eventsForTab(allEvents, { uid: auth.currentUser?.uid || '', tab: activeGroupId }),
    [allEvents, activeGroupId],
  );

  // Reminders are sent by the server now — `functions/src/reminders.ts`, on a schedule.
  //
  // What used to be here scheduled them through `@capacitor/local-notifications`, which delivered
  // to nobody: the plugin is not in `android/app/capacitor.build.gradle` at all, and its web
  // implementation uses `setTimeout`, so a reminder only fired if this tab was still open at the
  // moment. Removed rather than left dormant — the day the plugin does reach an Android build,
  // every reminder would have arrived twice.

  // Bare awaits before: a rejection became an unhandled rejection with nothing on screen, and
  // the row you just answered simply sat there as though you had not.
  const respondToEventInvite = async (eventId: string, inviteStatus: 'accepted' | 'declined') => {
    try {
      await updateDoc(doc(db, 'events', eventId), { inviteStatus });
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'CalendarHome.eventInvite' });
      setInviteError(t('inviteResponseFailed', language));
    }
  };

  const handleAcceptInvite = (eventId: string) => respondToEventInvite(eventId, 'accepted');
  const handleDeclineInvite = (eventId: string) => respondToEventInvite(eventId, 'declined');

  const handleAcceptFamilyInvite = async (invite: any) => {
    if (!auth.currentUser) return;
    // Adding yourself to a group's members can't be a client write (the groups
    // rule requires existing membership), so acceptance runs server-side: the
    // acceptGroupInvite Cloud Function validates the invite and joins the group.
    try {
      await acceptGroupInvite(invite.id);
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'CalendarHome.acceptGroupInvite' });
      // The unverified-email hint is the LIKELIEST cause for an email-addressed invite, not the
      // only one. It used to be the only branch, so every other failure was invisible.
      setInviteError(
        !auth.currentUser.emailVerified
          ? t('verifyEmailDesc', language)
          : t('inviteResponseFailed', language),
      );
    }
  };

  const handleDeclineFamilyInvite = async (inviteId: string) => {
    try {
      await updateDoc(doc(db, 'group_invites', inviteId), { status: 'declined' });
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'CalendarHome.declineGroupInvite' });
      setInviteError(t('inviteResponseFailed', language));
    }
  };

  const handleDismissBirthdayPrompt = async () => {
    if (!auth.currentUser) return;
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { hideBirthdayPrompt: true });
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'CalendarHome.handleDismissBirthdayPrompt' });
      console.error(err);
    }
  };

  const birthdayEvents = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const bEvents: any[] = [];
    
    let usersToShow: any[] = [];
    if (activeGroupId === 'personal') {
      if (auth.currentUser && userMap[auth.currentUser.uid]) {
        usersToShow.push(userMap[auth.currentUser.uid]);
      }
    } else {
      const group = groups.find(g => g.id === activeGroupId);
      if (group && group.members) {
        usersToShow = group.members.map((id: string) => userMap[id]).filter(Boolean);
      }
    }

    usersToShow.forEach(u => {
      if (u.birthday) {
        const [, month, day] = u.birthday.split('-');
        bEvents.push({
          id: `virtual-birthday-${u.id}`,
          title: `${u.name || u.email?.split('@')[0] || t('personFallback', language)} — ${t('birthday', language)} 🎂`,
          date: `${currentYear}-${month}-${day}`,
          categoryId: 'important',
          color: 'rose',
          isTask: false,
          readOnly: true,
          ownerId: u.id,
          assigneeIds: [u.id],
          groupId: activeGroupId === 'personal' ? null : activeGroupId
        });
      }
    });
    return bEvents;
  }, [userMap, activeGroupId, groups, language]);

  const allCalendarEvents = useMemo(() => {
    // Build a 3-month window around currentDate for recurrence expansion
    const windowStart = subMonths(startOfMonth(currentDate), 1);
    const windowEnd = addMonths(endOfMonth(currentDate), 2);
    const expanded = expandRecurringEvents(events, windowStart, windowEnd);
    return [...expanded, ...birthdayEvents];
  }, [events, birthdayEvents, currentDate]);

  return (
    <div className="min-h-screen bg-transparent flex flex-col relative pt-[60px]">
      {inviteError && (
        <p role="alert" className="mx-4 mb-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
          {inviteError}
        </p>
      )}
      {groupsLoadError && (
        <p role="alert" className="mx-4 mb-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
          {t('groupsLoadFailed', language)}
        </p>
      )}
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
       <div className="max-w-5xl w-full mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary">
          <CalendarIcon className="w-6 h-6" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Our Days</h1>
        </div>

        <div className="flex items-center gap-1 sm:gap-4">
          <NotificationsDropdown />

          <button
            onClick={() => navigate('/friends')}
            className="hidden sm:flex relative p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-full transition-colors"
            title={t('friendsMenuLabel', language)}
          >
            <Users className="w-5 h-5" />
            {pendingFriendCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{pendingFriendCount}</span>
            )}
          </button>
          <button
            onClick={() => setIsRecurringPanelOpen(true)}
            className="hidden sm:flex p-2 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-full transition-colors"
            title={t('recurringEvents', language)}
            aria-label={t('recurringEvents', language)}
          >
            <Repeat className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate('/log')}
            className="hidden sm:flex p-2 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-full transition-colors"
            title={t('logTitle', language)}
            aria-label={t('logTitle', language)}
          >
            <ClipboardList className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate('/chat')}
            title={t('chatTab', language)}
            aria-label={t('chatTab', language)}
            className="p-2 text-zinc-500 hover:text-primary transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
          </button>
          <button 
            onClick={() => navigate('/wallet')}
            className="hidden sm:flex p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-full transition-colors"
            title={t('assetsTitle', language)}
            aria-label={t('assetsTitle', language)}
          >
            <Wallet className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="hidden sm:flex p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label={t('settings', language)}
          >
            <Settings className="w-5 h-5" />
          </button>
          {isAdminEmail && (
            <button
              onClick={() => navigate('/admin')}
              className="hidden sm:flex p-2 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-full transition-colors"
              title="Admin"
              aria-label="Admin"
            >
              <ShieldCheck className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => navigate('/warlord')}
            className="hidden sm:flex p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-full transition-colors"
            title="Warlord"
            aria-label="Warlord"
          >
            <Swords className="w-5 h-5" />
          </button>

          {/* Mobile Menu */}
          <div className="sm:hidden relative">
            <button
              ref={mobileMenu.triggerRef}
              {...mobileMenu.triggerProps}
              aria-label={t('menuLabel', language)}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {isMobileMenuOpen && (
              <div ref={mobileMenu.menuRef} {...mobileMenu.menuProps} className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg flex flex-col py-2 animate-in fade-in slide-in-from-top-2 origin-top-right z-[110] outline-none">
                <button
                  onClick={() => { navigate('/friends'); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-blue-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <Users className="w-4 h-4" /> {t('friendsMenuLabel', language)}
                  {pendingFriendCount > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pendingFriendCount}</span>
                  )}
                </button>
                <button
                  onClick={() => { setIsRecurringPanelOpen(true); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-indigo-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <Repeat className="w-4 h-4" /> {t('recurring', language)}
                </button>
                <button
                  onClick={() => { navigate('/log'); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-indigo-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <ClipboardList className="w-4 h-4" /> {t('logTitle', language)}
                </button>
                <button 
                  onClick={() => { navigate('/wallet'); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-emerald-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <Wallet className="w-4 h-4" /> {t('assetsTitle', language)}
                </button>
                <button
                  onClick={() => { navigate('/settings'); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <Settings className="w-4 h-4" /> {t('settings', language)}
                </button>
                {isAdminEmail && (
                  <button
                    onClick={() => { navigate('/admin'); setIsMobileMenuOpen(false); }}
                    role="menuitem"
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-amber-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                  >
                    <ShieldCheck className="w-4 h-4" /> Admin
                  </button>
                )}
                <button
                  onClick={() => { navigate('/warlord'); setIsMobileMenuOpen(false); }}
                  role="menuitem"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-rose-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
                >
                  <Swords className="w-4 h-4" /> Warlord
                </button>
              </div>
            )}
          </div>
        </div>
       </div>
      </header>

      {/* Main Content */}
      <main 
        className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-6 pb-24 transition-all relative"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateY(${pullDistance * 0.4}px)` }}
      >
        {/* Pull to refresh indicator */}
        {(pullDistance > 0 || isRefreshing) && (
          <div className="absolute top-[-20px] left-0 w-full flex justify-center z-10">
             <div className="w-8 h-8 rounded-full bg-white dark:bg-zinc-800 shadow-md flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                <RefreshCw className={`w-4 h-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} style={{ transform: `rotate(${pullDistance * 2}deg)` }} />
             </div>
          </div>
        )}
        
        {/* Email verification prompt (email/password users only) */}
        <VerifyEmailBanner />

        {/* Birthday Prompt */}
        {auth.currentUser && userMap[auth.currentUser.uid] && !userMap[auth.currentUser.uid].birthday && !userMap[auth.currentUser.uid].hideBirthdayPrompt && (
          <div className="bg-gradient-to-r from-pink-500/10 to-rose-500/10 border border-pink-500/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-top-4 fade-in mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-pink-500/20 text-pink-600 dark:text-pink-400 rounded-lg shrink-0">
                <span className="text-xl">🎂</span>
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{t('addYourBirthday', language)}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('addBirthdayPromptDesc', language)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate('/settings')}
                className="flex-1 sm:flex-none px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {t('setBirthday', language)}
              </button>
              <button 
                onClick={handleDismissBirthdayPrompt}
                aria-label={t('dismissAction', language)}
                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
        
        {/* Today's Overview Dashboard */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{t('todayOverview', language)}</h2>
              <p className="text-sm text-zinc-500">{t('agendaDesc', language)}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm font-semibold text-primary">{format(new Date(), 'EEEE', { locale: dateLocale })}</p>
              <p className="text-xs text-zinc-500">{format(new Date(), 'MMMM d, yyyy', { locale: dateLocale })}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            <div 
              onClick={() => setOverviewModalType('total')}
              className="bg-primary/5 border border-primary/20 rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer hover:bg-primary/10 transition-colors text-center"
            >
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5 leading-tight">{t('totalEvents', language)}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {allCalendarEvents.filter(ev => occursOn(ev, localDayKey(new Date()))).length}
              </p>
            </div>
            <div 
              onClick={() => setOverviewModalType('pending')}
              className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer hover:bg-amber-500/10 transition-colors text-center"
            >
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-0.5 leading-tight">{t('tasksPending', language)}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {allCalendarEvents.filter(ev => occursOn(ev, localDayKey(new Date())) && ev.isTask && ev.taskStatus !== 'completed').length}
              </p>
            </div>
            <div 
              onClick={() => setOverviewModalType('completed')}
              className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-500/10 transition-colors text-center"
            >
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-0.5 leading-tight">{t('tasksCompleted', language)}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {allCalendarEvents.filter(ev => occursOn(ev, localDayKey(new Date())) && ev.isTask && ev.taskStatus === 'completed').length}
              </p>
            </div>
          </div>
        </div>

        {/* Pending Group Invites */}
        {pendingFamilyInvites.length > 0 && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-primary dark:text-primary font-semibold">
              <Users className="w-5 h-5" />
              {t('youHave', language)} {pendingFamilyInvites.length} {pendingFamilyInvites.length > 1 ? t('pendingGroupRequestPlural', language) : t('pendingGroupRequest', language)}
            </div>
            {pendingFamilyInvites.map(invite => (
              <div key={invite.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{invite.fromEmail} {t('invitedYouTo', language)} {invite.groupName || t('aGroup', language)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleAcceptFamilyInvite(invite)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <Check className="w-4 h-4" /> {t('accept', language)}
                  </button>
                  <button 
                    onClick={() => handleDeclineFamilyInvite(invite.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" /> {t('decline', language)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending Event Invites */}
        {pendingInvites.length > 0 && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-primary dark:text-primary font-semibold">
              <Bell className="w-5 h-5" />
              {t('youHave', language)} {pendingInvites.length} {pendingInvites.length > 1 ? t('pendingInvitePlural', language) : t('pendingInvite', language)}
            </div>
            {pendingInvites.map(invite => (
              <div key={invite.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{invite.title}</p>
                  {invite.description && <p className="text-sm text-zinc-500 line-clamp-1">{invite.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleAcceptInvite(invite.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <Check className="w-4 h-4" /> {t('accept', language)}
                  </button>
                  <button 
                    onClick={() => handleDeclineInvite(invite.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" /> {t('decline', language)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Horizontal Group Pills */}
        <div className="w-full overflow-x-auto no-scrollbar py-2">
          <div className="flex items-center gap-2 px-4 w-max mx-auto">
            <button
              onClick={() => setActiveGroupId('personal')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                activeGroupId === 'personal'
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-primary/50'
              }`}
            >
              <User className="w-4 h-4" /> {t('personal', language)}
            </button>
            
            {groups.map(group => (
              <button
                key={group.id}
                onClick={() => setActiveGroupId(group.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  activeGroupId === group.id
                    ? 'bg-primary text-white shadow-md'
                    : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-primary/50'
                }`}
              >
                <Users className="w-4 h-4" /> {group.name}
              </button>
            ))}

            <button
              onClick={() => setIsCreateGroupModalOpen(true)}
              className="px-4 py-2 rounded-full text-sm font-medium border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> {t('newGroup', language)}
            </button>
          </div>
        </div>

        {activeGroupId !== 'personal' && (
          <div className="flex justify-center items-center gap-4 mb-2 px-4 flex-wrap">
            <div className="flex gap-2">
              <button 
                onClick={() => setIsGamesHubOpen(true)}
                className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <Gamepad2 className="w-4 h-4" /> {t('games', language)}
              </button>
              
              <button 
                onClick={() => setIsInviteModalOpen(true)}
                className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" /> {t('invite', language)}
              </button>
              
              <button 
                onClick={() => setIsGroupSettingsOpen(true)}
                className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <Settings className="w-4 h-4" /> {t('editGroup', language)}
              </button>
            </div>
            
            <div className="flex items-center -space-x-2">
              {groups.find(g => g.id === activeGroupId)?.members?.map((memberId: string) => {
                const u = userMap[memberId];
                if (!u) return null;
                return (
                  <div key={memberId} className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-zinc-50 dark:border-zinc-950 flex items-center justify-center text-xs font-bold text-zinc-600 dark:text-zinc-300 relative overflow-hidden" title={u.name || u.email}>
                    {u.photoURL ? (
                      <img src={u.photoURL} alt={u.name || u.email} className="w-full h-full object-cover" />
                    ) : (
                      (u.name?.[0] || u.email?.[0] || '?').toUpperCase()
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Game in Progress Banner */}
        {activeGames.length > 0 && (
          <div onClick={() => setIsGamesHubOpen(true)} className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-indigo-500/20 transition-colors -mt-2 mb-2 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center text-indigo-500 animate-pulse">
                <Gamepad2 className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-indigo-700 dark:text-indigo-400 text-sm flex items-center gap-2">
                  {activeGames[0].gameType.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} 
                  {activeGames[0].status === 'waiting' ? t('lobby', language) : t('inProgress', language)}
                  
                  {/* Show who is in the game */}
                  <span className="flex items-center -space-x-1.5 ml-2">
                    {(() => {
                      const game = activeGames[0];
                      let playerIds: string[] = [];
                      if (game.gameType === 'tic-tac-toe') {
                        playerIds = [game.state?.players?.X, game.state?.players?.O].filter(Boolean);
                      } else if (game.gameType === 'rummy-45') {
                        playerIds = game.state?.playerIds || [];
                      }
                      
                      return playerIds.map((uid) => {
                        const u = userMap[uid];
                        if (!u) return null;
                        return (
                          <div key={uid} className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-indigo-500/20 flex items-center justify-center text-[8px] font-bold text-zinc-600 dark:text-zinc-300 relative overflow-hidden" title={u.name || u.email}>
                            {u.photoURL ? (
                              <img src={u.photoURL} alt={u.name || u.email} className="w-full h-full object-cover" />
                            ) : (
                              (u.name?.[0] || u.email?.[0] || '?').toUpperCase()
                            )}
                          </div>
                        );
                      });
                    })()}
                  </span>
                </p>
                <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70">
                  {activeGames.length > 1 ? `${activeGames.length} ${t('gamesRunningTapToView', language)}` : (activeGames[0].status === 'waiting' ? t('waitingForPlayers', language) : t('tapToResume', language))}
                </p>
              </div>
            </div>
            <button className="px-3 py-1.5 bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm">
              {activeGames[0].status === 'waiting' ? t('join', language) : t('resume', language)}
            </button>
          </div>
        )}

        {/* An empty calendar and an unreadable one look identical, so the second one says so. */}
        {eventsLoadError && (
          <p role="alert" className="mb-3 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-sm text-rose-700 dark:text-rose-300">
            {t('eventsLoadFailed', language)}
          </p>
        )}

        {/* Calendar Area */}
        <CalendarGrid 
          currentDate={currentDate} 
          setCurrentDate={setCurrentDate} 
          selectedDate={selectedDate} 
          setSelectedDate={setSelectedDate} 
          events={allCalendarEvents}
          userMap={userMap}
          view={activeGroupId === 'personal' ? 'personal' : 'family'}
          onEventClick={(ev) => setSelectedEvent(ev)}
          onAddEventClick={() => { setEventToEdit(null); setInitialTemplate(null); setIsAddModalOpen(true); }}
        />

        {/* The hour grid for whichever day is selected.
            Under the month grid rather than replacing it: the month answers "what is this
            month like" and this answers "what does that day look like", and they are both
            worth having on screen at once. Events are already expanded by the caller, so
            recurrence is not the timeline’s business. */}
        {selectedDate && (
          <div className="mt-4">
            <DayTimeline
              date={selectedDate}
              events={allCalendarEvents.filter((ev: any) => occursOn(ev, localDayKey(selectedDate)))}
              onEventClick={(ev) => setSelectedEvent(ev)}
            />
          </div>
        )}

      </main>

      {/* Floating Action Button with Expansion */}
      <div className="fixed bottom-8 right-8 z-[90] flex flex-col items-end gap-3">
        {isFabExpanded && (
          <div ref={fabMenu.menuRef} {...fabMenu.menuProps} className="flex flex-col items-end gap-3 mb-2 outline-none">
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate({ title: t('groceryList', language), category: 'chores', isTask: true });
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-4 fade-in"
            >
              {t('groceryList', language)} <ShoppingCart className="w-4 h-4 text-emerald-500" />
            </button>
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate({ title: t('newChore', language), category: 'chores', isTask: true });
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-6 fade-in"
            >
              {t('newChore', language)} <Wrench className="w-4 h-4 text-amber-500" />
            </button>
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate(null);
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-8 fade-in"
            >
              {t('standardEvent', language)} <CalendarIcon className="w-4 h-4 text-primary" />
            </button>
          </div>
        )}
        <button
          ref={fabMenu.triggerRef}
          {...fabMenu.triggerProps}
          aria-label={t('quickAddLabel', language)}
          onClick={() => setIsFabExpanded(!isFabExpanded)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all z-[90] ${
            isFabExpanded 
              ? 'bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 rotate-45' 
              : 'bg-primary hover:bg-primary/90 text-white hover:shadow-xl hover:-translate-y-1'
          }`}
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* Group Chat Widget */}
      {activeGroupId !== 'personal' && (
        <GroupChatWidget
          // Remounted per group, for the same reason Chat.tsx does it: the pane holds a message
          // list, an AI digest, a draft and a reply target, and without a key a tab switch points
          // the listener at another conversation while all of that survives — one group's chat
          // under another group's name, which is the defect this screen was just fixed for.
          // NAMESPACED, and that is the whole bug. `GamesHubModal` below is a SIBLING in this
          // same children array and carried the identical key. React builds a Map of the old
          // children keyed by `key` (`mapRemainingChildren`), so the LATER duplicate overwrote
          // this one, and the deletion pass only deletes what is still in that Map. This widget
          // was therefore never deleted: on a group switch its DOM stayed painted, its effect
          // cleanups never ran, and its X set state on a fiber React no longer renders — a pane
          // showing one group under another group's pill, with a dead close button. Which of the
          // two leaked was decided purely by source order.
          key={`chat-${activeGroupId}`}
          convId={activeGroupId}
          convKind="group"
          // No „Chat de grup ·” prefix. It costs 97px of a 174px title column, and what gets
          // truncated is the far end — the group's own NAME, the only informative half. The pane
          // is visibly a chat; it does not need to say so twice. Measured: with the prefix the
          // Romanian title shows 64% at 320px, without it the name fits whole with room spare.
          title={groups.find(g => g.id === activeGroupId)?.name || t('group', language)}
          userMap={userMap}
          members={groups.find(g => g.id === activeGroupId)?.members || []}
        />
      )}

      {/* Add Event Modal */}
      <AddEventModal 
        isOpen={isAddModalOpen} 
        onClose={() => { setIsAddModalOpen(false); setEventToEdit(null); setInitialTemplate(null); }} 
        selectedDate={selectedDate} 
        editEvent={eventToEdit}
        initialTemplate={initialTemplate}
        userMap={userMap}
        activeGroupId={activeGroupId}
        groups={groups}
      />

      {/* Overview Modal */}
      {overviewModalType && (
        <div onClick={() => setOverviewModalType(null)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()} ref={overviewDialog.dialogRef} {...overviewDialog.dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                {overviewModalType === 'total' && t('todaysEventsTasks', language)}
                {overviewModalType === 'pending' && t('pendingTasksToday', language)}
                {overviewModalType === 'completed' && t('completedTasksToday', language)}
              </h3>
              <button onClick={() => setOverviewModalType(null)} aria-label={t('closeAction', language)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
              {(() => {
                const todayEvents = allCalendarEvents.filter(ev => occursOn(ev, localDayKey(new Date())));
                let filtered = todayEvents;
                if (overviewModalType === 'pending') {
                  filtered = todayEvents.filter(ev => ev.isTask && ev.taskStatus !== 'completed');
                } else if (overviewModalType === 'completed') {
                  filtered = todayEvents.filter(ev => ev.isTask && ev.taskStatus === 'completed');
                }

                if (filtered.length === 0) {
                  return <p className="text-sm text-zinc-500 text-center py-6">{t('noItemsFound', language)}</p>;
                }

                return filtered.map((ev: any) => {
                  let Icon = Circle;
                  let colorClass = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';

                  if (ev.color) {
                    colorClass = eventColorClass(ev.color, colorClass);
                  } else {
                    switch (ev.categoryId) {
                      case 'work': Icon = Briefcase; colorClass = 'text-blue-500 bg-blue-50 dark:bg-blue-500/10'; break;
                      case 'family': Icon = Heart; colorClass = 'text-rose-500 bg-rose-50 dark:bg-rose-500/10'; break;
                      case 'chores': Icon = Wrench; colorClass = 'text-amber-500 bg-amber-50 dark:bg-amber-500/10'; break;
                      case 'appointments': Icon = CalendarIcon; colorClass = 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'; break;
                      case 'important': Icon = Star; colorClass = 'text-violet-500 bg-violet-50 dark:bg-violet-500/10'; break;
                    }
                  }

                  return (
                    <div
                      key={ev.id}
                      onClick={() => { setOverviewModalType(null); setSelectedEvent(ev); }}
                      className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-700"
                    >
                      <div className={`p-2 rounded-lg ${colorClass} mt-0.5`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 text-sm flex items-center gap-2">
                          {ev.title}
                          {ev.checklistItems && ev.checklistItems.length > 0 && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
                              ({ev.checklistItems.length} {ev.checklistItems.length !== 1 ? t('itemsPlural', language) : t('item', language)})
                            </span>
                          )}
                          {ev.isTask && ev.taskStatus === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {ev.time && (
                            <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {displayTime(ev, timezone || localZone())?.text ?? ev.time}</span>
                          )}
                          {activeGroupId !== 'personal' && userMap && (
                            <div className="flex items-center gap-1">
                              <div className="flex -space-x-1 shrink-0">
                                {(() => {
                                  const ids = ev.assigneeIds?.length > 0 ? ev.assigneeIds : (ev.assigneeId ? [ev.assigneeId] : [ev.ownerId]);
                                  return ids.slice(0, 3).map((id: string, idx: number) => userMap[id] && (
                                    <div key={id} className={`w-4 h-4 rounded-full border border-white dark:border-zinc-900 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden shrink-0 z-[${3 - idx}]`} title={userMap[id].name || userMap[id].email}>
                                      {userMap[id].photoURL ? (
                                        <img src={userMap[id].photoURL} className="w-full h-full object-cover" />
                                      ) : (
                                        <span className="text-[8px] font-bold text-zinc-500">
                                          {(userMap[id].name || userMap[id].email)?.charAt(0).toUpperCase() || '?'}
                                        </span>
                                      )}
                                    </div>
                                  ));
                                })()}
                              </div>
                              {(() => {
                                const ids = ev.assigneeIds?.length > 0 ? ev.assigneeIds : (ev.assigneeId ? [ev.assigneeId] : [ev.ownerId]);
                                return ids.length > 3 && (
                                  <span className="text-xs text-zinc-500">+{ids.length - 3}</span>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      <EventDetailsModal
        isOpen={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        event={selectedEvent}
        userMap={userMap}
        groups={groups}
        onEdit={() => {
          setEventToEdit(selectedEvent);
          setIsAddModalOpen(true);
        }}
      />

      {/* Invite Group Modal */}
      <InviteFamilyModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        groupId={activeGroupId !== 'personal' ? activeGroupId : undefined}
        groupName={groups.find(g => g.id === activeGroupId)?.name}
        memberIds={groups.find(g => g.id === activeGroupId)?.members || []}
      />

      <CreateGroupModal
        isOpen={isCreateGroupModalOpen}
        onClose={() => setIsCreateGroupModalOpen(false)}
      />

      <LeaveGroupModal
        isOpen={isLeaveGroupModalOpen}
        onClose={() => setIsLeaveGroupModalOpen(false)}
        groupId={activeGroupId !== 'personal' ? activeGroupId : ''}
        groupName={groups.find(g => g.id === activeGroupId)?.name || ''}
        isOwner={groups.find(g => g.id === activeGroupId)?.ownerId === auth.currentUser?.uid}
        onSuccess={() => setActiveGroupId('personal')}
      />

      <GroupSettingsModal
        isOpen={isGroupSettingsOpen}
        onClose={() => setIsGroupSettingsOpen(false)}
        groupId={activeGroupId !== 'personal' ? activeGroupId : ''}
        groupName={groups.find(g => g.id === activeGroupId)?.name || ''}
        isOwner={groups.find(g => g.id === activeGroupId)?.ownerId === auth.currentUser?.uid}
        userMap={userMap}
        members={groups.find(g => g.id === activeGroupId)?.members || []}
        onSuccess={() => setActiveGroupId('personal')}
      />

      <GamesHubModal
        // Same again: the hub is hidden rather than unmounted, and its active games, leaderboard
        // and in-progress game are per GROUP.
        // Namespaced too, even though only one of the two needs to change to break the
        // collision: leaving this bare would make the behaviour depend on JSX source order, so
        // reordering the file would silently move the leak here.
        key={`games-${activeGroupId}`}
        isOpen={isGamesHubOpen}
        onClose={() => setIsGamesHubOpen(false)}
        groupId={activeGroupId !== 'personal' ? activeGroupId : ''}
        groupName={groups.find(g => g.id === activeGroupId)?.name || ''}
        userMap={userMap}
        selectedDate={selectedDate}
      />

      <RecurringEventsPanel
        isOpen={isRecurringPanelOpen}
        onClose={() => setIsRecurringPanelOpen(false)}
        events={events}
        onEditEvent={(ev: any) => {
          setIsRecurringPanelOpen(false);
          setEventToEdit(ev);
          setIsAddModalOpen(true);
        }}
      />

    </div>
  );
}
