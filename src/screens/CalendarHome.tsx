import { useState, useEffect, useRef, useMemo } from 'react';
import { isSameDay, format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { auth, db, messaging } from '../firebase';
import { getToken } from 'firebase/messaging';
import { collection, query, onSnapshot, doc, updateDoc, where, arrayUnion, getDoc } from 'firebase/firestore';
import { Calendar as CalendarIcon, Users, User, Settings, Plus, Bell, Check, X, Wallet, UserPlus, Clock, CheckCircle2, Circle, Briefcase, Heart, Wrench, Star, Gamepad2, ShoppingCart, RefreshCw, Repeat } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import CalendarGrid from '../components/CalendarGrid';
import AddEventModal from '../components/AddEventModal';
import EventDetailsModal from '../components/EventDetailsModal';
import InviteFamilyModal from '../components/InviteFamilyModal';
import CreateGroupModal from '../components/CreateGroupModal';
import LeaveGroupModal from '../components/LeaveGroupModal';
import GroupSettingsModal from '../components/GroupSettingsModal';
import NotificationsDropdown from '../components/NotificationsDropdown';
import GroupChatWidget from '../components/GroupChatWidget';
import GamesHubModal from '../components/games/GamesHubModal';
import RecurringEventsPanel from '../components/RecurringEventsPanel';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store';
import { t, getDateLocale } from '../utils/i18n';
import { expandRecurringEvents } from '../utils/recurrence';

export default function CalendarHome() {
  const [activeGroupId, setActiveGroupId] = useState<string | 'personal'>('personal');
  const [groups, setGroups] = useState<any[]>([]);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [isLeaveGroupModalOpen, setIsLeaveGroupModalOpen] = useState(false);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [eventToEdit, setEventToEdit] = useState<any | null>(null);
  const [initialTemplate, setInitialTemplate] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [pendingFamilyInvites, setPendingFamilyInvites] = useState<any[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [overviewModalType, setOverviewModalType] = useState<'total' | 'pending' | 'completed' | null>(null);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [isGamesHubOpen, setIsGamesHubOpen] = useState(false);
  const [userMap, setUserMap] = useState<Record<string, any>>({});
  const [activeGames, setActiveGames] = useState<any[]>([]);
  const [isFabExpanded, setIsFabExpanded] = useState(false);
  const [isRecurringPanelOpen, setIsRecurringPanelOpen] = useState(false);
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const dateLocale = getDateLocale(language);

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
    const unsubUser = onSnapshot(doc(db, 'users', auth.currentUser.uid), (docSnap) => {
      if (docSnap.exists()) legacyFamily = docSnap.data().familyMembers || [];
    });

    const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', auth.currentUser.uid));
    const unsubscribeGroups = onSnapshot(qGroups, async (snapshot) => {
      const fetchedGroups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(fetchedGroups);
      
      const map: Record<string, any> = {};
      // Seed current user from auth first, then enrich with Firestore doc (which has photoURL)
      map[auth.currentUser!.uid] = { id: auth.currentUser!.uid, email: auth.currentUser!.email, name: auth.currentUser!.displayName || 'Me' };
      
      const memberIds = new Set<string>([auth.currentUser!.uid, ...legacyFamily]);
      fetchedGroups.forEach((g: any) => g.members?.forEach((id: string) => memberIds.add(id)));
      
      for (const id of Array.from(memberIds)) {
        const userDoc = await getDoc(doc(db, 'users', id));
        if (userDoc.exists()) {
          map[id] = { id, ...userDoc.data() };
        }
      }
      setUserMap(map);
    });
    
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

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const active = games.filter(g => g.status === 'playing' || g.status === 'waiting');
      setActiveGames(active);
    });

    return () => unsubscribe();
  }, [activeGroupId, selectedDate]);

  // Listen to incoming group invites
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'group_invites'), 
      where('toEmail', '==', auth.currentUser.email?.toLowerCase()),
      where('status', '==', 'pending')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPendingFamilyInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  // Request notification permissions and save FCM token
  useEffect(() => {
    if (!auth.currentUser || !messaging) return;

    const requestPermission = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const token = await getToken(messaging!, { 
            vapidKey: 'BIsH5f-u0rS2wZ3jL-yqF9qS-nFf_vB1a_zZ_8j-xZ_8'
          });
          if (token) {
            await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
              fcmTokens: arrayUnion(token)
            });
          }
        }
      } catch (err) {
        console.error('An error occurred while retrieving token. ', err);
      }
    };

    requestPermission();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Listen to all events where user is owner OR it is shared with family OR they are invited
    const q = query(collection(db, 'events'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Filter based on active group
      const filteredEvents = allEvents.filter((ev: any) => {
        // If it's a pending invite for me, it goes to the invites list, not the calendar
        if (ev.inviteeId === auth.currentUser?.uid && ev.inviteStatus === 'pending') {
          return false;
        }

        if (activeGroupId === 'personal') {
          // Personal view: show events where owner is me and it has no groupId, OR it's a legacy private event, OR I am an accepted invitee
          const isAssignee = ev.assigneeIds?.includes(auth.currentUser?.uid) || ev.assigneeId === auth.currentUser?.uid;
          return ((ev.ownerId === auth.currentUser?.uid && !ev.groupId && !ev.sharedWithFamily) || isAssignee || (ev.inviteeId === auth.currentUser?.uid && ev.inviteStatus === 'accepted'));
        } else {
          // Group view: show events belonging to this group, or legacy sharedWithFamily events if I'm in the group
          const isGroupEvent = ev.groupId === activeGroupId || (ev.sharedWithFamily === true && !ev.groupId);
          let canSee = true;
          if (ev.ownerId !== auth.currentUser?.uid && ev.visibleTo && Array.isArray(ev.visibleTo)) {
            canSee = ev.visibleTo.includes(auth.currentUser?.uid);
          }
          return isGroupEvent && canSee;
        }
      });
      
      setEvents(filteredEvents);

      // Set Pending Invites
      const invites = allEvents.filter((ev: any) => 
        ev.inviteeId === auth.currentUser?.uid && ev.inviteStatus === 'pending'
      );
      setPendingInvites(invites);

      setSelectedEvent((prev: any) => {
        if (!prev) return null;
        const updated = filteredEvents.find((e: any) => e.id === prev.id);
        return updated || prev;
      });
    });

    return () => unsubscribe();
  }, [activeGroupId]);

  // Schedule Local Notifications for Events with Reminders
  useEffect(() => {
    const scheduleNotifications = async () => {
      try {
        const permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display !== 'granted') {
          const requested = await LocalNotifications.requestPermissions();
          if (requested.display !== 'granted') return;
        }

        // Cancel all previously scheduled to avoid duplicates
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({ notifications: pending.notifications });
        }

        const expandedEvents = expandRecurringEvents(events, new Date(), addMonths(new Date(), 2));
        const now = new Date();
        const notificationsToSchedule = [];

        for (const ev of expandedEvents) {
          if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined && ev.date) {
            const evDate = new Date(ev.date);
            if (ev.time) {
              const [hours, minutes] = ev.time.split(':').map(Number);
              evDate.setHours(hours, minutes, 0, 0);
            }
            const notifyTime = new Date(evDate.getTime() - ev.reminderMinutes * 60000);
            
            if (notifyTime > now) {
              // Generate a safe numeric ID
              let numericId = 0;
              for (let i = 0; i < ev.id.length; i++) numericId += ev.id.charCodeAt(i);
              numericId = (numericId + (evDate.getTime() % 100000)) % 2147483647;

              notificationsToSchedule.push({
                id: numericId,
                title: ev.title,
                body: ev.reminderMinutes === 0 ? 'Happening now!' : `Starts in ${ev.reminderMinutes >= 60 ? (ev.reminderMinutes / 60) + ' hour(s)' : ev.reminderMinutes + ' minutes'}${ev.location ? ` at ${ev.location}` : ''}`,
                schedule: { at: notifyTime },
              });
            }
          }
        }

        if (notificationsToSchedule.length > 0) {
          await LocalNotifications.schedule({ notifications: notificationsToSchedule });
        }
      } catch (err) {
        console.error('Error scheduling local notifications:', err);
      }
    };

    scheduleNotifications();
  }, [events]);

  const handleAcceptInvite = async (eventId: string) => {
    await updateDoc(doc(db, 'events', eventId), { inviteStatus: 'accepted' });
  };

  const handleDeclineInvite = async (eventId: string) => {
    // We could delete or just set status to declined
    await updateDoc(doc(db, 'events', eventId), { inviteStatus: 'declined' });
  };

  const handleAcceptFamilyInvite = async (invite: any) => {
    if (!auth.currentUser) return;
    // 1. Update invite status
    await updateDoc(doc(db, 'group_invites', invite.id), { status: 'accepted' });
    
    // 2. Add me to the group members
    if (invite.groupId) {
      await updateDoc(doc(db, 'groups', invite.groupId), {
        members: arrayUnion(auth.currentUser.uid)
      });
    } else {
      // Legacy fallback
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { familyMembers: arrayUnion(invite.fromId) });
      await updateDoc(doc(db, 'users', invite.fromId), { familyMembers: arrayUnion(auth.currentUser.uid) });
    }
  };

  const handleDeclineFamilyInvite = async (inviteId: string) => {
    await updateDoc(doc(db, 'group_invites', inviteId), { status: 'declined' });
  };

  const handleDismissBirthdayPrompt = async () => {
    if (!auth.currentUser) return;
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { hideBirthdayPrompt: true });
    } catch (err) {
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
          title: `${u.name || u.email}'s Birthday 🎂`,
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
  }, [userMap, activeGroupId, groups]);

  const allCalendarEvents = useMemo(() => {
    // Build a 3-month window around currentDate for recurrence expansion
    const windowStart = subMonths(startOfMonth(currentDate), 1);
    const windowEnd = addMonths(endOfMonth(currentDate), 2);
    const expanded = expandRecurringEvents(events, windowStart, windowEnd);
    return [...expanded, ...birthdayEvents];
  }, [events, birthdayEvents, currentDate]);

  return (
    <div className="min-h-screen bg-transparent flex flex-col relative pt-[60px]">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <CalendarIcon className="w-6 h-6" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Our Days</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsRecurringPanelOpen(true)}
            className="p-2 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-full transition-colors"
            title="Recurring Events"
          >
            <Repeat className="w-5 h-5" />
          </button>
          <NotificationsDropdown />
          <button 
            onClick={() => navigate('/wallet')}
            className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-full transition-colors"
            title="Assets"
          >
            <Wallet className="w-5 h-5" />
          </button>
          <button 
            onClick={() => navigate('/settings')}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
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
        
        {/* Birthday Prompt */}
        {auth.currentUser && userMap[auth.currentUser.uid] && !userMap[auth.currentUser.uid].birthday && !userMap[auth.currentUser.uid].hideBirthdayPrompt && (
          <div className="bg-gradient-to-r from-pink-500/10 to-rose-500/10 border border-pink-500/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-top-4 fade-in mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-pink-500/20 text-pink-600 dark:text-pink-400 rounded-lg shrink-0">
                <span className="text-xl">🎂</span>
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">Add your birthday!</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Let your groups know when to celebrate you.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate('/settings')}
                className="flex-1 sm:flex-none px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Set Birthday
              </button>
              <button 
                onClick={handleDismissBirthdayPrompt}
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
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div 
              onClick={() => setOverviewModalType('total')}
              className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex flex-col justify-center cursor-pointer hover:bg-primary/10 transition-colors"
            >
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">{t('totalEvents', language)}</p>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {allCalendarEvents.filter(ev => ev.date && isSameDay(new Date(ev.date), new Date())).length}
                </p>
                <div className="flex -space-x-1">
                  {allCalendarEvents.filter(ev => ev.date && isSameDay(new Date(ev.date), new Date())).slice(0, 5).map((ev, idx) => {
                    let color = 'bg-zinc-500';
                    if (ev.color) {
                      color = `bg-${ev.color}-500`;
                    } else {
                      color = ev.categoryId === 'work' ? 'bg-blue-500' : 
                                  ev.categoryId === 'family_time' ? 'bg-emerald-500' : 
                                  ev.categoryId === 'chores' ? 'bg-amber-500' : 
                                  ev.categoryId === 'health' ? 'bg-rose-500' : 'bg-zinc-500';
                    }
                    return <div key={`${ev.id}-${idx}`} className={`w-3 h-3 rounded-full border border-white dark:border-zinc-900 ${color}`} />
                  })}
                </div>
              </div>
            </div>
            <div 
              onClick={() => setOverviewModalType('pending')}
              className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex flex-col justify-center cursor-pointer hover:bg-amber-500/10 transition-colors"
            >
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-1">{t('tasksPending', language)}</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {allCalendarEvents.filter(ev => ev.date && isSameDay(new Date(ev.date), new Date()) && ev.isTask && ev.taskStatus !== 'completed').length}
              </p>
            </div>
            <div 
              onClick={() => setOverviewModalType('completed')}
              className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 flex flex-col justify-center cursor-pointer hover:bg-emerald-500/10 transition-colors"
            >
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-1">{t('tasksCompleted', language)}</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {allCalendarEvents.filter(ev => ev.date && isSameDay(new Date(ev.date), new Date()) && ev.isTask && ev.taskStatus === 'completed').length}
              </p>
            </div>
          </div>
        </div>

        {/* Pending Group Invites */}
        {pendingFamilyInvites.length > 0 && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-primary dark:text-primary font-semibold">
              <Users className="w-5 h-5" />
              You have {pendingFamilyInvites.length} pending group request{pendingFamilyInvites.length > 1 ? 's' : ''}
            </div>
            {pendingFamilyInvites.map(invite => (
              <div key={invite.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{invite.fromEmail} invited you to {invite.groupName || 'a group'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleAcceptFamilyInvite(invite)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <Check className="w-4 h-4" /> Accept
                  </button>
                  <button 
                    onClick={() => handleDeclineFamilyInvite(invite.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" /> Decline
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
              You have {pendingInvites.length} pending invite{pendingInvites.length > 1 ? 's' : ''}
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
                    <Check className="w-4 h-4" /> Accept
                  </button>
                  <button 
                    onClick={() => handleDeclineInvite(invite.id)}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" /> Decline
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
              <User className="w-4 h-4" /> Personal
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
              <Plus className="w-4 h-4" /> New Group
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
                <UserPlus className="w-4 h-4" /> Invite
              </button>
              
              <button 
                onClick={() => setIsGroupSettingsOpen(true)}
                className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <Settings className="w-4 h-4" /> Edit Group
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
                  {activeGames[0].status === 'waiting' ? 'Lobby' : 'in progress'}
                  
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
                  {activeGames.length > 1 ? `${activeGames.length} games running. Tap to view.` : (activeGames[0].status === 'waiting' ? 'Waiting for players... Tap to join.' : 'Tap to resume playing.')}
                </p>
              </div>
            </div>
            <button className="px-3 py-1.5 bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm">
              {activeGames[0].status === 'waiting' ? 'Join' : 'Resume'}
            </button>
          </div>
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

      </main>

      {/* Floating Action Button with Expansion */}
      <div className="fixed bottom-8 right-8 z-[90] flex flex-col items-end gap-3">
        {isFabExpanded && (
          <div className="flex flex-col items-end gap-3 mb-2">
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate({ title: 'Grocery List', category: 'chores', isTask: true });
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-4 fade-in"
            >
              Grocery List <ShoppingCart className="w-4 h-4 text-emerald-500" />
            </button>
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate({ title: 'New Chore', category: 'chores', isTask: true });
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-6 fade-in"
            >
              New Chore <Wrench className="w-4 h-4 text-amber-500" />
            </button>
            <button
              onClick={() => {
                setEventToEdit(null);
                setInitialTemplate(null);
                setIsAddModalOpen(true);
                setIsFabExpanded(false);
              }}
              className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all animate-in slide-in-from-bottom-8 fade-in"
            >
              Standard Event <CalendarIcon className="w-4 h-4 text-primary" />
            </button>
          </div>
        )}
        <button 
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
          groupId={activeGroupId} 
          groupName={groups.find(g => g.id === activeGroupId)?.name || 'Group'} 
          userMap={userMap}
          groupMembers={groups.find(g => g.id === activeGroupId)?.members || []}
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
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                {overviewModalType === 'total' && 'Today\'s Events & Tasks'}
                {overviewModalType === 'pending' && 'Pending Tasks Today'}
                {overviewModalType === 'completed' && 'Completed Tasks Today'}
              </h3>
              <button onClick={() => setOverviewModalType(null)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
              {(() => {
                const todayEvents = allCalendarEvents.filter(ev => ev.date && isSameDay(new Date(ev.date), new Date()));
                let filtered = todayEvents;
                if (overviewModalType === 'pending') {
                  filtered = todayEvents.filter(ev => ev.isTask && ev.taskStatus !== 'completed');
                } else if (overviewModalType === 'completed') {
                  filtered = todayEvents.filter(ev => ev.isTask && ev.taskStatus === 'completed');
                }

                if (filtered.length === 0) {
                  return <p className="text-sm text-zinc-500 text-center py-6">No items found.</p>;
                }

                return filtered.map((ev: any, idx: number) => {
                  let Icon = Circle;
                  let colorClass = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';

                  if (ev.color) {
                    colorClass = `text-${ev.color}-500 bg-${ev.color}-50 dark:bg-${ev.color}-500/10`;
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
                      key={idx} 
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
                              ({ev.checklistItems.length} item{ev.checklistItems.length !== 1 ? 's' : ''})
                            </span>
                          )}
                          {ev.isTask && ev.taskStatus === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {ev.time && (
                            <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {ev.time}</span>
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
                                          {userMap[id].email?.charAt(0).toUpperCase() || '?'}
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
