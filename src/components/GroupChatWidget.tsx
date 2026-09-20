import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Image as ImageIcon, Check, CheckCheck, Reply, Pencil, Trash2, Ban, Pin, Search, Mic, ChevronUp, ChevronDown, Play, Pause, Sparkles } from 'lucide-react';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { collection, query, orderBy, addDoc, serverTimestamp, writeBatch, doc, arrayUnion, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { liveQuery } from '../utils/liveQuery';
import { reportError } from '../reportError';
import { uploadFile } from '../utils/uploadFile';
import { db, auth } from '../firebase';
import { playTone } from '../utils/sounds';
import { triggerHaptic } from '../utils/haptics';
import { generateGroupDigestAI } from '../ai';
import { t, getDateLocale } from '../utils/i18n';
import { useThemeStore } from '../store';
import { dialogDepth } from '../utils/dialogStack';
import { useMenu } from '../hooks/useMenu';


export type ConversationKind = 'group' | 'chat';

interface GroupChatWidgetProps {
  /** Group id, or direct-chat id. */
  convId: string;
  /**
   * Which collection it lives in. A direct chat is deliberately NOT a two-person group — see
   * `functions/src/directChat.ts` — but its message subcollection has the same shape, so
   * everything below this line is identical for both.
   */
  convKind: ConversationKind;
  title: string;
  userMap: Record<string, any>;
  members?: string[];
  /**
   * Render inside a screen instead of as a floating widget: no fixed positioning, no launcher
   * button, always open, filling whatever it is put in.
   */
  embedded?: boolean;
  /** Shown as a back/close control when embedded (the mobile chat view uses it). */
  onClose?: () => void;
}

// Audio Player sub-component for voice messages
function AudioPlayer({ src, isMe }: { src: string; isMe: boolean }) {
  const { language } = useThemeStore();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    });
    audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); });

    return () => { audio.pause(); audio.src = ''; };
  }, [src]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 min-w-[180px] ${isMe ? 'text-white' : 'text-zinc-700 dark:text-zinc-200'}`}>
      <button aria-label={playing ? t('pauseVoiceMessage', language) : t('playVoiceMessage', language)} onClick={toggle} className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${isMe ? 'bg-white/20 hover:bg-white/30' : 'bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600'}`}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className={`h-1 rounded-full overflow-hidden ${isMe ? 'bg-white/20' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
          <div
            className={`h-full rounded-full transition-all ${isMe ? 'bg-white/80' : 'bg-primary'}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-[10px] opacity-70">
          {duration > 0 ? formatTime(playing ? (audioRef.current?.currentTime || 0) : duration) : '...'}
        </span>
      </div>
    </div>
  );
}

export default function GroupChatWidget({
  convId, convKind, title, userMap, members = [], embedded = false, onClose,
}: GroupChatWidgetProps) {
  // One place the collection is chosen. Every path below is built from this, so a direct chat and
  // a group differ in exactly one line.
  const basePath = convKind === 'group' ? `groups/${convId}` : `chats/${convId}`;
  const { language } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);
  // Embedded in a screen there is nothing to open or close: the pane IS the screen.
  const open = embedded || isOpen;
  const [messages, setMessages] = useState<any[]>([]);
  const [chatLoadError, setChatLoadError] = useState(false);
  // The recorded blob lives in a ref and nowhere else. Losing it is losing the message, so a
  // failed upload has to be visible AND recoverable rather than just visible.
  const [voiceSendFailed, setVoiceSendFailed] = useState(false);
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

  // Pinned Messages
  const [showAllPinned, setShowAllPinned] = useState(false);

  // Search
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Voice Messages
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AI Digest
  const [isGeneratingDigest, setIsGeneratingDigest] = useState(false);
  const [digestText, setDigestText] = useState<string | null>(null);
  const [digestTruncated, setDigestTruncated] = useState(false);
  const [digestError, setDigestError] = useState(false);

  const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  /**
   * Escape peels one layer off the composer. Returns whether it found one — the caller decides
   * what "nothing left" means, and it means different things in the two modes: the floating pane
   * closes, the embedded screen stays, because there it IS the screen.
   */
  const dismissChatLayer = () => {
    if (editingMsg) {
      setEditingMsg(null);
      setNewMessage('');
      return true;
    }
    if (replyingTo) {
      setReplyingTo(null);
      return true;
    }
    // The search bar is a layer too. It used to close itself from the input's own onKeyDown, which
    // did not stop the key propagating — so once the pane started answering Escape, ONE press
    // closed the search AND the whole conversation. Owned here instead, in the same order as
    // everything else that can be peeled off.
    if (isSearchOpen) {
      setIsSearchOpen(false);
      setSearchQuery('');
      return true;
    }
    return false;
  };

  // The floating pane. Not a menu and not quite a dialog: the calendar behind it stays usable, so
  // it must not claim `aria-modal`, and a stray tap on the page must NOT dismiss it — that would
  // take a half-typed message off the screen. What it does get is Escape that peels one layer at a
  // time and an Android back button that closes the pane instead of leaving the calendar entirely.
  const chatPane = useMenu(open && !embedded, () => setIsOpen(false), {
    kind: 'popover',
    label: title,
    dismissOnOutsideClick: false,
    history: true,
    // Focus moves into the pane. It is rendered BEFORE its own launcher in the DOM, so a keyboard
    // user pressing Tab from that button lands past the pane rather than in it — the panel would
    // be announced as openable and then be unreachable except by Shift+Tab. (An earlier version
    // left this off in case the pane opened by itself; it does not — `setIsOpen(true)` happens
    // only from the launcher.)
    onEscape: () => { if (!dismissChatLayer()) setIsOpen(false); },
  });

  // One picker is rendered at a time — the message whose id is in `activeReactionMsg` — so one
  // hook covers all of them. Horizontal, because the row of emoji runs that way.
  const reactionPicker = useMenu(activeReactionMsg !== null, () => setActiveReactionMsg(null), {
    orientation: 'horizontal',
    label: t('addReactionTooltip', language),
  });

  // Other members in the group (excluding me)
  const otherMemberIds = members.filter(id => id !== auth.currentUser?.uid);

  useEffect(() => {
    if (!convId) return;

    const q = query(
      collection(db, `${basePath}/messages`),
      orderBy('createdAt', 'asc')
    );

    // An unreadable conversation and an empty one look the same, and in a chat that is the
    // difference between "nobody has written" and "you are not seeing what they wrote".
    const unsubscribe = liveQuery<any>(q, 'GroupChatWidget.messages', (fetchedMessages) => {
      setChatLoadError(false);
      setMessages(fetchedMessages);

      if (!open) {
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
    }, () => setChatLoadError(true));

    // Listen to typing status
    const typingQuery = query(collection(db, `${basePath}/typing`));
    // Typing dots are the one listener here with nothing to show on failure: an absent dot and a
    // broken dot look the same to a reader and neither is a lie. It still reports, so the pattern
    // stays uniform and the admin log sees it if the whole subcollection is denied.
    const unsubTyping = liveQuery<any>(typingQuery, 'GroupChatWidget.typing', (docs) => {
      const now = Date.now();
      setTypingUsers(docs
        .filter((d: any) => d.id !== auth.currentUser?.uid && d.updatedAt && (now - d.updatedAt.toMillis()) < 5000)
        .map((d: any) => d.id));
    }, () => setTypingUsers([]));

    return () => {
      unsubscribe();
      unsubTyping();
    };
  }, [convId, open]);

  // Mark messages as seen when chat opens
  useEffect(() => {
    if (!open || !auth.currentUser || messages.length === 0) return;

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
        batch.update(doc(db, `${basePath}/messages`, m.id), {
          seenBy: arrayUnion(myUid)
        });
      });
      batch.commit().catch(console.error);
    }
  }, [messages, open]);

  // ESC key, EMBEDDED only: cancel editing or replying. The floating pane gets the same thing
  // through `chatPane`'s `onEscape`; here there is no overlay to hang it on, because the pane IS
  // the screen — so the listener stays, calling the same function rather than a second copy of it.
  //
  // Guarded twice, because this listener sits on `window` and this widget is mounted the whole time
  // a group is selected. Unguarded it answered Escape presses that had nothing to do with the chat:
  // closing an event modal silently threw away a reply the user had lined up. `dialogDepth()` is
  // the same stack every overlay registers in — including the reaction picker, which is exactly
  // right: while that is open, Escape belongs to it.
  useEffect(() => {
    if (!embedded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!open || dialogDepth() > 0) return;
      dismissChatLayer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingMsg, replyingTo, open, embedded]);

  const attachImage = (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    attachImage(file);
  };

  /**
   * Ctrl+V a screenshot into the message box.
   *
   * The clipboard carries several representations of one paste, so this looks for the first item
   * that IS an image rather than assuming `items[0]` — a screenshot copied out of a browser
   * usually arrives as HTML first and the picture second.
   *
   * `preventDefault` only when an image was actually found: pasting ordinary text has to keep
   * working, and swallowing it would be a far more annoying bug than the one being fixed.
   *
   * A pasted screenshot has no filename — `getAsFile()` names it "image.png" for everybody — so
   * it is renamed with a timestamp. Without that, two screenshots in one conversation land on the
   * same Storage path and the second silently overwrites the first.
   */
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    e.preventDefault();
    const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    attachImage(new File([file], `pasted_${Date.now()}.${ext}`, { type: file.type }));
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!auth.currentUser) return;
    
    // Set typing to true
    setDoc(doc(db, `${basePath}/typing`, auth.currentUser.uid), {
      updatedAt: serverTimestamp()
    }).catch(console.error);

    // Clear typing after 3 seconds of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      deleteDoc(doc(db, `${basePath}/typing`, auth.currentUser!.uid)).catch(console.error);
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
        imageUrl = await uploadFile(
          `chat-images/${convId}/${Date.now()}_${imageFile.name}`,
          imageFile,
        );
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
        batch.update(doc(db, `${basePath}/messages`, m.id), {
          seenBy: arrayUnion(myUid)
        });
      });
      batch.commit().catch(console.error);
    }

      if (editingMsg) {
        await updateDoc(doc(db, `${basePath}/messages`, editingMsg.id), {
          text: newMessage.trim() || null,
          imageUrl: imageUrl || editingMsg.imageUrl || null,
          isEdited: true
        });
        setEditingMsg(null);
      } else {
        await addDoc(collection(db, `${basePath}/messages`), {
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
      deleteDoc(doc(db, `${basePath}/typing`, auth.currentUser.uid)).catch(console.error);
      
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'GroupChatWidget.handleSend' });
      console.error('Failed to send message:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (msgId: string) => {
    if (confirm(t('deleteMessageConfirm', language))) {
      await updateDoc(doc(db, `${basePath}/messages`, msgId), {
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
    
    await updateDoc(doc(db, `${basePath}/messages`, msgId), {
      reactions: newReactions
    });
    setActiveReactionMsg(null);
  };

  // --- Pinned Messages ---
  const handlePin = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    await updateDoc(doc(db, `${basePath}/messages`, msgId), {
      isPinned: !msg.isPinned
    });
    triggerHaptic('light');
  };

  const pinnedMessages = messages.filter(m => m.isPinned && !m.isDeleted);

  // --- Search ---
  const searchResults = searchQuery.trim()
    ? messages.filter(m => m.text && !m.isDeleted && m.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const navigateSearch = (direction: 'up' | 'down') => {
    if (searchResults.length === 0) return;
    let newIndex = currentSearchIndex;
    if (direction === 'down') {
      newIndex = (currentSearchIndex + 1) % searchResults.length;
    } else {
      newIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    }
    setCurrentSearchIndex(newIndex);
    scrollToMessage(searchResults[newIndex].id);
  };

  // --- Voice Messages ---
  // Send whatever is in `audioChunksRef`. Extracted so the retry button can call it again:
  // the blob is the ONLY copy of the recording — nothing else holds it and the microphone is
  // already released — so a swallowed failure used to destroy the message outright.
  const sendRecording = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    if (audioBlob.size === 0) return;

    setUploading(true);
    setVoiceSendFailed(false);
    try {
      const audioUrl = await uploadFile(
        `chat-audio/${convId}/${Date.now()}.webm`,
        audioBlob,
      );

      await addDoc(collection(db, `${basePath}/messages`), {
        text: null,
        imageUrl: null,
        audioUrl,
        senderId: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
        seenBy: [auth.currentUser!.uid],
        replyToId: null,
        isDeleted: false,
        isEdited: false
      });

      playTone('click');
      triggerHaptic('light');
      // Only now is the recording safe to forget.
      audioChunksRef.current = [];
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'GroupChatWidget.voiceUpload' });
      setVoiceSendFailed(true);
    } finally {
      setUploading(false);
    }
  };

  const discardRecording = () => {
    audioChunksRef.current = [];
    setVoiceSendFailed(false);
  };

  // ── The microphone must not outlive this component ─────────────────────────────────────
  //
  // The stream is stopped in `onstop` and in `cancelRecording`, and in NO cleanup — so a widget
  // that goes away mid-recording leaves the track live and the browser's recording indicator lit
  // until the tab closes. Nothing in the app can reach it afterwards: the handlers that would
  // stop it belong to the instance that is gone.
  //
  // Until 20.09 this screen never unmounted the widget on a group switch — a duplicate React key
  // leaked it instead — so the leak was real but reached by a different route. Fixing the key
  // makes the switch a REAL unmount, which would have made this bite more often, not less.
  //
  // Refs only, no dependencies: this must run on the way out and never re-run.
  useEffect(() => () => {
    const rec = mediaRecorderRef.current;
    if (rec) {
      // Detach first: `stop()` fires `onstop`, which would try to SEND on an unmounted component.
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') { try { rec.stop(); } catch { /* already gone */ } }
      rec.stream?.getTracks().forEach((t) => t.stop());
    }
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setRecordingTime(0);
        await sendRecording();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 59) {
            stopRecording();
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'GroupChatWidget.startRecording' });
      console.error('Microphone access denied', e);
      alert(t('microphoneNeeded', language));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    audioChunksRef.current = [];
  };

  const handleGenerateDigest = async () => {
    setIsGeneratingDigest(true);
    setDigestError(false);
    try {
      const { digest, truncated } = await generateGroupDigestAI(convId);
      setDigestText(digest || t('digestNothing', language));
      setDigestTruncated(truncated);
    } catch (e) {
      // Was a raw English alert() on a screen that otherwise goes through t(), and one that said
      // nothing about WHY — including when the failure is simply the daily AI budget.
      reportError(e instanceof Error ? e.message : String(e), { context: 'GroupChatWidget.digest' });
      setDigestError(true);
    } finally {
      setIsGeneratingDigest(false);
    }
  };

  return (
    <div className={embedded
      ? 'flex flex-col h-full w-full min-h-0'
      : 'fixed bottom-[104px] right-4 sm:right-8 z-40 flex flex-col items-end'}>
      {open && (
        // The overlay props go on ONLY when this is the floating pane. Embedded, this element is
        // the screen itself: announcing it as a dialog would tell a screen reader the page it is
        // already on is a thing that can be dismissed.
        <div
          ref={embedded ? undefined : chatPane.menuRef}
          {...(embedded ? {} : chatPane.menuProps)}
          className={embedded
          ? 'flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900'
          : 'mb-4 w-[calc(100vw-2rem)] sm:w-96 h-[60vh] sm:h-[450px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden outline-none'}>
          {/* Header */}
          <div className="p-3 bg-primary flex items-center justify-between shrink-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm truncate">{title}</h3>
              {/* Member avatars. `overflow-hidden` because eight of them are 188px against a
                  174px column — the row already ran past its box before the button grew a word,
                  painting under the buttons rather than being clipped. Hit-tested: the taps still
                  landed on the button, so it was cosmetic; with the label it would not be. */}
              <div className="flex items-center gap-1 mt-1 overflow-hidden">
                {members.map(memberId => {
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
            <div className="flex items-center gap-1 ml-2">
              {/* ── The digest button ───────────────────────────────────────────────────
                  It was a bare sparkle, and the owner's report was that nothing about it says
                  what it does. Two separate reasons, and the second is the worse one.

                  A `title` never renders on Android: Capacitor has no hover. `aria-label` is
                  spoken only by a screen reader. So on the device this app actually ships to,
                  the button carried NO name at all — it was a glyph and nothing else. Hence a
                  visible word.

                  And the spinner was white. `index.css` auto-contrasts this header by colouring
                  `svg` elements to `--primary-foreground`; the spinner is a `div` with a
                  `border`, so it opted out of the promise. Measured against the ten presets in
                  `Settings.tsx`: 1.80:1 on Amber, and below the 3:1 WCAG asks of non-text UI on
                  every primary lighter than 0.30 luminance — four of ten presets, plus roughly
                  the light half of the custom colour picker. Pressing the button made it go
                  blank for several seconds, which is its own answer to "what does this do".

                  NO resting background, and that is measured rather than taste. The header
                  guarantees exactly one relationship — `--primary-foreground` against
                  `--primary` — and any surface slipped between the two voids it. `bg-black/10`
                  under this 11px label measures 4.00:1 on Rose; `bg-primary-foreground/15`
                  measures 3.83:1 on the DEFAULT blue. Bare, the worst preset is Slate at 4.51.
                  The rule generalises: in this header, anything that is not an `svg` and not the
                  `.bg-primary` element itself has opted out and must be checked by hand. */}
              {convKind === 'group' && (
                <button
                  onClick={handleGenerateDigest}
                  disabled={isGeneratingDigest}
                  aria-busy={isGeneratingDigest}
                  className="flex items-center gap-1 shrink-0 px-2 py-1.5 rounded-full hover:bg-black/10 transition-colors"
                  aria-label={t('aiDigestTooltip', language)} title={t('aiDigestTooltip', language)}
                >
                  {isGeneratingDigest ? (
                    <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {/* The word does not change while it works, so the header cannot shift under a
                      thumb that is still on the button. The spinner replaces the icon, in place. */}
                  <span className="text-[11px] font-semibold leading-none whitespace-nowrap">
                    {t('aiDigestLabel', language)}
                  </span>
                </button>
              )}
              <button onClick={() => { setIsSearchOpen(!isSearchOpen); setSearchQuery(''); setCurrentSearchIndex(0); }} aria-label={t('searchMessages', language)} className="p-1 hover:bg-black/10 rounded-full transition-colors">
                <Search className="w-4 h-4" />
              </button>
              {(!embedded || onClose) && (
                <button
                  onClick={() => (embedded ? onClose?.() : setIsOpen(false))}
                  className="p-1 hover:bg-black/10 rounded-full transition-colors"
                  aria-label={embedded ? t('back', language) : t('closeAction', language)}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* AI Digest Bar */}
          {digestError && (
            <div role="alert" className="mx-3 mt-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2">
              <p className="text-xs text-rose-700 dark:text-rose-300">{t('digestFailed', language)}</p>
            </div>
          )}
            {/* `role="status"`: the FAILURE path has announced itself since the day it was
                written (`role="alert"` above), and the success path announced nothing at all — so
                a screen-reader user pressed the button, heard silence, and had no way to know the
                answer had arrived. */}
          {digestText && (
            <div role="status" className="shrink-0 bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-200 dark:border-indigo-500/20 p-3 relative shadow-inner z-10">
              <button 
                onClick={() => setDigestText(null)} 
                aria-label={t('closeRecap', language)}
                className="absolute top-2 right-2 p-1 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 rounded-full"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-bold text-indigo-800 dark:text-indigo-300">{t('chatDigestTitle', language)}</span>
              </div>
              <p className="text-xs text-indigo-700 dark:text-indigo-200 whitespace-pre-wrap pr-4">{digestText}</p>
              {digestTruncated && (
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-1 pr-4">{t('digestTruncated', language)}</p>
              )}
            </div>
          )}

          {/* Search Bar */}
          {isSearchOpen && (
            <div className="px-3 py-2 bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-2 shrink-0">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentSearchIndex(0); }}
                placeholder={t('searchMessages', language)}
                autoFocus
                className="flex-1 bg-transparent text-sm outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                // Escape is NOT handled here: it belongs to `dismissChatLayer`, which peels the
                // layers in one order from one place. Two handlers for one key is how a single
                // press closed the search and the conversation behind it.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigateSearch('down');
                }}
              />
              {searchQuery && (
                <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                  {searchResults.length > 0 ? `${currentSearchIndex + 1}/${searchResults.length}` : t('noResults', language)}
                </span>
              )}
              <button onClick={() => navigateSearch('up')} aria-label={t('previousResult', language)} className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" disabled={searchResults.length === 0}>
                <ChevronUp className="w-4 h-4" />
              </button>
              <button onClick={() => navigateSearch('down')} aria-label={t('nextResult', language)} className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" disabled={searchResults.length === 0}>
                <ChevronDown className="w-4 h-4" />
              </button>
              <button onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} aria-label={t('closeSearch', language)} className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Pinned Messages Bar */}
          {pinnedMessages.length > 0 && !isSearchOpen && (
            <div className="shrink-0 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20">
              <button
                onClick={() => scrollToMessage(pinnedMessages[pinnedMessages.length - 1].id)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-amber-100/50 dark:hover:bg-amber-500/20 transition-colors"
              >
                <Pin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 rotate-45" />
                <span className="text-xs text-amber-800 dark:text-amber-300 truncate flex-1 font-medium">
                  {pinnedMessages[pinnedMessages.length - 1].text || t('chatPinnedMessage', language)}
                </span>
                {pinnedMessages.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAllPinned(!showAllPinned); }}
                    className="text-[10px] text-amber-600 dark:text-amber-400 font-bold hover:underline whitespace-nowrap shrink-0"
                  >
                    {showAllPinned ? t('hide', language) : t('morePinned', language).replace('{n}', String(pinnedMessages.length - 1))}
                  </button>
                )}
              </button>
              {showAllPinned && pinnedMessages.length > 1 && (
                <div className="px-3 pb-2 flex flex-col gap-1">
                  {pinnedMessages.slice(0, -1).reverse().map(pm => (
                    <button
                      key={pm.id}
                      onClick={() => scrollToMessage(pm.id)}
                      className="text-xs text-amber-700 dark:text-amber-300 truncate text-left pl-5 hover:underline"
                    >
                      {pm.text || t('chatPinnedMessage', language)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
            {messages.length === 0 ? (
              <p className={`text-center text-xs mt-10 ${chatLoadError ? 'text-rose-500' : 'text-zinc-400'}`}>
                {chatLoadError ? t('chatLoadFailed', language) : t('chatStart', language)}
              </p>
            ) : (
              messages.map((msg, index) => {
                const isMe = msg.senderId === auth.currentUser?.uid;
                const sender = userMap[msg.senderId] || { name: t('unknownPerson', language) };
                const status = getSeenStatus(msg);
                const parentMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
                const msgDate = msg.createdAt ? msg.createdAt.toDate() : new Date();
                const prevMsg = index > 0 ? messages[index - 1] : null;
                const prevDate = prevMsg?.createdAt ? prevMsg.createdAt.toDate() : null;
                
                const showDateSeparator = !prevDate || !isSameDay(msgDate, prevDate);
                let dateLabel = '';
                if (showDateSeparator) {
                  if (isToday(msgDate)) dateLabel = t('todayLabel', language);
                  else if (isYesterday(msgDate)) dateLabel = t('yesterdayLabel', language);
                  else dateLabel = format(msgDate, 'd MMMM yyyy', { locale: getDateLocale(language) });
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
                      ref={(el) => { messageRefs.current[msg.id] = el; }}
                      className={`flex flex-col max-w-[80%] relative group ${isMe ? 'self-end items-end' : 'self-start items-start'} ${
                        searchQuery && searchResults.some(r => r.id === msg.id)
                          ? searchResults[currentSearchIndex]?.id === msg.id
                            ? 'ring-2 ring-yellow-400 rounded-xl bg-yellow-50 dark:bg-yellow-500/10'
                            : 'ring-1 ring-yellow-300/50 rounded-xl'
                          : ''
                      }`}
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
                          title={status === 'seen' && msg.seenBy ? msg.seenBy.filter((id: string) => id !== auth.currentUser?.uid).map((id: string) => userMap[id]?.name || userMap[id]?.email?.split('@')[0] || t('unknownPerson', language)).join(', ') : ''}
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
                          {t('messageDeleted', language)}
                        </div>
                      ) : (
                        <>
                          {parentMsg && (
                            <div 
                              className={`px-3 py-2 text-xs border-b border-black/10 dark:border-white/10 opacity-80 cursor-pointer hover:opacity-100 transition-opacity ${isMe ? 'bg-black/5' : 'bg-zinc-100 dark:bg-zinc-700/50'}`}
                            >
                              <p className="font-semibold">{parentMsg.senderId === auth.currentUser?.uid ? t('chatYou', language) : (userMap[parentMsg.senderId]?.name || userMap[parentMsg.senderId]?.email?.split('@')[0] || t('unknownPerson', language))}</p>
                              <p className="truncate line-clamp-1">{parentMsg.isDeleted ? t('chatDeletedPreview', language) : (parentMsg.text || t('chatPhoto', language))}</p>
                            </div>
                          )}
                          <div className="overflow-hidden rounded-b-2xl">
                            {msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                alt={t('altSharedImage', language)}
                                className={`max-w-full object-cover max-h-48 w-full ${!parentMsg && 'rounded-t-2xl'}`}
                                onClick={() => window.open(msg.imageUrl, '_blank')}
                                style={{ cursor: 'pointer' }}
                              />
                            )}
                            {msg.audioUrl && (
                              <AudioPlayer src={msg.audioUrl} isMe={isMe} />
                            )}
                            {msg.text && (
                              <p className="px-3 py-2 text-left whitespace-pre-wrap break-words">
                                {msg.text}
                                {msg.isEdited && <span className="text-[10px] italic opacity-60 ml-2">(edited)</span>}
                              </p>
                            )}
                          </div>
                          {msg.isPinned && (
                            <div className={`px-2 py-0.5 flex items-center gap-1 text-[10px] ${isMe ? 'text-white/60' : 'text-amber-500'}`}>
                              <Pin className="w-2.5 h-2.5 rotate-45" /> {t('pinnedLabel', language)}
                            </div>
                          )}
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
                                title={t('delete', language)}
                                aria-label={t('delete', language)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => startEditing(msg)}
                                className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                                title={t('edit', language)}
                                aria-label={t('edit', language)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            // Editing and replying are the same composer, so they have to be
                            // the same slot. `startEditing` already clears `replyingTo`; this
                            // way round it did not, so both banners stacked and `handleSend`
                            // — which tests `editingMsg` first — took the edit branch: the old
                            // message was REWRITTEN with the reply’s text, no reply was sent,
                            // and the sent tone played anyway. There is no history document,
                            // so the original wording was gone for everybody.
                            onClick={() => { setEditingMsg(null); setNewMessage(''); setReplyingTo(msg); }}
                            className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                            title={t('replyTooltip', language)}
                            aria-label={t('replyTooltip', language)}
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePin(msg.id)}
                            className={`p-1 rounded-full shrink-0 ${msg.isPinned ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                            title={t(msg.isPinned ? 'unpinMessage' : 'pinMessage', language)}
                            aria-label={t(msg.isPinned ? 'unpinMessage' : 'pinMessage', language)}
                          >
                            <Pin className="w-3.5 h-3.5 rotate-45" />
                          </button>
                          <button
                            // The ref goes only on the trigger whose picker is OPEN. One hook
                            // serves every message, and pointing it at all of them would leave it
                            // holding the last one rendered — so pressing a different message's
                            // smiley would look like a press outside, and the picker would close
                            // and reopen in the same gesture. This way, pressing another message's
                            // smiley correctly closes this picker and opens that one.
                            ref={activeReactionMsg === msg.id ? reactionPicker.triggerRef : undefined}
                            // Written out rather than spread from the hook: `triggerProps` carries
                            // one `aria-expanded` for the whole hook, and every message would have
                            // claimed to be expanded at once. Per message, it is per message.
                            aria-haspopup="menu"
                            aria-expanded={activeReactionMsg === msg.id}
                            onClick={() => setActiveReactionMsg(activeReactionMsg === msg.id ? null : msg.id)}
                            className="p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                            title={t('addReactionTooltip', language)}
                            aria-label={t('addReactionTooltip', language)}
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
                            title={users.map((uid: string) => uid === auth.currentUser?.uid ? t('chatYou', language) : (userMap[uid]?.name || userMap[uid]?.email?.split('@')[0] || t('chatSomeone', language))).join(', ')}
                            aria-label={t('reactionToggle', language).replace('{emoji}', emoji).replace('{n}', String(users.length))}
                          >
                            <span>{emoji}</span>
                            <span className="font-medium">{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Active Reaction Picker */}
                    {activeReactionMsg === msg.id && (
                      <div ref={reactionPicker.menuRef} {...reactionPicker.menuProps} className={`absolute z-10 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-full px-2 py-1 flex items-center gap-1 -mt-8 outline-none ${isMe ? 'right-0' : 'left-0'}`}>
                        {EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            role="menuitem"
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
              <img src={imagePreview} alt={t('altPreview', language)} className="h-16 w-16 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700" />
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
                {t(typingUsers.length > 1 ? 'chatTypingMany' : 'chatTypingOne', language).replace(
                  '{names}',
                  typingUsers.map(id => userMap[id]?.name?.split(' ')[0] || t('chatSomeone', language)).join(', '),
                )}
              </span>
            </div>
          )}

          {/* Reply Banner */}
          {replyingTo && (
            <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <Reply className="w-4 h-4 text-primary shrink-0" />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[10px] font-bold text-primary">{t('replyingToLabel', language)} {replyingTo.senderId === auth.currentUser?.uid ? t('chatYou', language) : (userMap[replyingTo.senderId]?.name || userMap[replyingTo.senderId]?.email?.split('@')[0] || t('unknownPerson', language))}</span>
                  <span className="text-xs text-zinc-500 truncate">{replyingTo.text || t('chatPhoto', language)}</span>
                </div>
              </div>
              <button onClick={() => setReplyingTo(null)} aria-label={t('cancelReply', language)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 transition-colors">
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
                  <span className="text-[10px] font-bold text-primary">{t('editingMessage', language)}</span>
                  <span className="text-xs text-zinc-500 truncate">{editingMsg.text || t('chatPhoto', language)}</span>
                </div>
              </div>
              <button onClick={() => { setEditingMsg(null); setNewMessage(''); }} aria-label={t('cancelEditing', language)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Input */}
          {isRecording ? (
            <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex gap-2 items-center shrink-0">
              <button
                onClick={cancelRecording}
                className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
                aria-label={t('cancel', language)} title={t('cancel', language)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-500/10 rounded-full">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                  {String(Math.floor(recordingTime / 60)).padStart(2, '0')}:{String(recordingTime % 60).padStart(2, '0')}
                </span>
                <div className="flex-1 flex items-center gap-0.5 h-4 overflow-hidden">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-red-400/60 rounded-full transition-all"
                      style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 50}ms` }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={stopRecording}
                className="w-9 h-9 rounded-full bg-red-500 flex items-center justify-center hover:opacity-90 transition-opacity shrink-0 text-white"
                aria-label={t('sendVoiceMessageTooltip', language)} title={t('sendVoiceMessageTooltip', language)}
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </div>
          ) : (
            <>
            {voiceSendFailed && (
              <div role="alert" className="px-3 py-2 border-t border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 flex items-center gap-2 shrink-0">
                <span className="text-xs text-rose-700 dark:text-rose-300 flex-1">{t('voiceSendFailed', language)}</span>
                <button type="button" onClick={sendRecording} disabled={uploading} className="text-xs font-medium text-rose-700 dark:text-rose-300 underline disabled:opacity-50">
                  {t('retry', language)}
                </button>
                <button type="button" onClick={discardRecording} className="text-xs text-rose-500">
                  {t('discard', language)}
                </button>
              </div>
            )}
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
                onPaste={handlePaste}
                placeholder={t('typeAMessage', language)}
                className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-none rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
              {newMessage.trim() || imageFile ? (
                <button
                  type="submit"
                  disabled={uploading}
                  aria-label={t('sendMessageAction', language)}
                  className="w-9 h-9 rounded-full bg-primary flex items-center justify-center disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
                >
                  {uploading
                    ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    : <Send className="w-4 h-4 ml-0.5" />
                  }
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0 text-zinc-500"
                  aria-label={t('recordVoiceMessageTooltip', language)} title={t('recordVoiceMessageTooltip', language)}
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </form>
            </>
          )}
        </div>
      )}

      {/* Floating Button — absent when embedded: the pane is not something you open. */}
      {!embedded && (
      <button
        ref={chatPane.triggerRef}
        {...chatPane.triggerProps}
        // The count goes in the name. Before the label, the badge's text WAS the only spoken
        // difference between "chat" and "chat, three unread"; a bare `aria-label` would have
        // replaced the whole accessible name and silently taken that away.
        aria-label={unreadCount > 0 ? `${title} (${unreadCount})` : title}
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
      )}
    </div>
  );
}
