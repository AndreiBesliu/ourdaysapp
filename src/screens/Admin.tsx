import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, ShieldAlert, RefreshCw, Users, UsersRound, CalendarDays,
  Gamepad2, Wallet, Search, Crown, Trash2, UserPlus, CheckCircle2,
  XCircle, Mail, Loader2, Activity, AlertTriangle, Ban, MailCheck, Power, X,
  Send, TrendingUp, Megaphone,
} from 'lucide-react';
import { auth } from '../firebase';
import {
  adminCheck, adminGetStats, adminListProfiles, adminListAdmins, adminSetAdmin,
  adminGetHealth, adminGetUser, adminModerateUser, adminBroadcast, adminListGroups, adminGetGrowth,
  adminBackfillExpenses,
} from '../serverActions';

type Tab = 'overview' | 'profiles' | 'groups' | 'admins' | 'health' | 'broadcast';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const provLabel = (p?: string) => p === 'google.com' ? 'Google' : p === 'password' ? 'Email' : (p || '—');

// ── Small presentational helpers ──
function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
      <p className={`text-2xl font-black leading-none ${accent || 'text-zinc-900 dark:text-zinc-100'}`}>{value ?? 0}</p>
      <p className="text-[11px] text-zinc-500 mt-1 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="flex flex-col gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-xs text-zinc-600 dark:text-zinc-300 w-28 truncate capitalize">{k.replace(/-/g, ' ').replace(/_/g, ' ')}</span>
            <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 w-10 text-right tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">{icon} {title}</h3>
      {children}
    </div>
  );
}

// 30-day mini bar chart. `series` = [{date:'YYYY-MM-DD', count:n}].
function GrowthChart({ label, series, color }: { label: string; series: { date: string; count: number }[]; color: string }) {
  const data = series || [];
  const max = Math.max(1, ...data.map(d => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-black text-zinc-900 dark:text-zinc-100 tabular-nums">{total} <span className="text-[10px] font-medium text-zinc-400">/ 30d</span></p>
      </div>
      <div className="flex items-end gap-[2px] h-20">
        {data.map(d => (
          <div key={d.date} className="flex-1 flex flex-col justify-end group relative" title={`${d.date}: ${d.count}`}>
            <div className={`${color} rounded-sm transition-all`} style={{ height: `${Math.max(d.count ? 6 : 0, (d.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[9px] text-zinc-400">
        <span>{data[0]?.date?.slice(5) || ''}</span>
        <span>{data[data.length - 1]?.date?.slice(5) || 'today'}</span>
      </div>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const [access, setAccess] = useState<'checking' | 'granted' | 'denied'>('checking');
  // Every hook stays up here with the others: /admin needs an account, so a hook next to a return
  // is a crash nobody sees until a real operator opens the page.
  const [backfill, setBackfill] = useState<any>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [stats, setStats] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [growth, setGrowth] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null); // open user drill-down
  const [detailLoading, setDetailLoading] = useState(false);
  const [modBusy, setModBusy] = useState(false);
  const [bcTarget, setBcTarget] = useState('all');
  const [bcTitle, setBcTitle] = useState('');
  const [bcBody, setBcBody] = useState('');
  const [bcMsg, setBcMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bcBusy, setBcBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await adminCheck();
        if (!cancelled) setAccess(ok ? 'granted' : 'denied');
      } catch { if (!cancelled) setAccess('denied'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const refresh = async () => {
    setLoading(true); setLoadError(false);
    const results = await Promise.allSettled([
      adminGetStats(), adminListProfiles(), adminListAdmins(), adminGetHealth(), adminListGroups(), adminGetGrowth(),
    ]);
    const [s, p, a, h, g, gr] = results;
    if (s.status === 'fulfilled') setStats(s.value);
    if (p.status === 'fulfilled') setProfiles(p.value.profiles || []);
    if (a.status === 'fulfilled') setAdmins(a.value.admins || []);
    if (h.status === 'fulfilled') setHealth(h.value);
    if (g.status === 'fulfilled') setGroups(g.value.groups || []);
    if (gr.status === 'fulfilled') setGrowth(gr.value);
    if (results.some(r => r.status === 'rejected')) { setLoadError(true); console.error('Some admin data failed to load'); }
    setLoading(false);
  };

  const sendBroadcast = async () => {
    if (!bcTitle.trim()) return;
    setBcBusy(true); setBcMsg(null);
    try {
      const res = await adminBroadcast({ target: bcTarget, title: bcTitle.trim(), body: bcBody.trim() });
      setBcMsg({ ok: true, text: `Sent to ${res.created} user${res.created === 1 ? '' : 's'}.` });
      setBcTitle(''); setBcBody('');
    } catch (e: any) { setBcMsg({ ok: false, text: e?.message || 'Failed.' }); }
    finally { setBcBusy(false); }
  };

  const nameOf = (uid: string) => {
    const p = profiles.find(x => x.uid === uid);
    return p?.name || p?.email || uid.slice(0, 8);
  };

  const openUser = async (uid: string) => {
    setDetail({ uid }); setDetailLoading(true);
    try { setDetail(await adminGetUser(uid)); }
    catch (e) { console.error('User detail failed', e); setDetail(null); }
    finally { setDetailLoading(false); }
  };

  const moderate = async (uid: string, action: 'enable' | 'disable' | 'forceVerify' | 'delete') => {
    if (action === 'delete' && !confirm('Permanently delete this user (account + owned events/assets, removed from groups)? This cannot be undone.')) return;
    setModBusy(true);
    try {
      await adminModerateUser(uid, action);
      if (action === 'delete') { setDetail(null); await refresh(); }
      else { await openUser(uid); }
    } catch (e: any) { alert(e?.message || 'Action failed.'); }
    finally { setModBusy(false); }
  };

  useEffect(() => { if (access === 'granted') refresh(); }, [access]);

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
  }, [profiles, search]);

  const grant = async (email?: string, uid?: string, makeAdmin = true) => {
    setBusy(true); setGrantMsg(null);
    try {
      await adminSetAdmin({ email, uid, makeAdmin });
      setGrantEmail('');
      setGrantMsg({ ok: true, text: makeAdmin ? 'Admin granted.' : 'Admin revoked.' });
      await refresh();
    } catch (e: any) {
      setGrantMsg({ ok: false, text: e?.message || 'Failed.' });
    } finally { setBusy(false); }
  };

  if (access === 'checking') {
    return <div className="min-h-screen flex items-center justify-center text-zinc-500"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (access === 'denied') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center"><ShieldAlert className="w-8 h-8" /></div>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Admin access required</h1>
          <p className="text-sm text-zinc-500 mt-1">Your account ({auth.currentUser?.email}) isn't an admin.</p>
        </div>
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Back to app</button>
      </div>
    );
  }

  const u = stats?.users || {}, g = stats?.groups || {}, ev = stats?.events || {}, ga = stats?.games || {};
  const me = stats?.messages || {}, as = stats?.assets || {}, so = stats?.social || {}, no = stats?.notifications || {};

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[60px]">
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
        <div className="max-w-5xl w-full mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="p-2 -ml-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Admin</h1>
          </div>
          <button onClick={refresh} disabled={loading} className="p-2 text-zinc-500 hover:text-primary disabled:opacity-50" title="Refresh">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto p-4 flex flex-col gap-5">
        {/* Tabs */}
        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl w-fit overflow-x-auto max-w-full">
          {(['overview', 'profiles', 'groups', 'admins', 'health', 'broadcast'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`relative px-4 py-2 rounded-lg text-sm font-bold capitalize whitespace-nowrap transition-all ${tab === t ? 'bg-white dark:bg-zinc-700 shadow-sm text-primary' : 'text-zinc-500'}`}>
              {t}{t === 'profiles' && profiles.length ? ` (${profiles.length})` : ''}{t === 'groups' && groups.length ? ` (${groups.length})` : ''}{t === 'admins' && admins.length ? ` (${admins.length})` : ''}
              {t === 'health' && health?.errors?.length > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{health.errorTotal}</span>}
            </button>
          ))}
        </div>

        {loadError && (
          <div className="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg p-3 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" /> Some data failed to load — try Refresh.
          </div>
        )}
        {stats?.truncated && (
          <div className="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs rounded-lg p-2.5">
            Large dataset — totals are exact, but some breakdowns/profiles show only the first few thousand records.
          </div>
        )}

        {loading && !stats && <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="w-6 h-6 animate-spin" /></div>}

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && stats && (
          <div className="flex flex-col gap-6">
            {/* Headline numbers */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="Users" value={u.total} accent="text-primary" />
              <Stat label="Groups" value={g.total} accent="text-blue-500" />
              <Stat label="Events" value={ev.total} accent="text-emerald-500" />
              <Stat label="Games" value={ga.total} accent="text-indigo-500" />
              <Stat label="Messages" value={me.total} accent="text-amber-500" />
              <Stat label="Assets" value={as.total} accent="text-rose-500" />
            </div>

            <Section icon={<Users className="w-4 h-4 text-primary" />} title="Users">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <Stat label="Verified" value={u.verified} accent="text-emerald-500" />
                <Stat label="Unverified" value={u.unverified} accent="text-amber-500" />
                <Stat label="New (7d)" value={u.signups7d} />
                <Stat label="New (30d)" value={u.signups30d} />
                <Stat label="Push on" value={u.pushEnabled} />
                <Stat label="Friendships" value={u.friendships} />
                <Stat label="With birthday" value={u.withBirthday} />
                <Stat label="With photo" value={u.withPhoto} />
                <Stat label="With friends" value={u.withFriends} />
              </div>
              <Breakdown title="By sign-in provider" data={u.byProvider} />
            </Section>

            <Section icon={<UsersRound className="w-4 h-4 text-blue-500" />} title="Groups">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <Stat label="Shared" value={g.shared} />
                <Stat label="Solo" value={g.solo} />
                <Stat label="Memberships" value={g.memberships} />
                <Stat label="Avg members" value={g.avgMembers} />
                <Stat label="Largest" value={g.largest} />
              </div>
            </Section>

            <Section icon={<CalendarDays className="w-4 h-4 text-emerald-500" />} title="Events & Tasks">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <Stat label="Tasks" value={ev.tasks} />
                <Stat label="Completed" value={ev.completedTasks} accent="text-emerald-500" />
                <Stat label="Pending" value={ev.pendingTasks} accent="text-amber-500" />
                <Stat label="Plain events" value={ev.plainEvents} />
                <Stat label="Recurring" value={ev.recurring} />
                <Stat label="With reminder" value={ev.withReminder} />
                <Stat label="Shared" value={ev.sharedWithFamily} />
                <Stat label="With RSVP" value={ev.withRsvp} />
              </div>
              <Breakdown title="By category" data={ev.byCategory} />
            </Section>

            <Section icon={<Gamepad2 className="w-4 h-4 text-indigo-500" />} title="Arcade">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Finalized" value={ga.finalized} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Breakdown title="By game" data={ga.byType} />
                <Breakdown title="By status" data={ga.byStatus} />
              </div>
            </Section>

            <Section icon={<Wallet className="w-4 h-4 text-rose-500" />} title="Wallet & Social">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Assets shared" value={as.shared} />
                <Stat label="Notifications" value={no.total} />
                <Stat label="Unread notifs" value={no.unread} accent="text-amber-500" />
                <Stat label="Admins" value={stats?.admins?.total} accent="text-primary" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Breakdown title="Asset categories" data={as.byCategory} />
                <Breakdown title="Friend requests" data={so.friendRequests} />
                <Breakdown title="Group invites" data={so.groupInvites} />
                <Breakdown title="Notification types" data={no.byType} />
              </div>

              {/* Expenses had no Firestore rule from 2026-05-22 until 2026-08-25, so every read
                  and write was denied and anything written before that carries no scoping field.
                  This reports what a backfill would do; it writes only when Apply is pressed. */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                <p className="text-sm font-semibold">Expenses backfill</p>
                <p className="text-xs text-zinc-500">
                  Sets <code>ownerId</code> from <code>paidBy</code>. A group is assigned only when the
                  author belongs to exactly one; anyone in several is left personal and listed below,
                  because putting private spending into a group ledger cannot be undone.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={backfillBusy}
                    onClick={async () => {
                      setBackfillBusy(true); setBackfillErr(null);
                      try { setBackfill(await adminBackfillExpenses(false)); }
                      catch (e: any) { setBackfillErr(e?.message || String(e)); }
                      setBackfillBusy(false);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 disabled:opacity-50"
                  >
                    {backfillBusy ? 'Working…' : 'Dry run'}
                  </button>
                  <button
                    disabled={backfillBusy || !backfill || backfill.dryRun === false}
                    onClick={async () => {
                      setBackfillBusy(true); setBackfillErr(null);
                      try { setBackfill(await adminBackfillExpenses(true)); }
                      catch (e: any) { setBackfillErr(e?.message || String(e)); }
                      setBackfillBusy(false);
                    }}
                    title={!backfill ? 'Run the dry run first' : 'Write the fields'}
                    className="px-3 py-2 text-sm rounded-lg bg-primary text-white disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
                {backfillErr && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{backfillErr}</p>
                )}
                {backfill && (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-900 rounded p-2 overflow-x-auto">
{JSON.stringify(backfill, null, 2)}
                  </pre>
                )}
              </div>
            </Section>

            {growth && (
              <Section icon={<TrendingUp className="w-4 h-4 text-primary" />} title="Growth (last 30 days)">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <GrowthChart label="Sign-ups" series={growth.signups} color="bg-primary" />
                  <GrowthChart label="Events created" series={growth.events} color="bg-emerald-500" />
                  <GrowthChart label="Games played" series={growth.games} color="bg-indigo-500" />
                </div>
              </Section>
            )}

            <p className="text-[11px] text-zinc-400 text-center">Generated {fmtDate(stats.generatedAt)} · {new Date(stats.generatedAt).toLocaleTimeString()}</p>
          </div>
        )}

        {/* ── PROFILES ── */}
        {tab === 'profiles' && (
          <div className="flex flex-col gap-3">
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email"
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none" />
            </div>
            <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                    <th className="p-3">User</th><th className="p-3">Provider</th><th className="p-3">Joined</th>
                    <th className="p-3">Last seen</th><th className="p-3 text-center">Groups</th><th className="p-3 text-center">Events</th>
                    <th className="p-3 text-center">Friends</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.map(p => (
                    <tr key={p.uid} onClick={() => openUser(p.uid)} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 cursor-pointer">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
                            {p.photoURL ? <img src={p.photoURL} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-zinc-500">{(p.name?.[0] || p.email?.[0] || '?').toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-1">
                              {p.name || p.email?.split('@')[0] || 'User'}
                              {p.isAdmin && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                            </p>
                            <p className="text-xs text-zinc-500 truncate flex items-center gap-1">
                              {p.email}
                              {p.emailVerified ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-amber-500" />}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-zinc-600 dark:text-zinc-300">{provLabel(p.provider)}</td>
                      <td className="p-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                      <td className="p-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{fmtDate(p.lastSignInAt)}</td>
                      <td className="p-3 text-center tabular-nums">{p.groups}</td>
                      <td className="p-3 text-center tabular-nums">{p.events}</td>
                      <td className="p-3 text-center tabular-nums">{p.friends}</td>
                      <td className="p-3 text-right">
                        {!p.isAdmin ? (
                          <button onClick={(e) => { e.stopPropagation(); grant(undefined, p.uid, true); }} disabled={busy} className="text-xs text-primary hover:underline whitespace-nowrap">Make admin</button>
                        ) : (
                          <span className="text-[10px] uppercase font-bold text-amber-500">Admin</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredProfiles.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-zinc-400">No users.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ADMINS ── */}
        {tab === 'admins' && (
          <div className="flex flex-col gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4" /> Grant admin by email</p>
              <div className="flex gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                  <input value={grantEmail} onChange={e => setGrantEmail(e.target.value)} placeholder="user@example.com"
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none" />
                </div>
                <button onClick={() => grant(grantEmail.trim(), undefined, true)} disabled={busy || !grantEmail.trim()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">Grant</button>
              </div>
              {grantMsg && <p className={`mt-2 text-sm ${grantMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{grantMsg.text}</p>}
            </div>

            <div className="flex flex-col gap-2">
              {admins.map(a => (
                <div key={a.uid} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0"><Crown className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{a.name || a.email}</p>
                      <p className="text-xs text-zinc-500 truncate">{a.email} · since {fmtDate(a.addedAt)}{a.bootstrap ? ' · owner' : ''}</p>
                    </div>
                  </div>
                  {!a.bootstrap && admins.length > 1 ? (
                    <button onClick={() => grant(undefined, a.uid, false)} disabled={busy} className="p-2 text-zinc-400 hover:text-red-500 shrink-0" title="Revoke admin"><Trash2 className="w-4 h-4" /></button>
                  ) : (
                    <span className="text-[10px] uppercase font-bold text-zinc-400 shrink-0">{a.bootstrap ? 'owner' : 'last'}</span>
                  )}
                </div>
              ))}
              {admins.length === 0 && <p className="text-center text-zinc-400 py-6">No admins.</p>}
            </div>
          </div>
        )}

        {/* ── HEALTH ── */}
        {tab === 'health' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Errors logged" value={health?.errorTotal} accent={health?.errorTotal ? 'text-red-500' : 'text-emerald-500'} />
              <Stat label="AI calls today" value={health?.ai?.today} accent="text-primary" />
              <Stat label="AI users today" value={health?.ai?.activeUsers} />
              <Stat label="Notifs today" value={health?.notifications?.today} />
            </div>

            <Section icon={<AlertTriangle className="w-4 h-4 text-red-500" />} title="Recent errors">
              {(!health?.errors || health.errors.length === 0) ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-center text-sm text-emerald-500 flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" /> No errors logged.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {health.errors.map((er: any) => (
                    <div key={er.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words">{er.message}</p>
                        <span className="text-[10px] text-zinc-400 whitespace-nowrap shrink-0">{fmtDate(er.createdAt)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500">
                        {er.context && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">{er.context}</span>}
                        {er.url && <span>{er.url}</span>}
                        {er.email && <span>· {er.email}</span>}
                      </div>
                      {er.stack && <pre className="mt-2 text-[10px] text-zinc-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-zinc-50 dark:bg-zinc-800/50 rounded p-2">{er.stack}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {health?.ai?.top?.length > 0 && (
              <Section icon={<Activity className="w-4 h-4 text-primary" />} title="Top AI usage today">
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col gap-1.5">
                  {health.ai.top.map((tp: any) => {
                    const prof = profiles.find(p => p.uid === tp.uid);
                    return (
                      <div key={tp.uid} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-700 dark:text-zinc-300 truncate">{prof?.name || prof?.email || tp.uid.slice(0, 8)}</span>
                        <span className="font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{tp.count} / {health.ai.dailyLimitPerUser}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── GROUPS ── */}
        {tab === 'groups' && (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                    <th className="p-3">Group</th><th className="p-3">Owner</th>
                    <th className="p-3 text-center">Members</th><th className="p-3 text-center">Events</th><th className="p-3 text-center">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(gr => (
                    <tr key={gr.id} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0"><UsersRound className="w-4 h-4" /></div>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{gr.name || 'Group'}</p>
                            <p className="text-[11px] text-zinc-400 truncate">{gr.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {gr.ownerId ? (
                          <button onClick={() => openUser(gr.ownerId)} className="text-zinc-600 dark:text-zinc-300 hover:text-primary hover:underline truncate max-w-[160px] text-left">{nameOf(gr.ownerId)}</button>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="p-3 text-center tabular-nums font-medium">{gr.members}</td>
                      <td className="p-3 text-center tabular-nums">{gr.events}</td>
                      <td className="p-3 text-center tabular-nums">{gr.games}</td>
                    </tr>
                  ))}
                  {groups.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-zinc-400">No groups.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── BROADCAST ── */}
        {tab === 'broadcast' && (
          <div className="flex flex-col gap-4 max-w-xl">
            <div className="bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs rounded-lg p-3 flex items-start gap-2">
              <Megaphone className="w-4 h-4 shrink-0 mt-0.5" /> Sends an in-app notification to every recipient. Use sparingly — this reaches real users.
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Recipients</label>
                <select value={bcTarget} onChange={e => setBcTarget(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 text-sm border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none">
                  <option value="all">All users{stats?.users?.total ? ` (${stats.users.total})` : ''}</option>
                  {groups.map(gr => <option key={gr.id} value={gr.id}>Group: {gr.name || gr.id} ({gr.members})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Title</label>
                <input value={bcTitle} onChange={e => setBcTitle(e.target.value)} maxLength={80} placeholder="e.g. New feature available!"
                  className="mt-1.5 w-full px-3 py-2 text-sm border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Message <span className="normal-case font-normal text-zinc-400">(optional)</span></label>
                <textarea value={bcBody} onChange={e => setBcBody(e.target.value)} maxLength={280} rows={3} placeholder="Details…"
                  className="mt-1.5 w-full px-3 py-2 text-sm border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none resize-none" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={sendBroadcast} disabled={bcBusy || !bcTitle.trim()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  {bcBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send broadcast
                </button>
                {bcMsg && <p className={`text-sm ${bcMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{bcMsg.text}</p>}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* User detail + moderation */}
      {detail && (
        <div onClick={() => setDetail(null)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">User detail</h3>
              <button onClick={() => setDetail(null)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-full"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
              {detailLoading || !detail.auth ? (
                <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
                      {detail.auth?.photoURL ? <img src={detail.auth.photoURL} className="w-full h-full object-cover" /> : <span className="text-lg font-bold text-zinc-500">{(detail.name?.[0] || detail.auth?.email?.[0] || '?').toUpperCase()}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">{detail.name || 'User'} {detail.isAdmin && <Crown className="w-4 h-4 text-amber-500" />}{detail.auth?.disabled && <span className="text-[10px] uppercase font-bold text-red-500">disabled</span>}</p>
                      <p className="text-sm text-zinc-500 flex items-center gap-1">{detail.auth?.email} {detail.auth?.emailVerified ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-amber-500" />}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Groups" value={detail.counts?.groups} />
                    <Stat label="Events" value={detail.counts?.events} />
                    <Stat label="Games" value={detail.counts?.games} />
                    <Stat label="Assets" value={detail.counts?.assets} />
                  </div>

                  <div className="text-sm text-zinc-600 dark:text-zinc-300 flex flex-col gap-1">
                    <div className="flex justify-between"><span className="text-zinc-400">Provider</span><span>{provLabel(detail.auth?.provider)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Joined</span><span>{fmtDate(detail.auth?.createdAt)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Last seen</span><span>{fmtDate(detail.auth?.lastSignInAt)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Friends</span><span>{detail.friends?.length || 0}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Push</span><span>{detail.pushEnabled ? 'on' : 'off'}</span></div>
                  </div>

                  {detail.groups?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Groups</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.groups.map((gr: any) => <span key={gr.id} className="text-xs px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-md">{gr.name} · {gr.members}</span>)}
                      </div>
                    </div>
                  )}

                  {detail.recentEvents?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Recent events</p>
                      <div className="flex flex-col gap-1">
                        {detail.recentEvents.map((e: any) => <div key={e.id} className="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2"><span className="truncate">{e.title}</span>{e.isTask && <span className="text-[10px] text-zinc-400">{e.taskStatus}</span>}</div>)}
                      </div>
                    </div>
                  )}

                  {detail.uid !== auth.currentUser?.uid && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Moderation</p>
                      <div className="flex flex-wrap gap-2">
                        {!detail.auth?.emailVerified && <button onClick={() => moderate(detail.uid, 'forceVerify')} disabled={modBusy || detail.isProtected} className="px-3 py-1.5 text-sm bg-emerald-500/10 text-emerald-600 rounded-lg flex items-center gap-1.5 disabled:opacity-40"><MailCheck className="w-4 h-4" /> Verify email</button>}
                        {detail.auth?.disabled ? (
                          <button onClick={() => moderate(detail.uid, 'enable')} disabled={modBusy} className="px-3 py-1.5 text-sm bg-emerald-500/10 text-emerald-600 rounded-lg flex items-center gap-1.5"><Power className="w-4 h-4" /> Enable</button>
                        ) : (
                          <button onClick={() => moderate(detail.uid, 'disable')} disabled={modBusy || detail.isProtected} className="px-3 py-1.5 text-sm bg-amber-500/10 text-amber-600 rounded-lg flex items-center gap-1.5 disabled:opacity-40"><Ban className="w-4 h-4" /> Disable</button>
                        )}
                        <button onClick={() => moderate(detail.uid, 'delete')} disabled={modBusy || detail.isProtected} className="px-3 py-1.5 text-sm bg-red-500/10 text-red-600 rounded-lg flex items-center gap-1.5 disabled:opacity-40"><Trash2 className="w-4 h-4" /> Delete</button>
                      </div>
                      {detail.isProtected && <p className="text-[11px] text-zinc-400 mt-2">Admins/owner can't be disabled, deleted, or force-verified — revoke admin first.</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
