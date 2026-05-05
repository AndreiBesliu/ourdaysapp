import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Image as ImageIcon, Wallet, Trash2, CheckCircle2 } from 'lucide-react';
import { addDoc, collection, query, getDocs, updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { useModalBack } from '../hooks/useModalBack';

interface ChecklistItem {
  id: string;
  text: string;
  isCompleted: boolean;
  assetUrl?: string | null; // Optional image attachment for this item
  assetFile?: File; // Temporary file before upload
  selectedAssetUrl?: string | null; // Image picked from wallet
}

interface AddEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  editEvent?: any;
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

export default function AddEventModal({ isOpen, onClose, selectedDate, editEvent, userMap = {}, activeGroupId = 'personal', groups = [] }: AddEventModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [isTask, setIsTask] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [removeMainImage, setRemoveMainImage] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(activeGroupId);
  const [showOwnerProfile, setShowOwnerProfile] = useState(false);

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
      setDescription(editEvent.description || '');
      setChecklistItems(editEvent.checklistItems || []);
      setCategory(CATEGORIES.find(c => c.id === editEvent.categoryId) || CATEGORIES[0]);
      setIsTask(editEvent.isTask || false);
      setAssigneeIds(editEvent.assigneeIds || (editEvent.assigneeId ? [editEvent.assigneeId] : []));
      setVisibleTo(editEvent.visibleTo || (userMap ? Object.values(userMap).filter((u: any) => u.id !== auth.currentUser?.uid).map((u: any) => u.id) : []));
      setRemoveMainImage(false);
      setSelectedGroupId(editEvent.groupId || 'personal');
    } else if (isOpen && !editEvent) {
      setTitle('');
      setDescription('');
      setChecklistItems([]);
      setCategory(CATEGORIES[0]);
      setIsTask(false);
      setAssigneeIds([]);
      setImageFile(null);
      setRepeat('none');
      setVisibleTo(userMap ? Object.values(userMap).filter((u: any) => u.id !== auth.currentUser?.uid).map((u: any) => u.id) : []);
      setSelectedAssetUrl(null);
      setRemoveMainImage(false);
      setSelectedGroupId(activeGroupId);
    }
    setShowOwnerProfile(false);
  }, [editEvent, isOpen, userMap, activeGroupId]);

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



  const handleAddChecklistItem = () => {
    if (!newItemText.trim()) return;
    setChecklistItems([
      ...checklistItems, 
      { id: Date.now().toString(), text: newItemText, isCompleted: false }
    ]);
    setNewItemText('');
  };

  const handleRemoveChecklistItem = (id: string) => {
    setChecklistItems(checklistItems.filter(item => item.id !== id));
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
        const fileRef = ref(storage, `events/${auth.currentUser.uid}/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);
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
        } else if (item.selectedAssetUrl) {
          finalItemUrl = item.selectedAssetUrl;
        }
        return { id: item.id, text: item.text, isCompleted: item.isCompleted, assetUrl: finalItemUrl === undefined ? null : finalItemUrl };
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
        updatedAt: new Date().toISOString()
      };

      if (editEvent) {
        await updateDoc(doc(db, 'events', editEvent.id), { ...baseEventData, date: editEvent.date });
      } else {
        let eventsToCreate = 1;
        if (repeat === 'daily') eventsToCreate = 14; // next 2 weeks
        if (repeat === 'weekly') eventsToCreate = 12; // next 12 weeks
        if (repeat === 'monthly') eventsToCreate = 6; // next 6 months

        for (let i = 0; i < eventsToCreate; i++) {
          let eventDate = new Date(selectedDate);
          if (i > 0) {
            if (repeat === 'daily') eventDate.setDate(eventDate.getDate() + i);
            if (repeat === 'weekly') eventDate.setDate(eventDate.getDate() + (i * 7));
            if (repeat === 'monthly') eventDate.setMonth(eventDate.getMonth() + i);
          }
          await addDoc(collection(db, 'events'), {
            ...baseEventData,
            date: eventDate.toISOString(),
            createdAt: new Date().toISOString()
          });
        }
      }
      setTitle('');
      setDescription('');
      setChecklistItems([]);
      setImageFile(null);
      setSelectedAssetUrl(null);
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
  const owner = ownerId ? (userMap[ownerId] || (ownerId === auth.currentUser?.uid ? {
    id: ownerId, 
    name: auth.currentUser?.displayName, 
    email: auth.currentUser?.email, 
    photoURL: auth.currentUser?.photoURL 
  } : null)) : null;

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

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          <div className="flex items-center justify-between">
            {selectedDate && (
              <div className="flex items-center gap-3 relative">
                <div className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg inline-block">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </div>
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
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Event Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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

            {checklistItems.length > 0 && (
              <div className="space-y-2 mt-3">
                {checklistItems.map(item => (
                  <div key={item.id} className="flex flex-col bg-white dark:bg-zinc-800 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border border-zinc-300 rounded-sm"></div>
                      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">{item.text}</span>
                      
                      <div className="flex items-center gap-1">
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
                          className={`p-1 transition-colors ${item.selectedAssetUrl || (item.assetUrl && !item.assetFile) ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-500'}`}
                          title="Pick from Assets"
                        >
                          <Wallet className="w-4 h-4" />
                        </button>
                        {(item.selectedAssetUrl || item.assetUrl || item.assetFile) && (
                          <button 
                            type="button" 
                            onClick={() => setChecklistItems(checklistItems.map(i => i.id === item.id ? { ...i, assetUrl: null, selectedAssetUrl: null, assetFile: undefined } : i))}
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
                    {(item.assetFile || item.selectedAssetUrl || item.assetUrl) && (
                      <div className="ml-6 mt-2 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 self-start max-w-[120px]">
                        <img 
                          src={item.assetFile ? URL.createObjectURL(item.assetFile) : (item.selectedAssetUrl || item.assetUrl || '')} 
                          alt="Preview" 
                          className="w-full h-auto object-contain" 
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
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
                {users.map(u => (
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
                ))}
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
                  <span className="text-xs font-medium">{selectedAssetUrl ? 'Asset Selected' : 'Pick from Assets'}</span>
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
                   <button type="button" onClick={() => { setImageFile(null); setSelectedAssetUrl(null); setRemoveMainImage(true); }} className="text-red-500 text-xs font-medium flex items-center gap-1 hover:underline">
                     <Trash2 className="w-3 h-3" /> Remove Attached Asset
                   </button>
                 </div>
               </div>
            )}
          </div>

          <div className="pt-2 shrink-0">
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Event'}
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
            
            <div className="p-4 overflow-y-auto flex-1 bg-zinc-100/50 dark:bg-zinc-900/50">
              {assets.filter(a => a.imageUrl).length === 0 ? (
                <div className="text-center py-10 text-zinc-500">
                  <Wallet className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No image assets found in your Assets.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {assets.filter(a => a.imageUrl).map(asset => (
                    <div 
                      key={asset.id}
                      onClick={() => {
                        if (showAssetPicker === 'main') {
                          setSelectedAssetUrl(asset.imageUrl);
                          setImageFile(null);
                          setRemoveMainImage(false);
                        } else {
                          setChecklistItems(checklistItems.map(item => 
                            item.id === showAssetPicker ? { ...item, selectedAssetUrl: asset.imageUrl, assetFile: undefined } : item
                          ));
                        }
                        setShowAssetPicker(null);
                      }}
                      className="group cursor-pointer bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden hover:border-emerald-500 hover:shadow-md transition-all relative"
                    >
                      <div className="aspect-square bg-zinc-100 dark:bg-zinc-900 relative">
                        <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/10 transition-colors"></div>
                      </div>
                      <div className="p-2 border-t border-zinc-100 dark:border-zinc-800">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1 group-hover:text-emerald-500 transition-colors text-center">{asset.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
