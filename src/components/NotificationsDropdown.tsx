import { useState, useEffect, useRef } from 'react';
import { Bell, Check, Trash2, MessageCircle, UserPlus } from 'lucide-react';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';

export default function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(n => {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    });
    await batch.commit();
  };

  const deleteNotification = async (id: string) => {
    await deleteDoc(doc(db, 'notifications', id));
  };

  const getIcon = (type: string) => {
    switch(type) {
      case 'chat': return <MessageCircle className="w-4 h-4 text-blue-500" />;
      case 'invite': return <UserPlus className="w-4 h-4 text-emerald-500" />;
      case 'task': return <Check className="w-4 h-4 text-amber-500" />;
      default: return <Bell className="w-4 h-4 text-zinc-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors relative"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white dark:border-zinc-900"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 z-50 overflow-hidden flex flex-col max-h-[400px]">
          <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="text-xs text-primary hover:underline font-medium">
                Mark all read
              </button>
            )}
          </div>
          
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">
                No notifications yet.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {notifications.map(n => (
                  <div key={n.id} className={`p-3 flex gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${!n.read ? 'bg-primary/5 dark:bg-primary/5' : ''}`}>
                    <div className="mt-0.5 shrink-0">
                      {getIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0" onClick={() => !n.read && markAsRead(n.id)}>
                      <p className={`text-sm ${!n.read ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-zinc-500 line-clamp-2 mt-0.5">{n.body}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                      className="shrink-0 p-1 text-zinc-400 hover:text-red-500 transition-colors self-start"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
