import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, where } from 'firebase/firestore';
import { Plus, Trash2, Receipt, TrendingUp, AlertTriangle } from 'lucide-react';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { reportError } from '../reportError';

export default function ExpensesTab(
  { sharedUsers, myGroups = [] }: { sharedUsers: any[]; myGroups?: { id: string; name: string }[] },
) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // '' means personal: mine alone, wherever I am. Anything else is a group ledger.
  const [groupId, setGroupId] = useState('');
  const [loading, setLoading] = useState(false);
  // Every read and write on `expenses` has been denied since the Firestore rules landed on
  // 2026-05-22: the collection has no `match` block, and Firestore denies what is not explicitly
  // allowed. The tab shipped on 05-07, while the project was still in open mode, so it worked
  // once. It went unnoticed for three months because BOTH failure paths were silent — onSnapshot
  // had no error callback and the add was swallowed by `console.error`. Whatever the fix to the
  // data model turns out to be, a refusal has to be visible where it happened.
  const [loadError, setLoadError] = useState(false);
  const [addError, setAddError] = useState(false);
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
    const fail = (where: string) => (err: any) => {
      // An empty list and a denied list look identical on screen. They are not.
      setLoadError(true);
      reportError(err?.message || 'expenses snapshot failed', { context: `ExpensesTab.${where}` });
    };

    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', uid)),
      (snap) => { mine.clear(); snap.docs.forEach(d => mine.set(d.id, { id: d.id, ...d.data() })); setLoadError(false); publish(); },
      fail('own'),
    ));
    // `in` takes at most 30 values; nobody here is in thirty groups, but slicing beats throwing.
    const ids = myGroups.map(g => g.id).slice(0, 30);
    if (ids.length) {
      unsubs.push(onSnapshot(
        query(collection(db, 'expenses'), where('groupId', 'in', ids)),
        (snap) => { theirs.clear(); snap.docs.forEach(d => theirs.set(d.id, { id: d.id, ...d.data() })); setLoadError(false); publish(); },
        fail('groups'),
      ));
    }
    return () => unsubs.forEach(u => u());
  }, [myGroups.map(g => g.id).join(',')]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !amount || !description) return;
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

  const totalPeople = sharedUsers.length + 1; // plus current user
  
  const paidTotals: Record<string, number> = {};
  expenses.forEach(exp => {
     paidTotals[exp.paidBy] = (paidTotals[exp.paidBy] || 0) + exp.amount;
  });

  const totalSpent = Object.values(paidTotals).reduce((a, b) => a + b, 0);
  const averagePerPerson = totalPeople > 0 ? totalSpent / totalPeople : 0;

  const getUserName = (uid: string) => {
    if (uid === auth.currentUser?.uid) return 'You';
    return sharedUsers.find(u => u.id === uid)?.name || 'Someone';
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4"/> Group Balances
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[auth.currentUser?.uid, ...sharedUsers.map(u => u.id)].filter(Boolean).map(uid => {
            const paid = paidTotals[uid!] || 0;
            const balance = paid - averagePerPerson;
            return (
              <div key={uid} className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                <p className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">{getUserName(uid!)}</p>
                <p className={`text-lg font-bold ${balance > 0 ? 'text-emerald-500' : balance < 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                  {balance > 0 ? '+' : ''}{balance.toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
        {myGroups.length > 0 && (
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            aria-label="Whose ledger this expense belongs to"
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
          placeholder="What was it for? (e.g., Groceries)" 
          value={description} 
          onChange={e => setDescription(e.target.value)} 
          required 
          className="flex-1 px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-800 outline-none focus:border-emerald-500" 
        />
        <input 
          type="number" 
          placeholder="Amount" 
          value={amount} 
          onChange={e => setAmount(e.target.value)} 
          required 
          min="0.01" 
          step="0.01" 
          className="w-24 px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-800 outline-none focus:border-emerald-500" 
        />
        <button type="submit" disabled={loading} className="px-4 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center">
          <Plus className="w-5 h-5"/>
        </button>
      </form>

      {/* At the control that refused, not in a console nobody opens. */}
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
          <p className="text-center text-zinc-500 italic py-4">No expenses recorded yet.</p>
        ) : (
          expenses.map(exp => (
            <div key={exp.id} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-full">
                  <Receipt className="w-4 h-4"/>
                </div>
                <div>
                  <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{exp.description}</p>
                  <p className="text-xs text-zinc-500">Paid by {getUserName(exp.paidBy)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-zinc-900 dark:text-white">{exp.amount.toFixed(2)}</span>
                {exp.paidBy === auth.currentUser?.uid && (
                  <button onClick={() => deleteDoc(doc(db, 'expenses', exp.id))} className="text-red-400 hover:text-red-500 p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
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
