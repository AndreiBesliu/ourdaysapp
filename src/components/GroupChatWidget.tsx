import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface GroupChatWidgetProps {
  groupId: string;
  groupName: string;
  userMap: Record<string, any>;
}

export default function GroupChatWidget({ groupId, groupName, userMap }: GroupChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Track last read message time (simple client-side state for now)
  const [lastRead, setLastRead] = useState<number>(Date.now());

  useEffect(() => {
    if (!groupId) return;
    
    const q = query(
      collection(db, `groups/${groupId}/messages`),
      orderBy('createdAt', 'asc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMessages(fetchedMessages);
      
      if (!isOpen) {
        // Count unread if window is closed
        const unread = fetchedMessages.filter(m => m.createdAt && m.createdAt.toMillis() > lastRead && m.senderId !== auth.currentUser?.uid);
        setUnreadCount(unread.length);
      } else {
        setUnreadCount(0);
        setLastRead(Date.now());
      }
    });

    return () => unsubscribe();
  }, [groupId, isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
      setLastRead(Date.now());
    }
  }, [messages, isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !auth.currentUser) return;
    
    const text = newMessage;
    setNewMessage('');
    
    await addDoc(collection(db, `groups/${groupId}/messages`), {
      text,
      senderId: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });
  };

  return (
    <div className="fixed bottom-[104px] right-8 z-40 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-80 sm:w-96 h-[400px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="p-3 bg-primary text-white flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm">Group Chat</h3>
              <p className="text-[10px] opacity-80">{groupName}</p>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-zinc-50/50 dark:bg-zinc-900">
            {messages.length === 0 ? (
              <p className="text-center text-xs text-zinc-400 mt-10">Start the conversation!</p>
            ) : (
              messages.map(msg => {
                const isMe = msg.senderId === auth.currentUser?.uid;
                const sender = userMap[msg.senderId] || { name: 'Unknown' };
                
                return (
                  <div key={msg.id} className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
                    {!isMe && <span className="text-[10px] text-zinc-500 ml-1 mb-0.5">{sender.name || sender.email?.split('@')[0]}</span>}
                    <div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-primary text-white rounded-br-sm' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Input */}
          <form onSubmit={handleSend} className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-none rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button 
              type="submit" 
              disabled={!newMessage.trim()}
              className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-50 hover:bg-primary/90 transition-colors shrink-0"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </form>
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-12 h-12 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-primary rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 relative"
      >
        <MessageCircle className="w-6 h-6" />
        {unreadCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-zinc-800">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
