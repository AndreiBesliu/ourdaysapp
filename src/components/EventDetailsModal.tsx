import React, { useState, useEffect } from 'react';
import { X, Calendar as CalendarIcon, CheckCircle, FileText, Image as ImageIcon, Trash2, Edit2 } from 'lucide-react';
import { doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import Barcode from 'react-barcode';
import QRCode from 'react-qr-code';
import { Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { useModalBack } from '../hooks/useModalBack';

interface EventDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: any | null;
  userMap?: Record<string, any>;
  groups?: any[];
  onEdit?: () => void;
}

export default function EventDetailsModal({ isOpen, onClose, event, userMap = {}, groups = [], onEdit }: EventDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  // Keep local state for optimistic UI updates of checklist
  const [checklist, setChecklist] = useState<any[]>(event?.checklistItems || []);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [showOwnerProfile, setShowOwnerProfile] = useState(false);
  const [linkedAsset, setLinkedAsset] = useState<any | null>(null);
  const [linkedChecklistAssets, setLinkedChecklistAssets] = useState<Record<string, any>>({});

  useEffect(() => {
    if (event?.assetId) {
      const fetchAsset = async () => {
        try {
          const docRef = doc(db, 'assets', event.assetId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setLinkedAsset({ id: docSnap.id, ...docSnap.data() });
          }
        } catch (e) {
          console.error('Failed to fetch linked asset', e);
        }
      };
      fetchAsset();
    } else {
      setLinkedAsset(null);
    }
    
    // Fetch checklist assets
    if (event?.checklistItems) {
      const fetchChecklistAssets = async () => {
        const newMap: Record<string, any> = {};
        for (const item of event.checklistItems) {
          if (item.assetId) {
            try {
              const docSnap = await getDoc(doc(db, 'assets', item.assetId));
              if (docSnap.exists()) {
                newMap[item.assetId] = { id: docSnap.id, ...docSnap.data() };
              }
            } catch(e) {}
          }
        }
        setLinkedChecklistAssets(newMap);
      };
      fetchChecklistAssets();
    }
  }, [event?.assetId, event?.checklistItems]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Update local state when event changes
  React.useEffect(() => {
    if (event) {
      setChecklist(event.checklistItems || []);
    }
  }, [event]);

  useModalBack(isOpen, onClose);

  if (!isOpen || !event) return null;

  const isOwner = event.ownerId === auth.currentUser?.uid;
  const isInvitee = event.inviteeId === auth.currentUser?.uid;

  const assigneeIds: string[] = event.assigneeIds || (event.assigneeId ? [event.assigneeId] : []);
  const isAssignee = assigneeIds.includes(auth.currentUser?.uid || '');
  const hasAssignee = assigneeIds.length > 0;
  
  // Anyone involved can change task status, or edit description
  const canEdit = isOwner || isInvitee || isAssignee;

  const handleToggleTask = async () => {
    if (!canEdit) return;
    setLoading(true);
    const newStatus = event.taskStatus === 'completed' ? 'started' : 'completed';
    try {
      await updateDoc(doc(db, 'events', event.id), { taskStatus: newStatus });
      event.taskStatus = newStatus; // optimistic update
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAssignee = async (newId: string) => {
    if (!newId || newId === 'unassigned') return;
    setLoading(true);
    const updatedIds = Array.from(new Set([...assigneeIds, newId]));
    try {
      await updateDoc(doc(db, 'events', event.id), { assigneeIds: updatedIds, assigneeId: updatedIds[0] || null });
      event.assigneeIds = updatedIds;
      event.assigneeId = updatedIds[0] || null;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAssignee = async (removeId: string) => {
    setLoading(true);
    const updatedIds = assigneeIds.filter(id => id !== removeId);
    try {
      await updateDoc(doc(db, 'events', event.id), { assigneeIds: updatedIds, assigneeId: updatedIds[0] || null });
      event.assigneeIds = updatedIds;
      event.assigneeId = updatedIds[0] || null;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleChecklistItem = async (itemId: string) => {
    if (!canEdit) return;
    
    // Optimistic update
    const newChecklist = checklist.map(item => 
      item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
    );
    setChecklist(newChecklist);

    try {
      await updateDoc(doc(db, 'events', event.id), { checklistItems: newChecklist });
    } catch (e) {
      console.error("Failed to update checklist item:", e);
      // Revert on failure
      setChecklist(event.checklistItems || []);
    }
  };

  const handleStartTask = async () => {
    if (!canEdit) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'events', event.id), { taskStatus: 'started' });
      event.taskStatus = 'started'; // optimistic update
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner) return;
    if (!confirm('Are you sure you want to delete this event?')) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'events', event.id));
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const ownerId = event?.ownerId;
  const owner = ownerId ? (userMap[ownerId] || (ownerId === auth.currentUser?.uid ? {
    id: ownerId, 
    name: auth.currentUser?.displayName, 
    email: auth.currentUser?.email, 
    photoURL: auth.currentUser?.photoURL 
  } : null)) : null;

  const commonGroups = owner ? groups?.filter(g => g.members?.includes(owner.id)) || [] : [];

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-xl text-zinc-900 dark:text-zinc-100">{event.title}</h3>
            <div className="flex items-center gap-3 mt-1 relative">
              <p className="text-sm text-primary font-medium flex items-center gap-1">
                <CalendarIcon className="w-4 h-4" />
                {format(new Date(event.date), 'EEEE, MMMM d, yyyy')}
              </p>
              {owner && (
                <div className="relative">
                  <button type="button" onClick={() => setShowOwnerProfile(!showOwnerProfile)} className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition-all shadow-sm" title="View Owner">
                    {owner.photoURL ? (
                      <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                        {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                      </span>
                    )}
                  </button>
                  
                  {showOwnerProfile && (
                    <div className="absolute top-9 left-0 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-4 animate-in fade-in zoom-in duration-200">
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
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-base">{owner.name || owner.email?.split('@')[0]}</p>
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
          <div className="flex items-center gap-1">
            {canEdit && onEdit && (
              <button onClick={onEdit} className="p-2 text-primary hover:bg-primary/10 transition-colors rounded-full" title="Edit Event">
                <Edit2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors bg-zinc-100 dark:bg-zinc-800 rounded-full" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Task Status */}
          {event.isTask && (
            <div className="flex flex-col gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Task Ownership & Status</p>
                  {hasAssignee ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {assigneeIds.map(id => (
                        <span key={id} className="inline-flex items-center gap-1 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded-full text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {userMap[id]?.name || userMap[id]?.email?.split('@')[0] || 'Member'}
                          {(canEdit || id === auth.currentUser?.uid) && (
                            <button onClick={() => handleRemoveAssignee(id)} className="text-zinc-500 hover:text-red-500 transition-colors ml-1" title={`Remove ${id === auth.currentUser?.uid ? 'yourself' : 'member'}`}>
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500 mt-1">This task is currently unclaimed.</p>
                  )}
                </div>
                
                <select
                  value="unassigned"
                  onChange={(e) => handleAddAssignee(e.target.value)}
                  disabled={loading}
                  className="text-xs bg-primary/10 text-primary rounded-md font-medium px-2 py-1.5 outline-none border-none cursor-pointer hover:bg-primary/20 transition-colors shrink-0"
                >
                  <option value="unassigned" disabled>+ Assign Member</option>
                  {!isAssignee && <option value={auth.currentUser?.uid}>Assign to Me</option>}
                  {Object.values(userMap)
                    .filter((u: any) => !assigneeIds.includes(u.id))
                    .filter((u: any) => event.groupId ? groups?.find(g => g.id === event.groupId)?.members?.includes(u.id) : u.id === auth.currentUser?.uid)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name || u.email?.split('@')[0]}</option>
                  ))}
                </select>
              </div>
              

                <div className="flex items-center gap-2 pt-1">
                  {event.taskStatus === 'completed' ? (
                    <button 
                      onClick={handleToggleTask}
                      disabled={loading || !canEdit}
                      className="flex-1 py-2 px-4 bg-emerald-500 text-white rounded-lg flex items-center justify-center gap-2 font-medium shadow-sm"
                    >
                      <CheckCircle className="w-5 h-5" /> Completed
                    </button>
                  ) : event.taskStatus === 'started' ? (
                    <>
                      <div className="flex-1 py-2 px-4 bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg flex items-center justify-center font-medium border border-amber-500/30">
                        In Progress
                      </div>
                      <button 
                        onClick={handleToggleTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors shadow-sm"
                      >
                        <CheckCircle className="w-5 h-5" /> Finish
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={handleStartTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center justify-center font-medium transition-colors shadow-sm"
                      >
                        Start Task
                      </button>
                      <button 
                        onClick={handleToggleTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-zinc-200 dark:bg-zinc-700 hover:bg-emerald-500 hover:text-white text-zinc-700 dark:text-zinc-300 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors group shadow-sm"
                      >
                        <CheckCircle className="w-5 h-5 text-zinc-400 group-hover:text-white" /> Complete
                      </button>
                    </>
                  )}
                </div>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4" /> Notes
              </p>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                {event.description}
              </div>
            </div>
          )}

          {/* Interactive Checklist */}
          {checklist.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> To-Do List
              </p>
              <div className="space-y-2">
                {checklist.map((item) => (
                  <div key={item.id} className="flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <div className="flex items-start gap-3">
                      <button 
                        onClick={() => handleToggleChecklistItem(item.id)}
                        disabled={!canEdit}
                        className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                          item.isCompleted 
                            ? 'bg-emerald-500 border-emerald-500 text-white' 
                            : 'border-zinc-400 dark:border-zinc-500 text-transparent hover:border-primary'
                        }`}
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </button>
                      <span className={`text-sm flex-1 pt-0.5 ${item.isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {item.text}
                      </span>
                    </div>
                    {item.assetUrl && !item.isCompleted && (
                      <div className="ml-8 mt-1 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 self-start max-w-[200px] cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullScreenImage(item.assetUrl)}>
                        <img src={item.assetUrl} alt={item.text} className="w-full h-auto" />
                      </div>
                    )}
                    {item.assetId && !item.isCompleted && linkedChecklistAssets[item.assetId]?.barcodeValue && (
                      <div className="ml-8 mt-2 bg-white p-3 rounded-xl flex flex-col items-center justify-center border border-zinc-200 dark:border-zinc-700 self-start">
                        <p className="font-semibold text-zinc-900 mb-2 text-xs">{linkedChecklistAssets[item.assetId].name}</p>
                        {linkedChecklistAssets[item.assetId].barcodeFormat?.includes('QR') ? (
                          <QRCode value={linkedChecklistAssets[item.assetId].barcodeValue} size={100} />
                        ) : (
                          <div className="w-full flex justify-center overflow-hidden">
                            <Barcode 
                              value={linkedChecklistAssets[item.assetId].barcodeValue} 
                              format={linkedChecklistAssets[item.assetId].barcodeFormat === 'EAN_13' ? 'EAN13' : linkedChecklistAssets[item.assetId].barcodeFormat === 'EAN_8' ? 'EAN8' : linkedChecklistAssets[item.assetId].barcodeFormat === 'UPC_A' ? 'UPC' : linkedChecklistAssets[item.assetId].barcodeFormat === 'CODE_39' ? 'CODE39' : 'CODE128'}
                              width={1.5}
                              height={50}
                              displayValue={true}
                              background="#ffffff"
                              lineColor="#000000"
                              fontSize={12}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked Asset Barcode / Details */}
          {linkedAsset && linkedAsset.barcodeValue && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Wallet className="w-4 h-4" /> Linked Asset Code
              </p>
              <div className="bg-white p-4 rounded-xl flex flex-col items-center justify-center w-full min-h-[150px] border border-zinc-200 dark:border-zinc-700">
                <p className="font-semibold text-zinc-900 mb-4 text-center">{linkedAsset.name}</p>
                {linkedAsset.barcodeFormat?.includes('QR') ? (
                  <QRCode value={linkedAsset.barcodeValue} size={150} />
                ) : (
                  <div className="w-full flex justify-center overflow-hidden">
                    <Barcode 
                      value={linkedAsset.barcodeValue} 
                      format={linkedAsset.barcodeFormat === 'EAN_13' ? 'EAN13' : linkedAsset.barcodeFormat === 'EAN_8' ? 'EAN8' : linkedAsset.barcodeFormat === 'UPC_A' ? 'UPC' : linkedAsset.barcodeFormat === 'CODE_39' ? 'CODE39' : 'CODE128'}
                      width={2}
                      height={80}
                      displayValue={true}
                      background="#ffffff"
                      lineColor="#000000"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Image Attachment */}
          {event.imageUrl && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4" /> Attached Asset
              </p>
              <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullScreenImage(event.imageUrl)}>
                <img src={event.imageUrl} alt="Event attachment" className="w-full h-auto max-h-48 object-contain" />
              </div>
            </div>
          )}
          
        </div>

        {/* Footer */}
        {isOwner && (
          <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end">
            <button 
              onClick={handleDelete}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete Event
            </button>
          </div>
        )}

      </div>

      {/* Full Screen Image Modal */}
      {fullScreenImage && (
        <div onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }} className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-pointer">
          <img src={fullScreenImage} className="max-w-full max-h-full object-contain animate-in fade-in zoom-in duration-200" alt="Full screen asset" />
          <button className="absolute top-4 right-4 text-white/50 hover:text-white bg-black/50 hover:bg-black/80 transition-all p-2 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
