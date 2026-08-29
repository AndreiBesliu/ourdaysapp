import React, { useState, useEffect } from 'react';
import { auth, db, storage } from '../firebase';
import { collection, query, addDoc, updateDoc, deleteDoc, doc, getDoc, where } from 'firebase/firestore';
import { reportError } from '../reportError';
import { liveQuery, liveDoc } from '../utils/liveQuery';
import { ref, uploadBytes, getDownloadURL, listAll } from 'firebase/storage';
import { Wallet as WalletIcon, Plus, Image as ImageIcon, Trash2, Users, User, HeartPulse, Home, Car, DollarSign, Settings2, Folder, Edit2, Check, X, ScanLine, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import Barcode from 'react-barcode';
import QRCode from 'react-qr-code';
import ExpensesTab from '../components/ExpensesTab';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { transferAssetCopy } from '../serverActions';

// One list, used by the initial state and by both fallbacks below.
const DEFAULT_CATEGORIES = ['Home & Living', 'Health & Medical', 'Vehicles', 'Financial'];

export default function Wallet() {
  const [assets, setAssets] = useState<any[]>([]);
  const [assetsLoadError, setAssetsLoadError] = useState(false);
  const [categoryError, setCategoryError] = useState(false);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [isAdding, setIsAdding] = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'assets' | 'expenses'>('assets');
  
  // Modal states
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [isManagingFilters, setIsManagingFilters] = useState(false);
  const [editingFilter, setEditingFilter] = useState<string | null>(null);
  const [editFilterValue, setEditFilterValue] = useState('');
  const [newFilterValue, setNewFilterValue] = useState('');
  const [viewingAssetCode, setViewingAssetCode] = useState<any | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [pastImages, setPastImages] = useState<string[]>([]);
  const [showPastImages, setShowPastImages] = useState(false);
  const [selectedPastImageUrl, setSelectedPastImageUrl] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isShared, setIsShared] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [barcodeFormat, setBarcodeFormat] = useState('');
  const [loading, setLoading] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [sharedUsers, setSharedUsers] = useState<any[]>([]);
  // The ids were being thrown away — `doc.data()` only — and an expense needs the group it
  // belongs to, not just who is in it.
  const [myGroups, setMyGroups] = useState<{ id: string; name: string; members: string[] }[]>([]);
  const { language } = useThemeStore();

  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.currentUser) return;
    
    // Fetch the current user's assets. Must be filtered server-side by ownerId:
    // the Firestore rules only allow reading assets you own, so an unfiltered
    // query is rejected (permission-denied). (sharedWithFamily assets owned by
    // others aren't readable under the current rule — see DEVLOG deferred work.)
    const uid = auth.currentUser.uid;
    const q = query(collection(db, 'assets'), where('ownerId', '==', uid));

    const unsubscribe = liveQuery<any>(q, 'Wallet.assets',
      (docs) => { setAssetsLoadError(false); setAssets(docs); },
      () => setAssetsLoadError(true));

    const unsubUser = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'Wallet.userDoc',
      (data) => setCategories(data?.walletCategories || DEFAULT_CATEGORIES),
      // Falling back to the defaults is right here — but only after the failure is on record,
      // otherwise a denied read looks like "this account has no custom categories".
      () => setCategories(DEFAULT_CATEGORIES));

    const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', auth.currentUser.uid));
    const unsubGroups = liveQuery<any>(qGroups, 'Wallet.groups', async (fetchedGroups) => {
      setMyGroups(fetchedGroups.map(g => ({ id: g.id, name: g.name || 'Group', members: Array.isArray(g.members) ? g.members : [] })));
      const memberIds = new Set<string>();
      fetchedGroups.forEach((g: any) => g.members?.forEach((id: string) => memberIds.add(id)));
      
      // Same shape and same reason as the member map in CalendarHome: this runs inside
      // liveQuery's async callback, which nothing awaits. One rejection used to discard every
      // profile already read — and on this screen that turns the expenses balance sheet into a
      // column of "Someone", with the transfer-recipient picker gone, while the balances
      // themselves still compute and look fine.
      const fetchedUsers: any[] = [];
      try {
        for (const id of Array.from(memberIds)) {
          if (id === auth.currentUser?.uid) continue;
          try {
            // Read other members from the public `profiles` collection (not the
            // soon-to-be owner-only `users` collection).
            const profileDoc = await getDoc(doc(db, 'profiles', id));
            if (profileDoc.exists()) {
              fetchedUsers.push({ id, ...profileDoc.data() });
            }
          } catch (err) {
            reportError(err instanceof Error ? err.message : String(err), { context: 'Wallet.memberProfile' });
          }
        }
      } finally {
        setSharedUsers(fetchedUsers);
      }
    }, () => { setMyGroups([]); setSharedUsers([]); });

    return () => {
      unsubscribe();
      unsubUser();
      unsubGroups();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAdding(false);
        setIsManagingFilters(false);
        setEditingAsset(null);
        setViewingImage(null);
        setViewingAssetCode(null);
        setIsScanning(false);
        setShowPastImages(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !name.trim() || selectedCategories.length === 0) {
      alert('Please provide a name and select at least one category.');
      return;
    }
    setLoading(true);

    try {
      let url = editingAsset ? editingAsset.imageUrl : null;
      if (file) {
        const fileRef = ref(storage, `assets/${auth.currentUser.uid}/${Date.now()}_${file.name}`);
        const buffer = await file.arrayBuffer();
        const uploadTask = uploadBytes(fileRef, buffer, { contentType: file.type });
        const timeoutTask = new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out. Storage might be blocked.')), 15000));
        await Promise.race([uploadTask, timeoutTask]);
        url = await getDownloadURL(fileRef);
      } else if (selectedPastImageUrl) {
        url = selectedPastImageUrl;
      }

      const assetData = {
        name,
        categories: selectedCategories,
        category: selectedCategories[0] || 'Uncategorized',
        imageUrl: url,
        sharedWithFamily: isShared,
        barcodeValue: barcodeValue || null,
        barcodeFormat: barcodeFormat || null
      };

      if (editingAsset) {
        if (transferToUserId) {
          if (keepCopy) {
            // Apply edits to the kept original, then create the recipient's copy
            // server-side (clients can only create assets they own).
            await updateDoc(doc(db, 'assets', editingAsset.id), assetData);
            await transferAssetCopy({ assetId: editingAsset.id, recipientId: transferToUserId });
          } else {
            // Transfer completely
            await updateDoc(doc(db, 'assets', editingAsset.id), { ...assetData, ownerId: transferToUserId });
          }
        } else {
          await updateDoc(doc(db, 'assets', editingAsset.id), assetData);
        }
        setEditingAsset(null);
      } else {
        await addDoc(collection(db, 'assets'), {
          ...assetData,
          ownerId: auth.currentUser.uid,
          createdAt: new Date().toISOString()
        });
        setIsAdding(false);
      }

      setName('');
      setSelectedCategories([]);
      setFile(null);
      setSelectedPastImageUrl(null);
      setBarcodeValue('');
      setBarcodeFormat('');
      setIsShared(false);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to save asset: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, isOwner: boolean) => {
    if (!isOwner) return alert("You can only delete your own assets.");
    if (!confirm('Delete this asset? If it is used in an event, it will still exist there.')) return;
    try {
      await deleteDoc(doc(db, 'assets', id));
    } catch (err) {
      console.error(err);
    }
  };

  const openEditModal = (asset: any) => {
    setEditingAsset(asset);
    setName(asset.name);
    setSelectedCategories(asset.categories && asset.categories.length > 0 ? asset.categories : (asset.category ? [asset.category] : []));
    setIsShared(asset.sharedWithFamily || false);
    setBarcodeValue(asset.barcodeValue || '');
    setBarcodeFormat(asset.barcodeFormat || '');
    setFile(null);
    setSelectedPastImageUrl(null);
    setTransferToUserId('');
    setKeepCopy(true);
  };

  const openAddModal = () => {
    setEditingAsset(null);
    setName('');
    setSelectedCategories([]);
    setIsShared(false);
    setBarcodeValue('');
    setBarcodeFormat('');
    setFile(null);
    setSelectedPastImageUrl(null);
    setIsAdding(true);
  };

  const getCategoryIcon = (catName: string, active: boolean) => {
    const className = `w-7 h-7 mb-2 transition-all ${active ? 'scale-110' : 'group-hover:scale-110'}`;
    switch(catName) {
      case 'Home & Living': return <Home className={className} />;
      case 'Health & Medical': return <HeartPulse className={className} />;
      case 'Vehicles': return <Car className={className} />;
      case 'Financial': return <DollarSign className={className} />;
      default: return <Folder className={className} />;
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilterValue.trim() || !auth.currentUser) return;
    if (categories.includes(newFilterValue.trim())) return alert("Category already exists");
    
    setLoading(true);
    try {
      const newCats = [...categories, newFilterValue.trim()];
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { walletCategories: newCats });
      setNewFilterValue('');
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const openPastImages = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const urls = new Set<string>();
      
      const fetchAllFromRef = async (folderRef: any) => {
        try {
          const res = await listAll(folderRef);
          
          // Get all files in current directory
          await Promise.all(res.items.map(async (itemRef) => {
            try {
              const url = await getDownloadURL(itemRef);
              urls.add(url);
            } catch (e) {
              // Ignore files that can't be downloaded (permissions, etc)
            }
          }));
          
          // Recursively search subdirectories
          await Promise.all(res.prefixes.map(prefixRef => fetchAllFromRef(prefixRef)));
        } catch (e) {
          console.warn("Could not list directory", folderRef.fullPath, e);
        }
      };

      // Only scan the CURRENT user's own upload folders (previously scanned every
      // user's files across the whole bucket — a privacy leak; also Storage rules
      // now block cross-user enumeration).
      const uid = auth.currentUser?.uid;
      if (!uid) { setLoading(false); return; }
      const roots = [`assets/${uid}`, `events/${uid}`, `checklists/${uid}`].map(path => ref(storage, path));
      await Promise.all(roots.map(rootRef => fetchAllFromRef(rootRef)));
      
      setPastImages(Array.from(urls));
      setShowPastImages(true);
    } catch (e) {
      console.error('Failed to fetch past images', e);
    }
    setLoading(false);
  };

  const handleUpdateCategory = async (oldName: string) => {
    if (!editFilterValue.trim() || !auth.currentUser || editFilterValue.trim() === oldName) {
      setEditingFilter(null);
      return;
    }
    const newName = editFilterValue.trim();
    if (categories.includes(newName)) return alert("Category already exists");

    setLoading(true);
    setCategoryError(false);
    try {
      const newCats = categories.map(c => c === oldName ? newName : c);
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { walletCategories: newCats });
      
      // Assets carry BOTH `categories[]` (what every read path uses — the filter and the
      // grouping) and the legacy single `category`. The rename only patched the legacy field, so
      // afterwards the chip showed the new name while the assets stayed grouped under the old one,
      // which no longer existed in the list. Both are rewritten, and the selection has to look at
      // both too or assets that only have the array are missed.
      //
      // The ownerId term stays: the assets rule permits updates by the owner only, so including a
      // shared asset would turn this into a guaranteed partial failure.
      const assetsToUpdate = assets.filter(
        (a) => (a.categories?.includes(oldName) || a.category === oldName) && a.ownerId === auth.currentUser?.uid,
      );
      await Promise.all(assetsToUpdate.map((a) => updateDoc(doc(db, 'assets', a.id), {
        categories: (a.categories || [a.category]).map((c: string) => (c === oldName ? newName : c)),
        category: a.category === oldName ? newName : a.category,
      })));
      
      if (activeFilters.includes(oldName)) {
        setActiveFilters(prev => prev.map(f => f === oldName ? newName : f));
      }
      setEditingFilter(null);
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.renameCategory' });
      // Its own flag, not assetsLoadError: that one only renders when the list is EMPTY, so
      // reusing it here would have shown nothing at all in the one case that matters.
      setCategoryError(true);
    }
    setLoading(false);
  };

  const handleRemoveCategory = async (catName: string) => {
    if (!auth.currentUser) return;
    if (!confirm(`Delete category "${catName}"?\nAssets inside will be marked as "Uncategorized".`)) return;
    
    setLoading(true);
    try {
      const newCats = categories.filter(c => c !== catName);
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { walletCategories: newCats });
      
      const assetsToUpdate = assets.filter(a => a.category === catName && a.ownerId === auth.currentUser?.uid);
      await Promise.all(assetsToUpdate.map(a => updateDoc(doc(db, 'assets', a.id), { category: 'Uncategorized' })));
      
      if (activeFilters.includes(catName)) {
        setActiveFilters(prev => prev.filter(f => f !== catName));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // If active filters are selected, we just show matching assets in a flat list to avoid duplication
  // If no filters are selected, we group by the PRIMARY category (the first one) to avoid duplication
  const filteredAssets = activeFilters.length > 0 
    ? assets.filter(a => {
        const cats = a.categories && a.categories.length > 0 ? a.categories : (a.category ? [a.category] : ['Uncategorized']);
        return activeFilters.every(f => cats.includes(f));
      })
    : [];

  const groupedAssets = activeFilters.length === 0 ? assets.reduce((acc: any, asset: any) => {
    const primaryCat = (asset.categories && asset.categories.length > 0) 
      ? asset.categories[0] 
      : (asset.category || 'Uncategorized');
      
    if (!acc[primaryCat]) acc[primaryCat] = [];
    acc[primaryCat].push(asset);
    return acc;
  }, {}) : {};

  const renderAssetCard = (asset: any) => {
    const isOwner = asset.ownerId === auth.currentUser?.uid;
    const handleCardClick = () => {
      if (isOwner) openEditModal(asset);
    };

    return (
      <div 
        key={asset.id} 
        onClick={handleCardClick}
        className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm group flex flex-col ${isOwner ? 'cursor-pointer hover:border-emerald-500/50 hover:shadow-md transition-all' : ''}`}
      >
        <div 
          className={`h-32 bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center group/img ${asset.imageUrl ? 'cursor-pointer' : ''}`} 
          onClick={(e) => {
            if (asset.imageUrl) {
              e.stopPropagation();
              setViewingImage(asset.imageUrl);
            }
          }}
        >
          {asset.imageUrl ? (
            <>
              <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover transition-all group-hover/img:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover/img:opacity-100 text-white font-medium text-sm drop-shadow-md">View</span>
              </div>
            </>
          ) : asset.barcodeValue ? (
            <div 
              className="flex flex-col items-center justify-center text-zinc-400 group-hover:text-emerald-500 transition-colors w-full h-full cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setViewingAssetCode(asset);
              }}
            >
              <QrCode className="w-10 h-10 mb-2 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-600">{t('walletTapToScan', language)}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-zinc-400 group-hover:text-emerald-500 transition-colors">
              <WalletIcon className="w-8 h-8 mb-2 opacity-50 group-hover:opacity-100 transition-opacity" />
              <span className="text-xs font-medium">{t('walletNoImage', language)}</span>
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col relative">
          {asset.barcodeValue && asset.imageUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setViewingAssetCode(asset);
              }}
              className="absolute -top-6 right-3 bg-white dark:bg-zinc-800 p-2 rounded-full shadow-lg border border-zinc-200 dark:border-zinc-700 text-emerald-500 hover:text-emerald-600 hover:scale-110 transition-all"
              title={t('showCode', language)}
            >
              <QrCode className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-start justify-between gap-2 mt-1">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100 line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{asset.name}</p>
              <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
                {asset.sharedWithFamily ? <Users className="w-3 h-3 text-emerald-500" /> : <User className="w-3 h-3" />}
                {asset.sharedWithFamily ? 'Shared' : 'Private'}
              </div>
            </div>
            {isOwner && (
              <div className="flex items-center gap-1 shrink-0">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditModal(asset);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors"
                  title={t('editAsset', language)}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(asset.id, true);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                  title={t('deleteAsset', language)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col pb-24 pt-[60px]">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
       <div className="max-w-5xl w-full mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 -ml-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
            <Home className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-emerald-500">
          <WalletIcon className="w-6 h-6" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{t('wallet', language)}</h1>
        </div>
        </div>
        {activeTab === 'assets' && (
          <button
            onClick={openAddModal}
            className="p-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
       </div>
      </header>

      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 pt-2 sticky top-[60px] z-40">
        <div className="max-w-5xl mx-auto flex gap-6">
          <button 
            onClick={() => setActiveTab('assets')}
            className={`pb-3 text-sm font-bold transition-colors ${activeTab === 'assets' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            Assets
          </button>
          <button 
            onClick={() => setActiveTab('expenses')}
            className={`pb-3 text-sm font-bold transition-colors ${activeTab === 'expenses' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            {t('expensesTitle', language)}
          </button>
        </div>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-8">
        
        {activeTab === 'expenses' ? (
          <ExpensesTab sharedUsers={sharedUsers} myGroups={myGroups} />
        ) : (
          <>
        {/* Categories Panel */}
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">{t('walletQuickFilters', language)}</h2>
            <button onClick={() => setIsManagingFilters(true)} className="text-xs text-emerald-500 hover:text-emerald-600 flex items-center gap-1 font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md transition-colors">
              <Settings2 className="w-3.5 h-3.5" /> {t('walletManage', language)}
            </button>
          </div>
          {categoryError && (
            <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">{t('categoryRenameFailed', language)}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {categories.map(cat => {
              const isActive = activeFilters.includes(cat);
              return (
                <button 
                  key={cat}
                  onClick={() => setActiveFilters(isActive ? activeFilters.filter(f => f !== cat) : [...activeFilters, cat])}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all group ${isActive ? 'bg-emerald-500 border-emerald-500 text-white shadow-md' : 'border-zinc-100 dark:border-zinc-800 bg-emerald-50/50 dark:bg-emerald-500/5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}
                >
                  {getCategoryIcon(cat, isActive)}
                  <span className="text-sm font-semibold line-clamp-1">{cat}</span>
                </button>
              );
            })}
          </div>
        </section>

        {assets.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-20 text-center ${assetsLoadError ? 'text-rose-600 dark:text-rose-400' : 'opacity-50'}`}>
            <WalletIcon className="w-16 h-16 mb-4" />
            <p className="text-lg font-medium">{assetsLoadError ? t('assetsLoadFailed', language) : t('walletNoAssets', language)}</p>
            {!assetsLoadError && <p className="text-sm">{t('walletNoAssetsHint', language)}</p>}
          </div>
        ) : activeFilters.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-3 pl-1 border-l-4 border-emerald-500">
              <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 pl-2">{t('walletMatchingAssets', language)}</h2>
            </div>
            {filteredAssets.length === 0 ? (
              <p className="text-zinc-500 italic">{t('walletNoMatch', language)}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredAssets.map(asset => renderAssetCard(asset))}
              </div>
            )}
          </div>
        ) : (
          Object.keys(groupedAssets).map(catName => (
            <div key={catName}>
              <div className="flex items-center justify-between mb-3 pl-1 border-l-4 border-emerald-500">
                <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 pl-2">{catName}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {groupedAssets[catName].map((asset: any) => renderAssetCard(asset))}
              </div>
            </div>
          ))
        )}

          </>
        )}
      </main>

      {/* Add/Edit Asset Modal */}
      {(isAdding || editingAsset) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h3 className="font-bold text-lg mb-4 text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              {editingAsset ? <Edit2 className="w-5 h-5 text-emerald-500" /> : <Plus className="w-5 h-5 text-emerald-500" />} 
              {editingAsset ? 'Edit Asset' : 'Add New Asset'}
            </h3>
            
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase">Name</label>
                <input required value={name} onChange={e => setName(e.target.value)} type="text" placeholder="e.g. Kroger Card" className="w-full mt-1 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 outline-none" />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase">{t('walletCategoriesLabel', language)}</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => {
                    const isSelected = selectedCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedCategories(prev => prev.filter(c => c !== cat));
                          } else {
                            setSelectedCategories(prev => [...prev, cat]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          isSelected
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-emerald-500'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 h-32">
                <div className="flex-1 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center relative overflow-hidden group">
                  <input type="file" id="asset-upload" className="hidden" accept="image/*" onChange={(e) => {
                    if (e.target.files) {
                      setFile(e.target.files[0]);
                      setSelectedPastImageUrl(null);
                    }
                  }} />
                  {(file || selectedPastImageUrl || (editingAsset && editingAsset.imageUrl)) ? (
                    <>
                      <img 
                        src={file ? URL.createObjectURL(file) : (selectedPastImageUrl || editingAsset?.imageUrl)} 
                        alt="Preview" 
                        className="w-full h-full object-cover" 
                      />
                      <label htmlFor="asset-upload" className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-white">
                         <span className="text-xs font-medium">{t('walletChangeImage', language)}</span>
                      </label>
                    </>
                  ) : (
                    <label htmlFor="asset-upload" className="cursor-pointer flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors w-full h-full p-3">
                      <ImageIcon className="w-5 h-5" />
                      <span className="text-xs font-medium">{t('uploadImage', language)}</span>
                    </label>
                  )}
                </div>
                
                <div className="flex-1 flex flex-col gap-2">
                  <button type="button" onClick={openPastImages} className="flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed bg-zinc-50 dark:bg-zinc-800/30">
                    <Folder className="w-4 h-4" />
                    <span className="text-[10px] font-medium leading-tight">{t('walletPickFromPast', language)}</span>
                  </button>
                  <div className="flex-1 min-h-0 overflow-hidden p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center flex flex-col justify-center items-center">
                    {barcodeValue ? (
                      <div className="text-center">
                        <p className="text-[10px] text-emerald-500 font-bold mb-0.5">{t('walletScanned', language)}</p>
                        <p className="text-[9px] text-zinc-500 truncate w-16 mx-auto" title={barcodeValue}>{barcodeValue}</p>
                        <button type="button" onClick={() => { setBarcodeValue(''); setBarcodeFormat(''); }} className="text-[9px] text-red-500 hover:underline">{t('walletRemove', language)}</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setIsScanning(true)} className="flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors w-full h-full">
                        <ScanLine className="w-4 h-4" />
                        <span className="text-[10px] font-medium">{t('walletScanCode', language)}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('walletShareAsset', language)}</p>
                  <p className="text-xs text-zinc-500">{t('walletShareHint', language)}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={isShared} onChange={e => setIsShared(e.target.checked)} />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {editingAsset && editingAsset.ownerId === auth.currentUser?.uid && sharedUsers.length > 0 && (
                <div className="flex flex-col gap-3 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                  <div className="flex flex-col">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('walletTransferAsset', language)}</p>
                    <p className="text-xs text-zinc-500">{t('walletTransferHint', language)}</p>
                  </div>
                  <select
                    value={transferToUserId}
                    onChange={e => setTransferToUserId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500"
                  >
                    <option value="">{t('walletKeepOwnership', language)}</option>
                    {sharedUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                  {transferToUserId && (
                    <label className="flex items-center gap-2 cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={keepCopy}
                        onChange={e => setKeepCopy(e.target.checked)}
                        className="w-4 h-4 text-emerald-500 bg-zinc-100 border-zinc-300 rounded focus:ring-emerald-500 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                      />
                      <span className="text-xs text-zinc-700 dark:text-zinc-300">{t('walletKeepCopy', language)}</span>
                    </label>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setIsAdding(false); setEditingAsset(null); }} className="flex-1 py-2 text-zinc-600 dark:text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg">{t('walletCancel', language)}</button>
                <button type="submit" disabled={loading} className="flex-1 py-2 text-white font-medium bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Manage Filters Modal */}
      {isManagingFilters && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-emerald-500" /> {t('walletManage', language)} Filters
              </h3>
              <button onClick={() => setIsManagingFilters(false)} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {categories.map(cat => (
                <div key={cat} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  {editingFilter === cat ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input 
                        type="text" 
                        value={editFilterValue} 
                        onChange={e => setEditFilterValue(e.target.value)} 
                        className="flex-1 px-2 py-1 text-sm border rounded bg-white dark:bg-zinc-800 dark:border-zinc-600 outline-none focus:border-emerald-500"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateCategory(cat)} disabled={loading} className="p-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingFilter(null)} disabled={loading} className="p-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(cat, false)}
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{cat}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingFilter(cat); setEditFilterValue(cat); }} className="p-1.5 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRemoveCategory(cat)} className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            
            <form onSubmit={handleCreateCategory} className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 rounded-b-2xl flex gap-2">
              <input 
                required 
                value={newFilterValue} 
                onChange={e => setNewFilterValue(e.target.value)} 
                type="text" 
                placeholder="New category name" 
                className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500" 
              />
              <button type="submit" disabled={loading} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-1">
                <Plus className="w-4 h-4" /> Add
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Past Images Modal */}
      {showPastImages && (
        <div onClick={() => setShowPastImages(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Folder className="w-5 h-5 text-emerald-500" />
                Select Past Upload
              </h3>
              <button onClick={() => setShowPastImages(false)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 bg-zinc-100/50 dark:bg-zinc-900/50">
              {pastImages.length === 0 ? (
                <div className="text-center py-10 text-zinc-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>{t('walletNoPastImages', language)}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {pastImages.map((url, i) => (
                    <div 
                      key={i}
                      onClick={() => {
                        setSelectedPastImageUrl(url);
                        setFile(null);
                        setShowPastImages(false);
                      }}
                      className="group cursor-pointer bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden hover:border-emerald-500 hover:shadow-md transition-all relative aspect-square"
                    >
                      <img src={url} alt="Past upload" className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300" />
                      <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/20 transition-colors flex items-center justify-center">
                        <Check className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all drop-shadow-md" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner View */}
      {isScanning && (
        <BarcodeScanner 
          onScan={(value, format) => {
            setBarcodeValue(value);
            setBarcodeFormat(format);
            setIsScanning(false);
          }} 
          onClose={() => setIsScanning(false)} 
        />
      )}

      {/* Generated Barcode Viewer Modal */}
      {viewingAssetCode && (
        <div onClick={() => setViewingAssetCode(null)} className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-8 max-w-sm w-full flex flex-col items-center shadow-2xl relative">
            <button onClick={() => setViewingAssetCode(null)} className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-900 bg-zinc-100 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-zinc-900 mb-6 text-center">{viewingAssetCode.name}</h3>
            
            <div className="bg-white p-4 rounded-xl flex items-center justify-center w-full min-h-[150px]">
              {viewingAssetCode.barcodeFormat?.includes('QR') ? (
                <QRCode value={viewingAssetCode.barcodeValue} size={200} />
              ) : (
                <div className="w-full flex justify-center overflow-hidden">
                  <Barcode 
                    value={viewingAssetCode.barcodeValue} 
                    format={viewingAssetCode.barcodeFormat === 'EAN_13' ? 'EAN13' : viewingAssetCode.barcodeFormat === 'EAN_8' ? 'EAN8' : viewingAssetCode.barcodeFormat === 'UPC_A' ? 'UPC' : viewingAssetCode.barcodeFormat === 'CODE_39' ? 'CODE39' : 'CODE128'}
                    width={2}
                    height={100}
                    displayValue={true}
                    background="#ffffff"
                    lineColor="#000000"
                  />
                </div>
              )}
            </div>
            
            <p className="mt-6 text-sm text-zinc-500 text-center">
              Present this code to the scanner. Turn up your screen brightness if necessary.
            </p>
          </div>
        </div>
      )}

      {/* Fullscreen Image Viewer Modal */}
      {viewingImage && (
        <div 
          onClick={() => setViewingImage(null)} 
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200"
        >
          <button 
            onClick={() => setViewingImage(null)} 
            className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img 
            src={viewingImage} 
            alt="Asset full view" 
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-200" 
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image itself
          />
        </div>
      )}
    </div>
  );
}
