import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, where } from 'firebase/firestore';
import { Plus, Trash2, Receipt, TrendingUp, AlertTriangle } from 'lucide-react';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { reportError } from '../reportError';
import { ledgerFor, displayedBalances, isSettled, usableSplit, splitForGroup } from '../utils/ledger';

export default function ExpensesTab(
  { sharedUsers, myGroups = [] }: { sharedUsers: any[]; myGroups?: { id: string; name: string; members: string[] }[] },
) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // '' means personal: mine alone, wherever I am. Anything else is a group ledger.
  const [groupId, setGroupId] = useState('');
  // Who this particular cost falls on. Everyone in the group by default, which is what it
  // has always meant; the picker exists so “this one was just me and Bogdan” can be said.
  const [split, setSplit] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Every read and write on `expenses` has been denied since the Firestore rules landed on
  // 2026-05-22: the collection has no `match` block, and Firestore denies what is not explicitly
  // allowed. The tab shipped on 05-07, while the project was still in open mode, so it worked
  // once. It went unnoticed for three months because BOTH failure paths were silent — onSnapshot
  // had no error callback and the add was swallowed by `console.error`. Whatever the fix to the
  // data model turns out to be, a refusal has to be visible where it happened.
  // Two listeners, two flags: see the effect below for why one between them was a bug.
  const [ownFailed, setOwnFailed] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const loadError = ownFailed || groupsFailed;
  const [addError, setAddError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const { language } = useThemeStore();

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // TWO listeners, merged, because the rule has two branches and Firestore cannot validate a
    // single query that ORs across fields. `ownerId == me` is the personal panel; `groupId in
    // mine` is the group ledgers. An expense I paid inside a group matches both, so the merge is
    // by document id.
    const mine = new Map<string, any>();
    const theirs = new Map<string, any>();
    const publish = () => {
      const all = new Map([...mine, ...theirs]);
      setExpenses([...all.values()].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ));
    };
    // ONE flag per listener, not one between them. Shared, the healthy listener's success
    // callback called setLoadError(false) and ERASED the other's failure — so a denied group
    // query left the screen with no error at all and the balances quietly computed from half
    // the ledger. Wrong numbers with a clean screen is the worst of the three outcomes.
    const down = { own: false, groups: false };
    const settle = () => { setOwnFailed(down.own); setGroupsFailed(down.groups); };
    const ok = (which: 'own' | 'groups') => { down[which] = false; settle(); };
    const fail = (which: 'own' | 'groups') => (err: any) => {
      // An empty list and a denied list look identical on screen. They are not.
      down[which] = true;
      settle();
      reportError(err?.message || 'expenses snapshot failed', { context: `ExpensesTab.${which}` });
    };

    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', uid)),
      (snap) => { mine.clear(); snap.docs.forEach(d => mine.set(d.id, { id: d.id, ...d.data() })); ok('own'); publish(); },
      fail('own'),
    ));
    // `in` takes at most 30 values; nobody here is in thirty groups, but slicing beats throwing.
    const ids = myGroups.map(g => g.id).slice(0, 30);
    if (ids.length) {
      unsubs.push(onSnapshot(
        query(collection(db, 'expenses'), where('groupId', 'in', ids)),
        (snap) => { theirs.clear(); snap.docs.forEach(d => theirs.set(d.id, { id: d.id, ...d.data() })); ok('groups'); publish(); },
        fail('groups'),
      ));
    }
    return () => unsubs.forEach(u => u());
  }, [myGroups.map(g => g.id).join(',')]);

  // Was a bare `onClick={() => deleteDoc(...)}` — not awaited, not caught, driving no state.
  // It is shaped like handleAdd above deliberately: the button renders on `paidBy === me` while
  // the rule requires `ownerId === me`, and older rows were written before `ownerId` existed, so
  // a refusal here is a REAL outcome and not a hypothetical one.
  const handleDelete = async (expenseId: string) => {
    setDeleteError(false);
    try {
      await deleteDoc(doc(db, 'expenses', expenseId));
    } catch (err) {
      setDeleteError(true);
      reportError(err instanceof Error ? err.message : String(err), { context: 'ExpensesTab.deleteDoc' });
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !amount || !description) return;
    // The rules refuse an empty split and dividing a cost by nobody means nothing; the button
    // is disabled too, but a form can still be submitted with Enter.
    if (groupId && !splitOk) return;
    setLoading(true);
    setAddError(false);
    try {
      await addDoc(collection(db, 'expenses'), {
        amount: parseFloat(amount),
        description,
        paidBy: auth.currentUser.uid,
        // `ownerId` is what the rule reads, and it is pinned to the caller on create so nobody can
        // file an expense in a group ledger under someone else's name.
        ownerId: auth.currentUser.uid,
        groupId: groupId || null,
        // WHO this is split among, recorded now rather than inferred later. Without it the
        // whole history was re-divided by today's membership: somebody joining on Friday
        // shared Tuesday's dinner, and somebody leaving made everyone else's debts grow
        // overnight with nothing recorded anywhere. Andrei's call, 16.09.2026.
        //
        // Everyone in the group at this moment, which is what the split has always meant —
        // the change is that it is now FIXED at that meaning instead of following the roster.
        // Personal expenses carry none: nobody shares them.
        ...(groupId ? { splitAmong: usable } : {}),
        createdAt: serverTimestamp()
      });
      setAmount('');
      setDescription('');
    } catch (err) {
      // Was `console.error` alone, which is why an Add that saved nothing looked like an Add
      // that had worked. The form deliberately keeps its values so nothing typed is lost.
      setAddError(true);
      reportError(err instanceof Error ? err.message : String(err), { context: 'ExpensesTab.addDoc' });
    }
    setLoading(false);
  };

  // Balances are computed PER GROUP, over that group's expenses only.
  //
  // Two things went wrong the moment an expense could be personal or belong to one of several
  // groups, and both were introduced by giving it a scope: a PERSONAL expense counted into the
  // shared split, so private spending looked like a debt other people owed; and with more than one
  // group, a Family expense was divided among the members of every group at once, because the
  // divisor was "everyone I share any group with".
  //
  // The arithmetic itself now lives in `src/utils/ledger.ts`, where it can be RUN. It was
  // eleven lines here, behind a login, and it was WRONG: the divisor was the group's CURRENT
  // members while the total was every expense ever filed, so the moment somebody left, their
  // spending stayed in the sum and they vanished from the division. Three people, one of whom
  // paid 300 and then left: the other two were each told they owed 150, nobody was in credit,
  // and the columns summed to -300 instead of 0. Silent, permanent, and the number people
  // settle up on.
  const ledgers = myGroups
    .map(g => {
      const mine = expenses.filter(e => e.groupId === g.id);
      const members = g.members.length ? g.members : [auth.currentUser?.uid].filter(Boolean) as string[];
      return { group: g, ledger: ledgerFor(members, mine), rows: displayedBalances(ledgerFor(members, mine)) };
    })
    .filter(l => l.ledger.count > 0);

  // Never part of a balance — nobody owes anybody for these. Counted separately so the money is
  // still visible rather than silently dropped from the screen.
  const personal = expenses.filter(e => !e.groupId);
  const personalTotal = personal.reduce((a, e) => a + (Number(e.amount) || 0), 0);

  // What will actually be stored, and whether the form may be submitted at all.
  const { split: usable, ok: splitOk } = usableSplit(
    myGroups.find(g => g.id === groupId)?.members || [],
    split,
  );

  const getUserName = (uid: string) => {
    if (uid === auth.currentUser?.uid) return t('expenseYou', language);
    return sharedUsers.find(u => u.id === uid)?.name || t('expenseSomeone', language);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      {/* When the GROUP query is the one that failed, the balances would be computed from
          whatever did load — which is not a smaller ledger, it is a wrong one. Say so
          instead of showing numbers nobody should act on. */}
      {groupsFailed ? (
        <p className="text-xs text-amber-600 font-medium">{t('expenseBalancesUnavailable', language)}</p>
      ) : ledgers.map(l => (
        <div key={l.group.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4"/> {l.group.name}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {l.rows.map(({ uid, balance }) => {
              const settled = isSettled(balance);
              return (
                <div key={uid} className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                  <p className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                    {getUserName(uid)}
                    {/* Somebody who paid into this ledger and has since left. Saying so is the
                        point: their money is still in the total, so they are still owed it. */}
                    {l.ledger.departed.includes(uid) && (
                      <span className="ml-1 text-[10px] font-normal text-zinc-400">({t('expenseFormerMember', language)})</span>
                    )}
                  </p>
                  {/* One threshold for the colour AND the sign, so a balance of -0.004 can no
                      longer be painted as settled and printed as “-0.00”. */}
                  <p className={`text-lg font-bold ${settled ? 'text-zinc-500' : balance > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {settled ? '0.00' : `${balance > 0 ? '+' : ''}${balance.toFixed(2)}`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {personalTotal > 0 && (
        <p className="text-xs text-zinc-500">
          {t('expensePersonal', language)}: <span className="font-mono">{personalTotal.toFixed(2)}</span> — {t('expensePersonalNotShared', language)}
        </p>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
        {myGroups.length > 0 && (
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              // Everyone in the NEW group, ticked. Carrying the old ticks across would name
              // people who are not in it — which the rules refuse, so the write would fail
              // with a message about a field nobody had seen.
              setSplit(splitForGroup(myGroups.find(g => g.id === e.target.value)?.members || []));
            }}
            aria-label={t('expenseLedgerLabel', language)}
            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          >
            {/* Personal is the default because it is the safe one: a personal expense is seen by
                nobody else, and putting it in a group is a deliberate act. */}
            <option value="">{t('expensePersonal', language)}</option>
            {myGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        <input 
          type="text" 
          placeholder={t('expenseWhatFor', language)} 
          value={description} 
          onChange={e => setDescription(e.target.value)} 
          required 
          className="flex-1 px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-800 outline-none focus:border-emerald-500" 
        />
        <input 
          type="number" 
          placeholder={t('expenseAmount', language)} 
          value={amount} 
          onChange={e => setAmount(e.target.value)} 
          required 
          min="0.01" 
          step="0.01" 
          className="w-24 px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-800 outline-none focus:border-emerald-500" 
        />
        <button aria-label={t('addExpenseAction', language)} type="submit" disabled={loading || (!!groupId && !splitOk)} className="px-4 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center">
          <Plus className="w-5 h-5"/>
        </button>
        {/* The picker. Only for a group expense — nobody shares a personal one. */}
        {groupId && (
          <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-zinc-500 mr-1">{t('expenseSplitBetween', language)}</span>
            {(myGroups.find(g => g.id === groupId)?.members || []).map(uid => {
              const on = split.includes(uid);
              return (
                <button
                  key={uid}
                  type="button"
                  aria-pressed={on}
                  // Functional update: two taps inside one React batch both read the same
                  // captured `split` otherwise, and the second silently undoes the first.
                  // The bench caught exactly that — two chips tapped quickly, one toggle lost.
                  onClick={() => setSplit(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-700'}`}
                >
                  {getUserName(uid)}
                </button>
              );
            })}
            {/* Said out loud rather than silently turning “nobody” back into “everyone”, which
                is the opposite of what the person just asked for. */}
            {!splitOk && <span className="text-xs text-amber-600">{t('expenseSplitNobody', language)}</span>}
          </div>
        )}
      </form>

      {/* At the control that refused, not in a console nobody opens. */}
      {deleteError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('expenseDeleteFailed', language)}</span>
        </p>
      )}

      {addError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('expensesAddFailed', language)}</span>
        </p>
      )}

      <div className="space-y-2 pb-10">
        {loadError ? (
          // An empty list and a denied list look the same. Saying which is the whole fix here.
          <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300 py-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t('expensesLoadFailed', language)}</span>
          </p>
        ) : expenses.length === 0 ? (
          <p className="text-center text-zinc-500 italic py-4">{t('expensesNone', language)}</p>
        ) : (
          expenses.map(exp => (
            <div key={exp.id} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-full">
                  <Receipt className="w-4 h-4"/>
                </div>
                <div>
                  <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{exp.description}</p>
                  <p className="text-xs text-zinc-500">
                  {t('expensePaidBy', language)} {getUserName(exp.paidBy)}
                  {/* Personal rows sit in the same list but in no balance, so they have to say
                      which they are — otherwise the totals look like they lost money. */}
                  {!exp.groupId && <> · {t('expensePersonal', language)}</>}
                  {exp.groupId && myGroups.find(g => g.id === exp.groupId)
                    && <> · {myGroups.find(g => g.id === exp.groupId)!.name}</>}
                </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-zinc-900 dark:text-white">{exp.amount.toFixed(2)}</span>
                {exp.paidBy === auth.currentUser?.uid && (
                  <button aria-label={t('deleteExpense', language)} onClick={() => handleDelete(exp.id)} className="text-red-400 hover:text-red-500 p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
                    <Trash2 className="w-4 h-4"/>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
