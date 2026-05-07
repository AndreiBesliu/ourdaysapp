import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { Plus, Trash2, Receipt, TrendingUp } from 'lucide-react';

export default function ExpensesTab({ sharedUsers }: { sharedUsers: any[] }) {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !amount || !description) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        amount: parseFloat(amount),
        description,
        paidBy: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
      setAmount('');
      setDescription('');
    } catch (err) {
      console.error(err);
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

      <form onSubmit={handleAdd} className="flex gap-2">
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

      <div className="space-y-2 pb-10">
        {expenses.length === 0 ? (
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
