import React, { useState, useEffect } from 'react';
import { X, Users, AlertCircle } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useModalBack } from '../hooks/useModalBack';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateGroupModal({ isOpen, onClose }: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useModalBack(isOpen, onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !auth.currentUser) return;
    
    setLoading(true);
    setError('');

    try {
      await addDoc(collection(db, 'groups'), {
        name: name.trim(),
        ownerId: auth.currentUser.uid,
        members: [auth.currentUser.uid],
        createdAt: new Date().toISOString()
      });
      setName('');
      onClose();
    } catch (err) {
      console.error(err);
      setError('Failed to create group. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm flex flex-col max-h-[90vh] shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Create New Group
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Group Name</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Family, Roommates, Work"
              required
              className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Creating...' : 'Create Group'}
          </button>
        </form>

      </div>
    </div>
  );
}
