import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Image as ImageIcon, Check, CheckCheck } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, doc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';

interface GroupChatWidgetProps {
  groupId: string;
  groupName: string;
  userMap: Record<string, any>;
  groupMembers?: string[];
}

export default function GroupChatWidget({ groupId, groupName, userMap, groupMembers = [] }: GroupChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastRead, setLastRead] = useState<number>(Date.now());

  // Other members in the group (excluding me)
  const otherMemberIds = groupMembers.filter(id => id !== auth.currentUser?.uid);

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, `groups/${groupId}/messages`),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setMessages(fetchedMessages);

      if (!isOpen) {
        const unread = fetchedMessages.filter(m =>
          m.createdAt &&
          m.createdAt.toMillis() > lastRead &&
          m.senderId !== auth.currentUser?.uid
        );
        setUnreadCount(unread.length);
      } else {
        setUnreadCount(0);
        setLastRead(Date.now());
      }
    });

    return () => unsubscribe();
  }, [groupId, isOpen]);

  // Mark messages as seen when chat opens
  useEffect(() => {
    if (!isOpen || !auth.currentUser || messages.length === 0) return;

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
    setLastRead(Date.now());

    // Batch-mark all messages I haven't seen yet
    const myUid = auth.currentUser.uid;
    const unseen = messages.filter(m =>
      m.senderId !== myUid &&
      (!m.seenBy || !m.seenBy.includes(myUid))
    );

    if (unseen.length > 0) {
      const batch = writeBatch(db);
      unseen.forEach(m => {
        batch.update(doc(db, `groups/${groupId}/messages`, m.id), {
          seenBy: arrayUnion(myUid)
        });
      });
      batch.commit().catch(console.error);
    }
  }, [messages, isOpen]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !imageFile) || !auth.currentUser) return;

    setUploading(true);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const fileRef = ref(storage, `chat-images/${groupId}/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);
      }

      // Also mark all prior messages as seen when user sends (they clearly saw them)
    const myUid = auth.currentUser.uid;
    const unseenByMe = messages.filter(m =>
      m.senderId !== myUid &&
      (!m.seenBy || !m.seenBy.includes(myUid))
    );
    if (unseenByMe.length > 0) {
      const batch = writeBatch(db);
      unseenByMe.forEach(m => {
        batch.update(doc(db, `groups/${groupId}/messages`, m.id), {
          seenBy: arrayUnion(myUid)
        });
      });
      batch.commit().catch(console.error);
    }

    await addDoc(collection(db, `groups/${groupId}/messages`), {
        text: newMessage.trim() || null,
        imageUrl: imageUrl || null,
        senderId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        seenBy: [auth.currentUser.uid]
      });

      setNewMessage('');
      clearImage();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setUploading(false);
    }
  };

  const getSeenStatus = (msg: any) => {
    if (msg.senderId !== auth.currentUser?.uid) return null;

    const myMsgTime = msg.createdAt?.toMillis?.() ?? 0;

    // Primary: if ANY other member sent a message AFTER this one, they clearly read it
    const seenByReply = messages.some(m =>
      m.senderId !== auth.currentUser?.uid &&
      (m.createdAt?.toMillis?.() ?? 0) > myMsgTime
    );
    if (seenByReply) return 'seen';

    // Fallback: explicit seenBy array
    if (msg.seenBy && msg.seenBy.length > 1) {
      const allSeen = otherMemberIds.length > 0 && otherMemberIds.every((id: string) => msg.seenBy.includes(id));
      return allSeen ? 'seen' : 'delivered';
    }

    return 'sent';
  };

  return (
    <div className="fixed bottom-[104px] right-8 z-40 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-80 sm:w-96 h-[450px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-3 bg-primary flex items-center justify-between shrink-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm">Group Chat · {groupName}</h3>
              {/* Member avatars */}
              <div className="flex items-center gap-1 mt-1">
                {groupMembers.map(memberId => {
                  const member = userMap[memberId];
                  if (!member) return null;
                  return (
                    <div
                      key={memberId}
                      title={member.name || member.email?.split('@')[0]}
                      className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center overflow-hidden border border-white/30 shrink-0"
                    >
                      {member.photoURL ? (
                        <img src={member.photoURL} alt={member.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[8px] font-bold">
                          {(member.name || member.email || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-black/10 rounded-full transition-colors ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
            {messages.length === 0 ? (
              <p className="text-center text-xs text-zinc-400 mt-10">Start the conversation!</p>
            ) : (
              messages.map(msg => {
                const isMe = msg.senderId === auth.currentUser?.uid;
                const sender = userMap[msg.senderId] || { name: 'Unknown' };
                const status = getSeenStatus(msg);

                return (
                  <div key={msg.id} className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
                    {!isMe && (
                      <span className="text-[10px] text-zinc-500 ml-1 mb-0.5">
                        {sender.name || sender.email?.split('@')[0]}
                      </span>
                    )}
                    <div className={`rounded-2xl text-sm overflow-hidden ${isMe ? 'bg-primary rounded-br-sm' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-sm'}`}>
                      {msg.imageUrl && (
                        <img
                          src={msg.imageUrl}
                          alt="Shared image"
                          className="max-w-full rounded-t-xl object-cover max-h-48 w-full"
                          onClick={() => window.open(msg.imageUrl, '_blank')}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                      {msg.text && (
                        <p className="px-3 py-2">{msg.text}</p>
                      )}
                    </div>
                    {/* Sent/Seen indicator */}
                    {isMe && status && (
                      <div className="flex items-center gap-0.5 mt-0.5 mr-1">
                        {status === 'seen' ? (
                          <CheckCheck className="w-3 h-3 text-blue-400" />
                        ) : (
                          <Check className="w-3 h-3 text-zinc-400" />
                        )}
                        <span className="text-[9px] text-zinc-400">
                          {status === 'seen' ? 'Seen' : 'Sent'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Image Preview */}
          {imagePreview && (
            <div className="px-3 pt-2 shrink-0 relative w-fit ml-3">
              <img src={imagePreview} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700" />
              <button
                type="button"
                onClick={clearImage}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold"
              >
                ×
              </button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSend} className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex gap-2 items-center shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              id="chat-image-upload"
              onChange={handleImageChange}
            />
            <label
              htmlFor="chat-image-upload"
              className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0 text-zinc-500"
            >
              <ImageIcon className="w-4 h-4" />
            </label>
            <input
              type="text"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-none rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="submit"
              disabled={(!newMessage.trim() && !imageFile) || uploading}
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
            >
              {uploading
                ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Send className="w-4 h-4 ml-0.5" />
              }
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
