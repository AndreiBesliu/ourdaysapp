import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Image as ImageIcon, Check, CheckCheck, Reply, Pencil, Trash2, Ban } from 'lucide-react';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, doc, arrayUnion, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { playTone } from '../utils/sounds';
import { triggerHaptic } from '../utils/haptics';

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
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeReactionMsg, setActiveReactionMsg] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [editingMsg, setEditingMsg] = useState<any | null>(null);

  const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

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

    // Listen to typing status
    const typingQuery = query(collection(db, `groups/${groupId}/typing`));
    const unsubTyping = onSnapshot(typingQuery, (snapshot) => {
      const currentlyTyping: string[] = [];
      const now = Date.now();
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Only show typing if updated within last 5 seconds
        if (docSnap.id !== auth.currentUser?.uid && data.updatedAt && (now - data.updatedAt.toMillis()) < 5000) {
          currentlyTyping.push(docSnap.id);
        }
      });
      setTypingUsers(currentlyTyping);
    });

    return () => {
      unsubscribe();
      unsubTyping();
    };
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

  // ESC key: cancel editing or replying
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMsg) {
          setEditingMsg(null);
          setNewMessage('');
        } else if (replyingTo) {
          setReplyingTo(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingMsg, replyingTo]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!auth.currentUser) return;
    
    // Set typing to true
    setDoc(doc(db, `groups/${groupId}/typing`, auth.currentUser.uid), {
      updatedAt: serverTimestamp()
    }).catch(console.error);

    // Clear typing after 3 seconds of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      deleteDoc(doc(db, `groups/${groupId}/typing`, auth.currentUser!.uid)).catch(console.error);
    }, 3000);
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

      if (editingMsg) {
        await updateDoc(doc(db, `groups/${groupId}/messages`, editingMsg.id), {
          text: newMessage.trim() || null,
          imageUrl: imageUrl || editingMsg.imageUrl || null,
          isEdited: true
        });
        setEditingMsg(null);
      } else {
        await addDoc(collection(db, `groups/${groupId}/messages`), {
          text: newMessage.trim() || null,
          imageUrl: imageUrl || null,
          senderId: auth.currentUser.uid,
          createdAt: serverTimestamp(),
          seenBy: [auth.currentUser.uid],
          replyToId: replyingTo ? replyingTo.id : null,
          isDeleted: false,
          isEdited: false
        });
      }

      playTone('click');
      triggerHaptic('light');

      setNewMessage('');
      clearImage();
      setReplyingTo(null);
      
      // Stop typing indicator immediately when sending
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      deleteDoc(doc(db, `groups/${groupId}/typing`, auth.currentUser.uid)).catch(console.error);
      
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (msgId: string) => {
    if (confirm("Are you sure you want to delete this message?")) {
      await updateDoc(doc(db, `groups/${groupId}/messages`, msgId), {
        isDeleted: true,
        text: null,
        imageUrl: null
      });
    }
  };

  const startEditing = (msg: any) => {
    setEditingMsg(msg);
    setNewMessage(msg.text || '');
    setReplyingTo(null);
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

    // Secondary: If ANY message AFTER this one is considered "seen", then this one is also seen
    const seenBySubsequent = messages.some(m => {
      const time = m.createdAt?.toMillis?.() ?? 0;
      if (time <= myMsgTime) return false;
      if (m.seenBy && m.seenBy.length > 1 && otherMemberIds.length > 0) {
        return otherMemberIds.every((id: string) => m.seenBy.includes(id));
      }
      return false;
    });
    if (seenBySubsequent) return 'seen';

    // Fallback: explicit seenBy array
    if (msg.seenBy && msg.seenBy.length > 1) {
      const allSeen = otherMemberIds.length > 0 && otherMemberIds.every((id: string) => msg.seenBy.includes(id));
      return allSeen ? 'seen' : 'delivered';
    }

    return 'sent';
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !auth.currentUser) return;
    
    const currentReactions = msg.reactions || {};
    let usersForEmoji = currentReactions[emoji] || [];
    
    const uid = auth.currentUser.uid;
    if (usersForEmoji.includes(uid)) {
      usersForEmoji = usersForEmoji.filter((id: string) => id !== uid);
    } else {
      usersForEmoji = [...usersForEmoji, uid];
    }
    
    const newReactions = { ...currentReactions };
    if (usersForEmoji.length === 0) {
      delete newReactions[emoji];
    } else {
      newReactions[emoji] = usersForEmoji;
    }
    
    await updateDoc(doc(db, `groups/${groupId}/messages`, msgId), {
      reactions: newReactions
    });
    setActiveReactionMsg(null);
  };

  return (
    <div className="fixed bottom-[104px] right-4 sm:right-8 z-40 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-[calc(100vw-2rem)] sm:w-96 h-[60vh] sm:h-[450px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
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
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
            {messages.length === 0 ? (
              <p className="text-center text-xs text-zinc-400 mt-10">Start the conversation!</p>
            ) : (
              messages.map((msg, index) => {
                const isMe = msg.senderId === auth.currentUser?.uid;
                const sender = userMap[msg.senderId] || { name: 'Unknown' };
                const status = getSeenStatus(msg);
                const parentMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
                const msgDate = msg.createdAt ? msg.createdAt.toDate() : new Date();
                const prevMsg = index > 0 ? messages[index - 1] : null;
                const prevDate = prevMsg?.createdAt ? prevMsg.createdAt.toDate() : null;
                
                const showDateSeparator = !prevDate || !isSameDay(msgDate, prevDate);
                let dateLabel = '';
                if (showDateSeparator) {
                  if (isToday(msgDate)) dateLabel = 'Today';
                  else if (isYesterday(msgDate)) dateLabel = 'Yesterday';
                  else dateLabel = format(msgDate, 'MMMM d, yyyy');
                }

                return (
                  <React.Fragment key={msg.id}>
                    {showDateSeparator && (
                      <div className="flex justify-center my-4">
                        <span className="px-3 py-1 bg-zinc-200 dark:bg-zinc-800 text-[10px] uppercase font-bold text-zinc-500 rounded-full">
                          {dateLabel}
                        </span>
                      </div>
                    )}
                    <div 
                      className={`flex flex-col max-w-[80%] relative group ${isMe ? 'self-end items-end' : 'self-start items-start'}`}
                    onMouseLeave={() => setActiveReactionMsg(null)}
                  >
                    <div className={`flex items-center gap-1.5 text-[10px] text-zinc-500 mb-0.5 px-1 w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && (
                        <span className="font-medium">
                          {sender.name || sender.email?.split('@')[0]}
                        </span>
                      )}
                      {!isMe && <span>•</span>}
                      <span>{format(msgDate, 'HH:mm')}</span>
                      {isMe && status && (
                        <div 
                          className="flex items-center ml-0.5"
                          title={status === 'seen' && msg.seenBy ? msg.seenBy.filter((id: string) => id !== auth.currentUser?.uid).map((id: string) => userMap[id]?.name || userMap[id]?.email?.split('@')[0] || 'Unknown').join(', ') : ''}
                        >
                          {status === 'seen' ? (
                            <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="relative w-full flex flex-col gap-1">
                      <div className={`rounded-2xl text-sm flex flex-col w-fit max-w-full relative ${isMe ? 'bg-primary rounded-br-sm self-end' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-sm self-start'}`}
                           onDoubleClick={() => !msg.isDeleted && handleReaction(msg.id, '❤️')}
                      >
                      {msg.isDeleted ? (
                        <div className="px-3 py-2 text-zinc-500/80 italic flex items-center gap-1.5 text-xs">
                          <Ban className="w-3.5 h-3.5" />
                          This message was deleted
                        </div>
                      ) : (
                        <>
                          {parentMsg && (
                            <div 
                              className={`px-3 py-2 text-xs border-b border-black/10 dark:border-white/10 opacity-80 cursor-pointer hover:opacity-100 transition-opacity ${isMe ? 'bg-black/5' : 'bg-zinc-100 dark:bg-zinc-700/50'}`}
                            >
                              <p className="font-semibold">{parentMsg.senderId === auth.currentUser?.uid ? 'You' : (userMap[parentMsg.senderId]?.name || userMap[parentMsg.senderId]?.email?.split('@')[0] || 'Unknown')}</p>
                              <p className="truncate line-clamp-1">{parentMsg.isDeleted ? 'Deleted message' : (parentMsg.text || 'Photo')}</p>
                            </div>
                          )}
                          <div className="overflow-hidden rounded-b-2xl">
                            {msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className={`max-w-full object-cover max-h-48 w-full ${!parentMsg && 'rounded-t-2xl'}`}
                                onClick={() => window.open(msg.imageUrl, '_blank')}
                                style={{ cursor: 'pointer' }}
                              />
                            )}
                            {msg.text && (
                              <p className="px-3 py-2 text-left whitespace-pre-wrap break-words">
                                {msg.text}
                                {msg.isEdited && <span className="text-[10px] italic opacity-60 ml-2">(edited)</span>}
                              </p>
                            )}
                          </div>
                        </>
                      )}
                      </div>

                      {/* Interaction Buttons (Floating) */}
                      {!msg.isDeleted && (
                        <div className={`absolute -top-4 ${isMe ? 'right-2' : 'left-2'} flex items-center opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm rounded-full px-1 z-10`}>
                          {isMe && (
                            <>
                              <button
                                onClick={() => handleDelete(msg.id)}
                                className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full shrink-0"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => startEditing(msg)}
                                className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setReplyingTo(msg)}
                            className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                            title="Reply"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setActiveReactionMsg(activeReactionMsg === msg.id ? null : msg.id)}
                            className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                            title="Add reaction"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/><path d="M8 14C8 14 9.5 16 12 16C14.5 16 16 14 16 14"/><path d="M9 9H9.01"/><path d="M15 9H15.01"/></svg>
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {/* Reactions Display */}
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        {Object.entries(msg.reactions).map(([emoji, users]: [string, any]) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(msg.id, emoji)}
                            className={`px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-1 border ${
                              users.includes(auth.currentUser?.uid) 
                                ? 'bg-primary/20 border-primary/30 text-primary' 
                                : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                            }`}
                            title={users.map((uid: string) => uid === auth.currentUser?.uid ? 'You' : (userMap[uid]?.name || userMap[uid]?.email?.split('@')[0] || 'Someone')).join(', ')}
                          >
                            <span>{emoji}</span>
                            <span className="font-medium">{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Active Reaction Picker */}
                    {activeReactionMsg === msg.id && (
                      <div className={`absolute z-10 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-full px-2 py-1 flex items-center gap-1 -mt-8 ${isMe ? 'right-0' : 'left-0'}`}>
                        {EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(msg.id, emoji)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-full transition-all hover:scale-125"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </React.Fragment>
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

          {/* Typing Indicator */}
          {typingUsers.length > 0 && (
            <div className="px-4 py-1 pb-2 bg-zinc-50/50 dark:bg-zinc-900/50">
              <span className="text-[10px] text-zinc-500 italic animate-pulse">
                {typingUsers.map(id => userMap[id]?.name?.split(' ')[0] || 'Someone').join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </span>
            </div>
          )}

          {/* Reply Banner */}
          {replyingTo && (
            <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <Reply className="w-4 h-4 text-primary shrink-0" />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[10px] font-bold text-primary">Replying to {replyingTo.senderId === auth.currentUser?.uid ? 'You' : (userMap[replyingTo.senderId]?.name || userMap[replyingTo.senderId]?.email?.split('@')[0] || 'Unknown')}</span>
                  <span className="text-xs text-zinc-500 truncate">{replyingTo.text || 'Photo'}</span>
                </div>
              </div>
              <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Edit Banner */}
          {editingMsg && (
            <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <Pencil className="w-4 h-4 text-primary shrink-0" />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[10px] font-bold text-primary">Editing message</span>
                  <span className="text-xs text-zinc-500 truncate">{editingMsg.text || 'Photo'}</span>
                </div>
              </div>
              <button onClick={() => { setEditingMsg(null); setNewMessage(''); }} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 transition-colors">
                <X className="w-4 h-4" />
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
              onChange={handleTyping}
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
