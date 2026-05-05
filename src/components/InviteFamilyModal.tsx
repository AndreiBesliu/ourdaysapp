import { useState, useEffect } from 'react';
import { X, UserPlus, Mail, AlertCircle, CheckCircle2, Share2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { useModalBack } from '../hooks/useModalBack';

interface InviteFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId?: string;
  groupName?: string;
}

export default function InviteFamilyModal({ isOpen, onClose, groupId, groupName }: InviteFamilyModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useModalBack(isOpen, onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !auth.currentUser) return;

    if (email.toLowerCase() === auth.currentUser.email?.toLowerCase()) {
      setError("You cannot invite yourself.");
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // 1. Find user by email (Optional now)
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);

      const familyMemberId = querySnapshot.empty ? null : querySnapshot.docs[0].id;

      // 2. Create pending group invite
      await addDoc(collection(db, 'group_invites'), {
        fromId: auth.currentUser.uid,
        fromEmail: auth.currentUser.email,
        toId: familyMemberId,
        toEmail: email.toLowerCase(),
        groupId: groupId || null,
        groupName: groupName || null,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      if (querySnapshot.empty) {
        setSuccess(`Invite sent! They will see it when they sign up with ${email}.`);
      } else {
        setSuccess(`Invite sent to ${email}!`);
      }
      
      // Removed auto-close so they have time to click Share

    } catch (err: any) {
      console.error("Invite error:", err);
      setError("Failed to invite user. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    const text = `Hey! I've invited you to join my group "${groupName || 'Group'}" on Our Days.\n\nSign up or log in at https://our-days-2a939.web.app with your email to accept the invite!`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my group on Our Days',
          text: text,
        });
      } catch (err) {
        console.error('Error sharing', err);
      }
    } else {
      navigator.clipboard.writeText(text);
      alert('Invite text copied to clipboard!');
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm flex flex-col max-h-[90vh] shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Invite to {groupName || 'Group'}
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleInvite} className="p-6 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter the email address of the person you want to invite. They can sign up later if they don't have an account yet.
          </p>

          <div className="relative">
            <Mail className="absolute left-3 top-2.5 w-5 h-5 text-zinc-400" />
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Member's email address"
              required
              className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="flex flex-col gap-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{success}</p>
              </div>
              <button
                type="button"
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors font-medium text-sm"
              >
                <Share2 className="w-4 h-4" />
                Share via WhatsApp / SMS
              </button>
              <button
                type="button"
                onClick={() => { setSuccess(''); setEmail(''); onClose(); }}
                className="w-full text-center text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 mt-2"
              >
                Done
              </button>
            </div>
          )}

          {!success && (
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Inviting...' : 'Send Invite'}
            </button>
          )}
        </form>

      </div>
    </div>
  );
}
