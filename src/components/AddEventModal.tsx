import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Image as ImageIcon, Wallet, Trash2, CheckCircle2, Sparkles, GripVertical, Search } from 'lucide-react';
import { addDoc, collection, query, getDocs, updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { isAIEnabled, generateChecklistForTask } from '../ai';
import { onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { useModalBack } from '../hooks/useModalBack';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import * as chrono from 'chrono-node';

interface ChecklistItem {
  id: string;
  text: string;
  isCompleted: boolean;
  assetUrl?: string | null; // Optional image attachment for this item
  assetFile?: File; // Temporary file before upload
  selectedAssetUrl?: string | null; // Image picked from wallet
  assetId?: string | null; // Asset ID from wallet
}

interface AddEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  editEvent?: any;
  initialTemplate?: any;
  userMap?: Record<string, any>;
  activeGroupId?: string | 'personal';
  groups?: any[];
}

const CATEGORIES = [
  { id: 'work', label: 'Work', color: 'bg-blue-500', defaultShared: false },
  { id: 'family_time', label: 'Group Time', color: 'bg-emerald-500', defaultShared: true },
  { id: 'chores', label: 'Chores/Errands', color: 'bg-amber-500', defaultShared: true },
  { id: 'health', label: 'Health/Medical', color: 'bg-rose-500', defaultShared: false },
  { id: 'other', label: 'Other', color: 'bg-zinc-500', defaultShared: false },
];

export default function AddEventModal({ isOpen, onClose, selectedDate, editEvent, initialTemplate, userMap = {}, activeGroupId = 'personal', groups = [] }: AddEventModalProps) {
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState<string>('');
  const [description, setDescription] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [isTask, setIsTask] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error' | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
    }
  }, [description]);
  const [users, setUsers] = useState<{id: string, name: string}[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [visibleTo, setVisibleTo] = useState<string[]>([]);
  
  // Wallet Assets
  const [assets, setAssets] = useState<any[]>([]);
  const [showAssetPicker, setShowAssetPicker] = useState<'main' | string | null>(null); // 'main' or checklistItem id
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [removeMainImage, setRemoveMainImage] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(activeGroupId);
  const [showOwnerProfile, setShowOwnerProfile] = useState(false);

  // New UX features states
  const [suggestedAsset, setSuggestedAsset] = useState<any | null>(null);
  const [lastAddedItemId, setLastAddedItemId] = useState<string | null>(null);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [saveUploadsToWallet, setSaveUploadsToWallet] = useState(false);

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

  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    const fetchUsers = async () => {
      const q = query(collection(db, 'users'));
      const snapshot = await getDocs(q);
      const fetchedUsers = snapshot.docs
        .map(doc => ({ id: doc.id, name: doc.data().name || doc.data().email }))
        .filter(user => user.id !== auth.currentUser?.uid);
      setUsers(fetchedUsers);
    };
    fetchUsers();

    // Fetch user assets
    const assetsQuery = query(collection(db, 'assets'));
    const unsubAssets = onSnapshot(assetsQuery, (snapshot) => {
      const allAssets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const myAssets = allAssets.filter((a: any) => 
        a.ownerId === auth.currentUser?.uid || a.sharedWithFamily
      );
      setAssets(myAssets);
    });

    return () => unsubAssets();
  }, [isOpen]);

  useEffect(() => {
    if (editEvent && isOpen) {
      setTitle(editEvent.title || '');
      setEventDate(editEvent.date ? format(new Date(editEvent.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
      setDescription(editEvent.description || '');
      setChecklistItems(editEvent.checklistItems || []);
      setCategory(CATEGORIES.find(c => c.id === editEvent.categoryId) || CATEGORIES[0]);
      setIsTask(editEvent.isTask || false);
      setAssigneeIds(editEvent.assigneeIds || (editEvent.assigneeId ? [editEvent.assigneeId] : []));
      setVisibleTo(editEvent.visibleTo || (userMap ? Object.values(userMap).filter((u: any) => u.id !== auth.currentUser?.uid).map((u: any) => u.id) : []));
      setRemoveMainImage(false);
      setSelectedGroupId(editEvent.groupId || 'personal');
    } else if (isOpen && !editEvent) {
      let loadedDraft = false;
      const draftJSON = localStorage.getItem('ourDays_draftEvent');
      if (draftJSON) {
        try {
          const parsed = JSON.parse(draftJSON);
          if (window.confirm("You have an unsaved draft for a new event. Do you want to restore it?")) {
            setTitle(parsed.title || '');
            if (parsed.eventDate) setEventDate(parsed.eventDate);
            setDescription(parsed.description || '');
            if (parsed.checklistItems) setChecklistItems(parsed.checklistItems);
            if (parsed.categoryId) {
              const cat = CATEGORIES.find(c => c.id === parsed.categoryId);
              if (cat) setCategory(cat);
            }
            if (parsed.isTask !== undefined) setIsTask(parsed.isTask);
            if (parsed.assigneeIds) setAssigneeIds(parsed.assigneeIds);
            if (parsed.visibleTo) setVisibleTo(parsed.visibleTo);
            if (parsed.selectedGroupId) setSelectedGroupId(parsed.selectedGroupId);
            if (parsed.repeat) setRepeat(parsed.repeat);
            loadedDraft = true;
          } else {
            localStorage.removeItem('ourDays_draftEvent');
          }
        } catch(e) {}
      }

      if (!loadedDraft) {
        setTitle(initialTemplate?.title || '');
        setEventDate(selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
        setDescription('');
        setChecklistItems([]);
        setCategory(initialTemplate?.category ? CATEGORIES.find(c => c.id === initialTemplate.category) || CATEGORIES[0] : CATEGORIES[0]);
        setIsTask(initialTemplate?.isTask || false);
        setAssigneeIds(initialTemplate?.assigneeIds || []);
        setRepeat('none');
        setVisibleTo(userMap ? Object.values(userMap).filter((u: any) => u.id !== auth.currentUser?.uid).map((u: any) => u.id) : []);
        setSelectedGroupId(activeGroupId);
      }
      setImageFile(null);
      setSelectedAssetUrl(null);
      setSelectedAssetId(null);
      setRemoveMainImage(false);
    }
    setShowOwnerProfile(false);
  }, [editEvent, isOpen, userMap, activeGroupId]);

  // Autosave draft
  useEffect(() => {
    if (isOpen && !editEvent) {
      const draft = {
        title, eventDate, description, checklistItems, categoryId: category.id, isTask, assigneeIds, visibleTo, selectedGroupId, repeat
      };
      if (title || description || checklistItems.length > 0) {
        localStorage.setItem('ourDays_draftEvent', JSON.stringify(draft));
      } else {
        localStorage.removeItem('ourDays_draftEvent');
      }
    }
  }, [title, eventDate, description, checklistItems, category, isTask, assigneeIds, visibleTo, selectedGroupId, repeat, isOpen, editEvent]);

  // Auto-save edits to Firestore
  useEffect(() => {
    if (isOpen && editEvent) {
      if (!title.trim() || !eventDate) return;
      
      setAutoSaveStatus('saving');
      const timeoutId = setTimeout(async () => {
        try {
          let imageUrl = removeMainImage ? null : (selectedAssetUrl || editEvent.imageUrl);
          
          const safeChecklistItems = checklistItems.map(item => ({
            id: item.id,
            text: item.text,
            isCompleted: item.isCompleted,
            assetUrl: item.assetUrl || null,
            assetId: item.assetId || null
          }));

          const baseEventData = {
            title,
            description,
            date: new Date(eventDate).toISOString(),
            checklistItems: safeChecklistItems,
            categoryId: category.id,
            groupId: selectedGroupId !== 'personal' ? selectedGroupId : null,
            visibleTo: selectedGroupId !== 'personal' ? visibleTo : [],
            imageUrl: imageUrl,
            isTask,
            assigneeIds,
            assigneeId: assigneeIds[0] || null,
            assetId: removeMainImage ? null : (selectedAssetId || editEvent.assetId),
            updatedAt: new Date().toISOString()
          };

          await updateDoc(doc(db, 'events', editEvent.id), baseEventData);
          setAutoSaveStatus('saved');
        } catch (e) {
          console.error('Autosave error', e);
          setAutoSaveStatus('error');
        }
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [title, eventDate, description, checklistItems, category, isTask, assigneeIds, visibleTo, selectedGroupId, removeMainImage, selectedAssetId, selectedAssetUrl, isOpen, editEvent]);

  if (!isOpen) return null;

  const handleCategoryChange = (cat: typeof CATEGORIES[0]) => {
    setCategory(cat);
  };

  const toggleVisibility = (userId: string) => {
    setVisibleTo(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const toggleAssignee = (userId: string) => {
    setAssigneeIds(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };



  const checkForAssetSuggestions = (text: string) => {
    if (!text || selectedAssetId) return; // already linked
    const lowerText = text.toLowerCase();
    const userWords = lowerText.split(/\s+/).filter((w: string) => w.length > 2);
    
    // Grocery keywords to trigger supermarket card suggestions
    const groceryKeywords = ['milk', 'lapte', 'bread', 'paine', 'apa', 'water', 'carne', 'meat', 'oua', 'eggs', 'branza', 'cheese', 'fructe', 'legume', 'rosii', 'cartofi', 'bere', 'suc'];
    const supermarkets = ['mega', 'auchan', 'penny', 'kaufland', 'carrefour', 'lidl', 'profi'];
    const hasGroceryWord = userWords.some(w => groceryKeywords.includes(w.toLowerCase()));
    
    const matchedAsset = assets.find(a => {
      const assetNameLower = a.name.toLowerCase();
      const assetWords = assetNameLower.split(/\s+/).filter((w: string) => w.length > 2);
      
      // If it's a grocery item, aggressively match ANY supermarket card
      if (hasGroceryWord && supermarkets.some(sm => assetNameLower.includes(sm))) {
        return true;
      }
      
      // Match if the typed text matches the asset name, or if any word matches
      return assetNameLower.includes(lowerText) || 
             lowerText.includes(assetNameLower) || 
             userWords.some((uw: string) => assetNameLower.includes(uw)) || 
             assetWords.some((aw: string) => lowerText.includes(aw));
    });
    
    if (matchedAsset && suggestedAsset?.id !== matchedAsset.id) {
      setSuggestedAsset(matchedAsset);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    checkForAssetSuggestions(newTitle);
    
    // Chrono natural language date parsing with Romanian support
    if (!editEvent) {
      let parseableTitle = newTitle.toLowerCase();
      
      // Keywords
      parseableTitle = parseableTitle.replace(/\bmaine\b/g, 'tomorrow');
      parseableTitle = parseableTitle.replace(/\bazi\b/g, 'today');
      parseableTitle = parseableTitle.replace(/\bpoimaine\b/g, 'in 2 days');
      
      // Days of week
      parseableTitle = parseableTitle.replace(/\bluni\b/g, 'monday');
      parseableTitle = parseableTitle.replace(/\bmarti\b/g, 'tuesday');
      parseableTitle = parseableTitle.replace(/\bmiercuri\b/g, 'wednesday');
      parseableTitle = parseableTitle.replace(/\bjoi\b/g, 'thursday');
      parseableTitle = parseableTitle.replace(/\bvineri\b/g, 'friday');
      parseableTitle = parseableTitle.replace(/\bsambata\b/g, 'saturday');
      parseableTitle = parseableTitle.replace(/\bduminica\b/g, 'sunday');
      
      // Months
      parseableTitle = parseableTitle.replace(/\bianuarie\b/g, 'january');
      parseableTitle = parseableTitle.replace(/\bfebruarie\b/g, 'february');
      parseableTitle = parseableTitle.replace(/\bmartie\b/g, 'march');
      parseableTitle = parseableTitle.replace(/\baprilie\b/g, 'april');
      parseableTitle = parseableTitle.replace(/\bmai\b/g, 'may');
      parseableTitle = parseableTitle.replace(/\biunie\b/g, 'june');
      parseableTitle = parseableTitle.replace(/\biulie\b/g, 'july');
      parseableTitle = parseableTitle.replace(/\baugust\b/g, 'august');
      parseableTitle = parseableTitle.replace(/\bseptembrie\b/g, 'september');
      parseableTitle = parseableTitle.replace(/\boctombrie\b/g, 'october');
      parseableTitle = parseableTitle.replace(/\bnoiembrie\b/g, 'november');
      parseableTitle = parseableTitle.replace(/\bdecembrie\b/g, 'december');
      
      const parsed = chrono.parse(parseableTitle);
      if (parsed && parsed.length > 0) {
        const parsedDate = parsed[0].start.date();
        setEventDate(format(parsedDate, 'yyyy-MM-dd'));
      }
    }
  };

  const handleAddChecklistItem = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newItemText.trim()) return;
    const newId = Date.now().toString();
    setChecklistItems([
      ...checklistItems, 
      { id: newId, text: newItemText, isCompleted: false }
    ]);
    setNewItemText('');
    setLastAddedItemId(newId);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    checkForAssetSuggestions(newItemText);
  };

  const handleGenerateChecklist = async () => {
    if (!title.trim()) {
      alert("Please enter an Event Title first so the AI knows what to suggest.");
      return;
    }
    setIsGeneratingAI(true);
    try {
      const suggestions = await generateChecklistForTask(title, description);
      if (suggestions.length === 0) {
        alert("The AI couldn't generate a checklist for this title.");
        return;
      }
      const newItems = suggestions.map(text => ({
        id: Date.now().toString() + Math.random(),
        text,
        isCompleted: false
      }));
      setChecklistItems(prev => [...prev, ...newItems]);
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } catch (error: any) {
      alert(error.message || "Failed to generate checklist.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleRemoveChecklistItem = (id: string) => {
    setChecklistItems(checklistItems.filter(item => item.id !== id));
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(checklistItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setChecklistItems(items);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  const handleEditChecklistText = (id: string, newText: string) => {
    setChecklistItems(checklistItems.map(item => item.id === id ? { ...item, text: newText } : item));
  };

  const handleChecklistItemImage = (id: string, file: File) => {
    setChecklistItems(checklistItems.map(item => 
      item.id === id ? { ...item, assetFile: file } : item
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedDate) return;

    setLoading(true);
    try {
      let imageUrl = null;
      if (imageFile) {
        const fileRef = ref(storage, `events/${auth.currentUser?.uid}/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);

        if (saveUploadsToWallet) {
          await addDoc(collection(db, 'assets'), {
            name: title || 'Event Image',
            category: 'Uncategorized',
            categories: ['Uncategorized'],
            imageUrl: imageUrl,
            ownerId: auth.currentUser?.uid,
            createdAt: new Date().toISOString(),
            sharedWithFamily: selectedGroupId !== 'personal'
          });
        }
      } else if (selectedAssetUrl) {
        imageUrl = selectedAssetUrl;
      }

      // Upload checklist images
      const uploadedChecklistItems = await Promise.all(checklistItems.map(async (item) => {
        let finalItemUrl = item.assetUrl || null;
        if (item.assetFile) {
          const itemRef = ref(storage, `checklists/${auth.currentUser?.uid}/${Date.now()}_${item.assetFile.name}`);
          await uploadBytes(itemRef, item.assetFile);
          finalItemUrl = await getDownloadURL(itemRef);

          if (saveUploadsToWallet) {
            await addDoc(collection(db, 'assets'), {
              name: item.text || 'Checklist Item',
              category: 'Uncategorized',
              categories: ['Uncategorized'],
              imageUrl: finalItemUrl,
              ownerId: auth.currentUser?.uid,
              createdAt: new Date().toISOString(),
              sharedWithFamily: selectedGroupId !== 'personal'
            });
          }
        } else if (item.selectedAssetUrl) {
          finalItemUrl = item.selectedAssetUrl;
        }
        return { 
          id: item.id, 
          text: item.text, 
          isCompleted: item.isCompleted, 
          assetUrl: finalItemUrl === undefined ? null : finalItemUrl,
          assetId: item.assetId || null
        };
      }));

      const baseEventData = {
        title,
        description,
        checklistItems: uploadedChecklistItems,
        categoryId: category.id,
        ownerId: editEvent ? editEvent.ownerId : auth.currentUser.uid,
        groupId: selectedGroupId !== 'personal' ? selectedGroupId : null,
        sharedWithFamily: editEvent ? editEvent.sharedWithFamily : false, // Legacy fallback
        visibleTo: selectedGroupId !== 'personal' ? visibleTo : [],
        imageUrl: removeMainImage ? null : (imageUrl || (editEvent ? editEvent.imageUrl : null)),
        isTask: isTask,
        taskStatus: editEvent ? editEvent.taskStatus : (isTask ? 'not-started' : 'none'),
        assigneeIds: assigneeIds,
        assigneeId: assigneeIds[0] || null,
        assetId: removeMainImage ? null : (selectedAssetId || (editEvent ? editEvent.assetId : null)),
        updatedAt: new Date().toISOString()
      };

      if (editEvent) {
        await updateDoc(doc(db, 'events', editEvent.id), { ...baseEventData, date: new Date(eventDate).toISOString() });
        onClose();
        return; // Early return for edit
      } else {
        let eventsToCreate = 1;
        if (repeat === 'daily') eventsToCreate = 14; // next 2 weeks
        if (repeat === 'weekly') eventsToCreate = 12; // next 12 weeks
        if (repeat === 'monthly') eventsToCreate = 6; // next 6 months

        for (let i = 0; i < eventsToCreate; i++) {
          let eventDateObj = new Date(eventDate);
          if (i > 0) {
            if (repeat === 'daily') eventDateObj.setDate(eventDateObj.getDate() + i);
            if (repeat === 'weekly') eventDateObj.setDate(eventDateObj.getDate() + (i * 7));
            if (repeat === 'monthly') eventDateObj.setMonth(eventDateObj.getMonth() + i);
          }
          await addDoc(collection(db, 'events'), {
            ...baseEventData,
            date: eventDateObj.toISOString(),
            createdAt: new Date().toISOString()
          });
        }
        
        // Notify assignees
        const otherAssignees = assigneeIds.filter(id => id !== auth.currentUser?.uid);
        if (otherAssignees.length > 0 && isTask) {
          otherAssignees.forEach(async (userId) => {
            await addDoc(collection(db, 'notifications'), {
              userId,
              type: 'task',
              title: 'New Task Assigned',
              body: `You have been assigned to: ${title}`,
              read: false,
              createdAt: new Date()
            });
          });
        }
      }
      if (!editEvent) {
        localStorage.removeItem('ourDays_draftEvent');
      }
      setTitle('');
      setDescription('');
      setChecklistItems([]);
      setImageFile(null);
      setSelectedAssetUrl(null);
      setSelectedAssetId(null);
      setSaveUploadsToWallet(false);
      setAssigneeIds([]);
      setIsTask(false);
      setRepeat('none');
      onClose();
    } catch (error) {
      console.error("Error adding event: ", error);
      alert("Failed to add event");
    } finally {
      setLoading(false);
    }
  };

  const ownerId = editEvent ? editEvent.ownerId : auth.currentUser?.uid;
  const owner = ownerId ? (userMap[ownerId] || null) : null;

  const commonGroups = owner ? groups?.filter(g => g.members?.includes(owner.id)) || [] : [];

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            {editEvent ? 'Edit Event' : 'Add New Event'}
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 relative">
              <input 
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg outline-none border-none focus:ring-2 focus:ring-primary/50 cursor-pointer min-w-[140px]"
                required
              />
              {owner && (
                  <div className="relative">
                    <button type="button" onClick={() => setShowOwnerProfile(!showOwnerProfile)} className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition-all shadow-sm" title="View Owner">
                      {owner.photoURL ? (
                        <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                          {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                        </span>
                      )}
                    </button>
                    
                    {showOwnerProfile && (
                      <div className="absolute top-10 left-0 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-4 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-start gap-3 border-b border-zinc-100 dark:border-zinc-700 pb-3 mb-3">
                          <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 overflow-hidden shrink-0">
                            {owner.photoURL ? (
                              <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-lg font-bold text-zinc-500 dark:text-zinc-400">
                                {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{owner.name || owner.email?.split('@')[0]}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{owner.email}</p>
                          </div>
                        </div>
                        
                        <div>
                          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Common Groups</p>
                          {commonGroups.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {commonGroups.map(g => (
                                <span key={g.id} className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
                                  {g.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-500 italic">No common groups</p>
                          )}
                        </div>
                        
                        <button type="button" onClick={() => setShowOwnerProfile(false)} className="mt-4 w-full py-1.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg text-xs font-medium transition-colors">
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Event Title</label>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="e.g., Dentist Appointment"
              required
              className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Description / Notes</label>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Don't forget to call..."
              rows={1}
              className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none resize-none overflow-hidden min-h-[42px]"
            />
          </div>

          <div className="space-y-3 bg-zinc-50 dark:bg-zinc-800/30 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Interactive Checklist</label>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklistItem())}
                placeholder="e.g., Buy Milk, Order Cake..."
                className="flex-1 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              />
              <button 
                type="button" 
                onClick={handleAddChecklistItem}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Add
              </button>
            </div>

            {isAIEnabled() && (
              <button
                type="button"
                onClick={handleGenerateChecklist}
                disabled={isGeneratingAI}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 rounded-lg text-sm font-medium transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50 mt-2"
              >
                {isGeneratingAI ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div> Generating Magic Checklist...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Auto-suggest Checklist via AI</>
                )}
              </button>
            )}

            {checklistItems.length > 0 && (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="checklist">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2 mt-3">
                      {checklistItems.map((item, index) => (
                        <Draggable key={item.id} draggableId={item.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`flex flex-col bg-white dark:bg-zinc-800 p-2 rounded-lg border ${snapshot.isDragging ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-zinc-200 dark:border-zinc-700'}`}
                            >
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing p-1 -ml-1">
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div className="w-4 h-4 border border-zinc-300 rounded-sm shrink-0"></div>
                                <textarea 
                                  value={item.text}
                                  onChange={(e) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = `${e.target.scrollHeight}px`;
                                    handleEditChecklistText(item.id, e.target.value);
                                    checkForAssetSuggestions(e.target.value);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const newId = Date.now().toString();
                                      setChecklistItems(items => {
                                        const idx = items.findIndex(i => i.id === item.id);
                                        const newArray = [...items];
                                        newArray.splice(idx + 1, 0, { id: newId, text: '', isCompleted: false });
                                        return newArray;
                                      });
                                      setLastAddedItemId(newId);
                                      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
                                    } else if (e.key === 'Backspace' && item.text === '') {
                                      e.preventDefault();
                                      handleRemoveChecklistItem(item.id);
                                    }
                                  }}
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = `${el.scrollHeight}px`;
                                      if (item.id === lastAddedItemId) {
                                        el.focus();
                                        setLastAddedItemId(null);
                                      }
                                    }
                                  }}
                                  rows={1}
                                  className="flex-1 text-sm bg-transparent border-none focus:ring-0 outline-none text-zinc-700 dark:text-zinc-300 min-w-0 resize-none overflow-hidden py-0"
                                />
                                
                                <div className="flex items-center gap-1 shrink-0">
                                  <input 
                                    type="file" 
                                    id={`file-${item.id}`} 
                                    className="hidden" 
                                    accept="image/*"
                                    onChange={(e) => e.target.files && handleChecklistItemImage(item.id, e.target.files[0])}
                                  />
                                  <label htmlFor={`file-${item.id}`} className="cursor-pointer p-1 text-zinc-400 hover:text-primary transition-colors" title="Upload New Photo">
                                    <ImageIcon className={`w-4 h-4 ${item.assetFile ? 'text-primary' : ''}`} />
                                  </label>
                                  <button 
                                    type="button" 
                                    onClick={() => setShowAssetPicker(item.id)}
                                    className={`p-1 transition-colors ${item.selectedAssetUrl || item.assetId || (item.assetUrl && !item.assetFile) ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-500'}`}
                                    title="Pick from Assets"
                                  >
                                    <Wallet className="w-4 h-4" />
                                  </button>
                                  {(item.selectedAssetUrl || item.assetUrl || item.assetFile || item.assetId) && (
                                    <button 
                                      type="button" 
                                      onClick={() => setChecklistItems(checklistItems.map(i => i.id === item.id ? { ...i, assetUrl: null, selectedAssetUrl: null, assetId: null, assetFile: undefined } : i))}
                                      className="p-1 text-red-400 hover:text-red-500 transition-colors"
                                      title="Remove Asset"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                <button type="button" onClick={() => handleRemoveChecklistItem(item.id)} className="p-1 text-zinc-400 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              {(item.assetFile || item.selectedAssetUrl || item.assetUrl || item.assetId) && (
                                <div className="ml-8 mt-2 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 self-start max-w-[120px]">
                                  {(item.assetFile || item.selectedAssetUrl || item.assetUrl) ? (
                                    <img 
                                      src={item.assetFile ? URL.createObjectURL(item.assetFile) : (item.selectedAssetUrl || item.assetUrl || '')} 
                                      alt="Preview" 
                                      className="w-full h-auto object-contain" 
                                    />
                                  ) : (
                                    <div className="p-2 flex flex-col items-center justify-center text-zinc-500">
                                      <Wallet className="w-6 h-6 mb-1 text-emerald-500" />
                                      <span className="text-[10px] text-center">Linked Card</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {isGeneratingAI && (
              <div className="space-y-2 mt-3 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <div className="w-4 h-4 rounded-sm bg-zinc-200 dark:bg-zinc-700 shrink-0"></div>
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3"></div>
                    <div className="ml-auto w-4 h-4 rounded bg-zinc-200 dark:bg-zinc-700 shrink-0"></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {suggestedAsset && !selectedAssetId && (
              <div className="mb-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Link {suggestedAsset.name}?</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">We noticed this matches a card in your Wallet.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => setSuggestedAsset(null)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg transition-colors"
                  >
                    Dismiss
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(suggestedAsset.id);
                      setSuggestedAsset(null);
                      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 transition-colors"
                  >
                    Link Card
                  </button>
                </div>
              </div>
            )}
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryChange(cat)}
                  className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-all ${
                    category.id === cat.id 
                      ? 'border-primary bg-primary/10 text-primary' 
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${cat.color}`} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Target Calendar</label>
              <select 
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              >
                <option value="personal">Personal Calendar</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name} Calendar</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Assign Members</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {auth.currentUser && (
                  <button 
                    type="button"
                    onClick={() => toggleAssignee(auth.currentUser!.uid)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                      assigneeIds.includes(auth.currentUser.uid) 
                        ? 'bg-primary text-white border-primary' 
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    Me
                    {assigneeIds.includes(auth.currentUser.uid) && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                )}
                
                <button 
                  type="button"
                  onClick={() => toggleAssignee('ai_assistant')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                    assigneeIds.includes('ai_assistant') 
                      ? 'bg-indigo-500 text-white border-indigo-500' 
                      : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                  }`}
                  title="Assign to AI Assistant to automatically generate a checklist"
                >
                  <Sparkles className="w-3 h-3" />
                  AI Assistant
                  {assigneeIds.includes('ai_assistant') && <CheckCircle2 className="w-3 h-3" />}
                </button>
                {selectedGroupId !== 'personal' && users.map(u => {
                  const belongsToGroup = groups.find(g => g.id === selectedGroupId)?.members?.includes(u.id);
                  if (!belongsToGroup) return null;
                  return (
                  <button 
                    key={u.id}
                    type="button"
                    onClick={() => toggleAssignee(u.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                      assigneeIds.includes(u.id) 
                        ? 'bg-primary text-white border-primary' 
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {u.name || 'Member'}
                    {assigneeIds.includes(u.id) && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                  );
                })}
              </div>
            </div>

            {!editEvent && (
              <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Repeat</label>
                <select 
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily (Next 14 days)</option>
                  <option value="weekly">Weekly (Next 12 weeks)</option>
                  <option value="monthly">Monthly (Next 6 months)</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Make this a Task</p>
                <p className="text-xs text-zinc-500">Track progress (Not Started, Completed)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={isTask}
                  onChange={(e) => setIsTask(e.target.checked)}
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 dark:peer-focus:ring-primary/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-primary"></div>
              </label>
            </div>

            {selectedGroupId !== 'personal' && userMap && Object.keys(userMap).length > 1 && (
              <div className="flex flex-col border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/30">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Visibility</p>
                  <p className="text-xs text-zinc-500">Who in this group can see this event?</p>
                </div>
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col gap-2">
                  {Object.values(userMap)
                    .filter((u: any) => u.id !== auth.currentUser?.uid && (!groups || selectedGroupId === 'personal' || groups.find(g => g.id === selectedGroupId)?.members?.includes(u.id)))
                    .map((u: any) => (
                      <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleTo.includes(u.id)}
                          onChange={() => toggleVisibility(u.id)}
                          className="w-4 h-4 text-primary bg-zinc-100 border-zinc-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">{u.name || u.email?.split('@')[0]}</span>
                      </label>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              <div className="flex-1 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center">
                <input 
                  type="file" 
                  id="file-upload" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setImageFile(e.target.files[0]);
                      setSelectedAssetUrl(null); // Clear wallet selection if new file picked
                      setRemoveMainImage(false);
                    }
                  }}
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-primary transition-colors h-full">
                  <ImageIcon className="w-5 h-5" />
                  <span className="text-xs font-medium">{imageFile ? imageFile.name : 'Upload New Photo'}</span>
                </label>
              </div>
              
              <div className="flex-1 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center flex flex-col justify-center items-center">
                <button 
                  type="button" 
                  onClick={() => setShowAssetPicker('main')}
                  className="flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors w-full h-full"
                >
                  <Wallet className="w-5 h-5" />
                  <span className="text-xs font-medium">{selectedAssetUrl || selectedAssetId ? 'Asset Selected' : 'Pick from Assets'}</span>
                </button>
              </div>
            </div>
            
            {(imageFile || selectedAssetUrl || (editEvent?.imageUrl && !removeMainImage)) && (
               <div className="flex flex-col gap-2 mt-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                 <div className="w-full flex justify-center bg-zinc-100 dark:bg-zinc-900 rounded-md overflow-hidden">
                   <img 
                     src={imageFile ? URL.createObjectURL(imageFile) : (selectedAssetUrl || editEvent?.imageUrl || '')}
                     alt="Main asset preview"
                     className="max-w-full max-h-48 object-contain"
                   />
                 </div>
                 <div className="flex justify-end w-full">
                   <button type="button" onClick={() => { setImageFile(null); setSelectedAssetUrl(null); setSelectedAssetId(null); setRemoveMainImage(true); }} className="text-red-500 text-xs font-medium flex items-center gap-1 hover:underline">
                     <Trash2 className="w-3 h-3" /> Remove Attached Asset
                   </button>
                 </div>
               </div>
            )}

            {/* Save to Wallet Toggle */}
            {(imageFile || checklistItems.some(i => i.assetFile)) && (
              <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 animate-in fade-in slide-in-from-top-2 mt-3">
                <div>
                  <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">Save Uploads to Wallet</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Add new photos from this event to Assets</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={saveUploadsToWallet}
                    onChange={(e) => setSaveUploadsToWallet(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 dark:peer-focus:ring-emerald-500/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
          </div>

          <div className="pt-2 shrink-0 flex items-center justify-between gap-4">
            {editEvent && (
              <div className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 shrink-0">
                {autoSaveStatus === 'saving' && <><div className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin"></div> Saving...</>}
                {autoSaveStatus === 'saved' && <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Saved</>}
                {autoSaveStatus === 'error' && <span className="text-red-500">Error saving</span>}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !title.trim() || autoSaveStatus === 'saving'}
              className={`w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 ${editEvent ? 'max-w-[140px] ml-auto' : ''}`}
            >
              {loading ? (editEvent ? 'Saving...' : 'Adding...') : (editEvent ? 'Done' : 'Save Event')}
            </button>
          </div>
        </form>

      </div>

      {/* Asset Picker Modal */}
      {showAssetPicker && (
        <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-500" />
                Select from Assets
              </h3>
              <button onClick={() => setShowAssetPicker(null)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input 
                  type="text" 
                  placeholder="Search assets..." 
                  value={assetSearchQuery}
                  onChange={(e) => setAssetSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-500"
                />
              </div>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 bg-zinc-100/50 dark:bg-zinc-900/50">
              {(() => {
                const filteredAssets = assets.filter(a => a.name.toLowerCase().includes(assetSearchQuery.toLowerCase()));
                if (filteredAssets.length === 0) {
                  return (
                    <div className="text-center py-10 text-zinc-500">
                      <Wallet className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>{assetSearchQuery ? 'No matching assets found.' : 'No assets found in your Wallet.'}</p>
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredAssets.map(asset => (
                      <div 
                        key={asset.id}
                        onClick={() => {
                          if (showAssetPicker === 'main') {
                            setSelectedAssetUrl(asset.imageUrl || null);
                            setSelectedAssetId(asset.id);
                            setImageFile(null);
                            setRemoveMainImage(false);
                          } else {
                            setChecklistItems(checklistItems.map(item => 
                              item.id === showAssetPicker ? { ...item, selectedAssetUrl: asset.imageUrl || null, assetId: asset.id, assetFile: undefined } : item
                            ));
                          }
                          setShowAssetPicker(null);
                          setAssetSearchQuery('');
                        }}
                        className="group cursor-pointer bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden hover:border-emerald-500 hover:shadow-md transition-all relative"
                      >
                        <div className="aspect-square bg-zinc-100 dark:bg-zinc-900 relative flex items-center justify-center">
                          {asset.imageUrl ? (
                            <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          ) : (
                            <Wallet className="w-10 h-10 text-zinc-400 opacity-50 group-hover:scale-110 transition-transform duration-300" />
                          )}
                          <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/10 transition-colors"></div>
                        </div>
                        <div className="p-2 border-t border-zinc-100 dark:border-zinc-800">
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1 group-hover:text-emerald-500 transition-colors text-center">{asset.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
