import React, { useState, useEffect } from 'react';
import { auth, db, storage } from '../firebase';
import { collection, query, addDoc, updateDoc, deleteDoc, doc, getDoc, where } from 'firebase/firestore';
import { reportError } from '../reportError';
import { liveQuery, liveDoc } from '../utils/liveQuery';
import { ref, getDownloadURL, listAll } from 'firebase/storage';
import { uploadFile, UploadStalled } from '../utils/uploadFile';
import { Wallet as WalletIcon, Plus, Image as ImageIcon, Trash2, Users, User, HeartPulse, Home, Car, DollarSign, Settings2, Folder, Edit2, Check, X, ScanLine, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { useDialog } from '../hooks/useDialog';
import AssetBarcode from '../components/AssetBarcode';
import ExpensesTab from '../components/ExpensesTab';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { transferAssetCopy } from '../serverActions';
import {
  canEdit, groupNameOf, mergeAssets, shareFieldsFor, shareKindOf, shareListenerGroupIds,
  shareTargetOf,
} from '../utils/assetSharing';
import {
  UNCATEGORIZED, categoriesOf, affectedByRemoval, afterRemoval, orphanCategories,
} from '../utils/walletCategories';

// One list, used by the initial state and by both fallbacks below.
const DEFAULT_CATEGORIES = ['Home & Living', 'Health & Medical', 'Vehicles', 'Financial'];

export default function Wallet() {
  // Two listeners, because one query cannot express "mine, or shared with a group I am in".
  // Kept apart in state rather than merged on arrival so that a failure in one does not empty
  // the other — the same reason the asset listener does not clear its list on error.
  const [ownedAssets, setOwnedAssets] = useState<any[]>([]);
  const [sharedAssets, setSharedAssets] = useState<Record<string, any[]>>({});
  const assets = React.useMemo(
    () => mergeAssets(ownedAssets, Object.values(sharedAssets)),
    [ownedAssets, sharedAssets],
  );
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
  // The GROUP an asset is shared with, or null for private. A boolean cannot answer
  // "shared with which family?" the moment a person belongs to two.
  const [shareGroupId, setShareGroupId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [barcodeFormat, setBarcodeFormat] = useState('');
  const [loading, setLoading] = useState(false);
  // Null while nothing is uploading, and while the total size is not known yet. A 10 MB photo
  // used to be fifteen seconds of a button that did nothing and then an error.
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
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
    
    // The assets this user OWNS. Filtered server-side by ownerId because a list query is
    // validated against the rules without reading a document: the constraint has to guarantee
    // the rule, it cannot be filtered afterwards. Assets shared WITH this user arrive from the
    // per-group listeners in the effect below.
    const uid = auth.currentUser.uid;
    const q = query(collection(db, 'assets'), where('ownerId', '==', uid));

    const unsubscribe = liveQuery<any>(q, 'Wallet.assets',
      (docs) => { setAssetsLoadError(false); setOwnedAssets(docs); },
      () => setAssetsLoadError(true));

    const unsubUser = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'Wallet.userDoc',
      (data) => setCategories(data?.walletCategories || DEFAULT_CATEGORIES),
      // Falling back to the defaults is right here — but only after the failure is on record,
      // otherwise a denied read looks like "this account has no custom categories".
      () => setCategories(DEFAULT_CATEGORIES));

    const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', auth.currentUser.uid));
    const unsubGroups = liveQuery<any>(qGroups, 'Wallet.groups', async (fetchedGroups) => {
      setMyGroups(fetchedGroups.map(g => ({ id: g.id, name: g.name || t('group', language), members: Array.isArray(g.members) ? g.members : [] })));
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

  // Assets other people shared with a group this user belongs to.
  //
  // One listener per group, not one `in` query over all of them: the read rule calls
  // `isMemberOfGroup` per document, each call costs two document accesses inside the rule, and a
  // query is capped at twenty. One group per listener keeps that at two no matter how many
  // groups a person joins — a ceiling that cannot be reached instead of one that is merely far
  // away.
  const groupIdsKey = shareListenerGroupIds(myGroups).join(',');
  useEffect(() => {
    if (!auth.currentUser) return;
    const groupIds = groupIdsKey ? groupIdsKey.split(',') : [];

    // Drop groups we have left, so their assets do not linger in a list that outlives access.
    setSharedAssets((prev) => {
      const next: Record<string, any[]> = {};
      for (const id of groupIds) if (prev[id]) next[id] = prev[id];
      return next;
    });

    const unsubs = groupIds.map((groupId) =>
      liveQuery<any>(
        query(collection(db, 'assets'), where('sharedGroupId', '==', groupId)),
        `Wallet.sharedAssets.${groupId}`,
        (docs) => setSharedAssets((prev) => ({ ...prev, [groupId]: docs })),
        // No clearing on failure, for the same reason as the owned listener: a denied or dropped
        // read must not be rendered as "nobody shared anything with you".
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [groupIdsKey]);

  // Five dialogs, five identities. This used to be ONE Escape handler that reset all seven
  // pieces of state at once, so dismissing the picture viewer stacked above a half-filled asset
  // form threw the form away with it. Each one now answers only while it is the dialog on top.
  const assetForm = useDialog(Boolean(isAdding || editingAsset), () => {
    setIsAdding(false);
    setEditingAsset(null);
  }, { label: editingAsset ? t('editAsset', language) : t('addNewAsset', language) });

  const filtersDialog = useDialog(isManagingFilters, () => {
    setIsManagingFilters(false);
    // Cleared with the dialog: an abandoned half-typed rename used to survive, so reopening
    // Manage Filters found that category still in edit mode with the old text in it.
    setEditingFilter(null);
  }, { label: t('walletManageFilters', language) });

  const pastImagesDialog = useDialog(showPastImages, () => setShowPastImages(false),
    { label: t('selectPastUpload', language) });

  const codeDialog = useDialog(Boolean(viewingAssetCode), () => setViewingAssetCode(null),
    { label: viewingAssetCode?.name });

  const imageDialog = useDialog(Boolean(viewingImage), () => setViewingImage(null),
    { label: t('walletImageViewer', language) });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !name.trim() || selectedCategories.length === 0) {
      alert(t('assetNeedsNameAndCategory', language));
      return;
    }
    setLoading(true);

    try {
      let url = editingAsset ? editingAsset.imageUrl : null;
      if (file) {
        // This raced a fifteen-second timer against an upload that could not be cancelled, so a
        // slow photo reported failure and then finished, leaving a file nobody points at. One of
        // the two orphans measured in the live bucket is under `assets/`, which is this line.
        // See src/utils/uploadWatch.ts for what replaced the duration.
        url = await uploadFile(
          `assets/${auth.currentUser.uid}/${Date.now()}_${file.name}`,
          await file.arrayBuffer(),
          { contentType: file.type, onProgress: setUploadPercent },
        );
      } else if (selectedPastImageUrl) {
        url = selectedPastImageUrl;
      }

      const assetData = {
        name,
        categories: selectedCategories,
        category: selectedCategories[0] || UNCATEGORIZED,
        imageUrl: url,
        ...shareFieldsFor(shareGroupId),
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
            // Hand it over entirely. This used to be a client `updateDoc` that set `ownerId` to
            // the recipient — which the rule allowed, because it only checked the owner the
            // document already had. Same callable as the keep-a-copy branch now, so both go
            // through the shared-group check the app always meant to apply.
            await updateDoc(doc(db, 'assets', editingAsset.id), assetData);
            await transferAssetCopy({ assetId: editingAsset.id, recipientId: transferToUserId, mode: 'move' });
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
      setShareGroupId(null);
    } catch (err: any) {
      // A stalled upload is its own thing, and worth saying out loud: the old message blamed
      // Storage being blocked, which the code had no way to know and which was almost never the
      // cause. It also only reached console.error, so nothing about it ever left the device.
      reportError(err instanceof Error ? err.message : String(err), { context: 'Wallet.upload' });
      alert(t(err instanceof UploadStalled ? 'uploadStalled' : 'assetSaveFailed', language));
    } finally {
      setUploadPercent(null);
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, isOwner: boolean) => {
    if (!isOwner) return alert(t('assetDeleteOwnOnly', language));
    if (!confirm(t('assetDeleteConfirm', language))) return;
    try {
      await deleteDoc(doc(db, 'assets', id));
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'Wallet.handleDelete' });
      console.error(err);
    }
  };

  const openEditModal = (asset: any) => {
    setEditingAsset(asset);
    setName(asset.name);
    setSelectedCategories(asset.categories && asset.categories.length > 0 ? asset.categories : (asset.category ? [asset.category] : []));
    setShareGroupId(shareTargetOf(asset));
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
    setShareGroupId(null);
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
    if (categories.includes(newFilterValue.trim())) return alert(t('categoryExists', language));
    
    setLoading(true);
    try {
      const newCats = [...categories, newFilterValue.trim()];
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { walletCategories: newCats });
      setNewFilterValue('');
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.handleCreateCategory' });
      console.error(e);
    }
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
          reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.fetchAllFromRef' });
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
      reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.fetchAllFromRef' });
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
    if (categories.includes(newName)) return alert(t('categoryExists', language));

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
    if (!confirm(t('categoryDeleteConfirm', language).replace('{name}', catName))) return;
    
    setLoading(true);
    try {
      const newCats = categories.filter(c => c !== catName);
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { walletCategories: newCats });
      
      // Was: find by the LEGACY field, patch the LEGACY field. A card whose `categories[]`
      // held the name was never found, and the ones that were kept it in the array — so the
      // name vanished from the list and stayed on the cards, under a heading with no control
      // left for it. The rename five lines up had already learned this; the deletion had not.
      const assetsToUpdate = affectedByRemoval(assets, catName, auth.currentUser.uid);
      await Promise.all(assetsToUpdate.map(
        (a) => updateDoc(doc(db, 'assets', a.id), afterRemoval(a, catName))));
      
      if (activeFilters.includes(catName)) {
        setActiveFilters(prev => prev.filter(f => f !== catName));
      }
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.handleRemoveCategory' });
      console.error(e);
    }
    setLoading(false);
  };

  // Names sitting on my own cards that my list has lost. The screen already GROUPS by them; it
  // simply offered no control for them, so there was no way back to a card once its category
  // was gone. Listed here so the owner can rename or delete them — a repair they make, not one
  // made for them. Deliberately NOT offered in the picker when categorising a card: an orphan
  // is something to clear, not something to spread.
  const orphans = orphanCategories(assets, categories, auth.currentUser?.uid || '');
  const manageableCategories = [...categories, ...orphans];

  // If active filters are selected, we just show matching assets in a flat list to avoid duplication
  // If no filters are selected, we group by the PRIMARY category (the first one) to avoid duplication
  const filteredAssets = activeFilters.length > 0 
    ? assets.filter(a => {
        const cats = categoriesOf(a);
        if (!cats.length) cats.push(UNCATEGORIZED);
        return activeFilters.every(f => cats.includes(f));
      })
    : [];

  const groupedAssets = activeFilters.length === 0 ? assets.reduce((acc: any, asset: any) => {
    const primaryCat = categoriesOf(asset)[0] || UNCATEGORIZED;
      
    if (!acc[primaryCat]) acc[primaryCat] = [];
    acc[primaryCat].push(asset);
    return acc;
  }, {}) : {};

  /**
   * What the card says about who can see this.
   *
   * It used to read the boolean and print the literal English words "Shared" / "Private" — and
   * the word Shared was false for every asset that ever carried it, because no reader existed.
   */
  const shareBadge = (asset: any) => {
    const kind = shareKindOf(asset, auth.currentUser?.uid);
    if (kind === 'fromOthers') {
      const owner = sharedUsers.find((u) => u.id === asset.ownerId);
      return (
        <>
          <Users className="w-3 h-3 text-sky-500" />
          {t('walletShareFrom', language).replace('{name}', owner?.name || t('walletShareSomeone', language))}
        </>
      );
    }
    if (kind === 'shared') {
      const name = groupNameOf(myGroups, shareTargetOf(asset));
      return (
        <>
          <Users className="w-3 h-3 text-emerald-500" />
          {name
            ? t('walletShareWithGroup', language).replace('{group}', name)
            : t('walletShareShared', language)}
        </>
      );
    }
    if (kind === 'neverShared') {
      // Saying only "Private" here would read as this change having taken something away. It
      // never worked; the card is the only place that can say so.
      return (
        <>
          <User className="w-3 h-3 text-amber-500" />
          <span className="text-amber-600 dark:text-amber-500">{t('walletShareNeverWas', language)}</span>
        </>
      );
    }
    return (
      <>
        <User className="w-3 h-3" />
        {t('walletSharePrivate', language)}
      </>
    );
  };

  const renderAssetCard = (asset: any) => {
    const isOwner = canEdit(asset, auth.currentUser?.uid);
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
                <span className="opacity-0 group-hover/img:opacity-100 text-white font-medium text-sm drop-shadow-md">{t('walletView', language)}</span>
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
                {shareBadge(asset)}
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
            aria-label={t('addNewAsset', language)}
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
            {t('assetsTitle', language)}
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
            {manageableCategories.map(cat => {
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
                <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 pl-2">{catName === UNCATEGORIZED ? t('uncategorized', language) : catName}</h2>
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
          <div ref={assetForm.dialogRef} {...assetForm.dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h3 className="font-bold text-lg mb-4 text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              {editingAsset ? <Edit2 className="w-5 h-5 text-emerald-500" /> : <Plus className="w-5 h-5 text-emerald-500" />} 
              {editingAsset ? t('editAsset', language) : t('addNewAsset', language)}
            </h3>
            
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase">{t('nameLabel', language)}</label>
                <input required value={name} onChange={e => setName(e.target.value)} type="text" placeholder={t('assetNamePlaceholder', language)} className="w-full mt-1 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 outline-none" />
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
                        alt={t('altPreview', language)} 
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
                {myGroups.length === 0 ? (
                  <p className="text-xs text-zinc-500 max-w-[45%] text-right">{t('walletShareNoGroups', language)}</p>
                ) : (
                  <select
                    value={shareGroupId ?? ''}
                    onChange={(e) => setShareGroupId(e.target.value || null)}
                    aria-label={t('walletShareAsset', language)}
                    className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500 max-w-[55%]"
                  >
                    <option value="">{t('walletSharePrivate', language)}</option>
                    {myGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
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
                <button type="submit" disabled={loading} className="flex-1 py-2 text-white font-medium bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50">{uploadPercent === null ? t('save', language) : `${uploadPercent}%`}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Manage Filters Modal */}
      {isManagingFilters && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={filtersDialog.dialogRef} {...filtersDialog.dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                {/* One key for the whole phrase. Splitting it rendered "Gestionează Filters" —
                    a regression from this morning's sweep, where the bare verb was reused inside
                    an English sentence. */}
                <Settings2 className="w-5 h-5 text-emerald-500" /> {t('walletManageFilters', language)}
              </h3>
              <button onClick={() => setIsManagingFilters(false)} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {manageableCategories.map(cat => (
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
                        {orphans.includes(cat) && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">{t('walletCategoryOrphan', language)}</span>
                        )}
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
                placeholder={t('newCategoryPlaceholder', language)}
                className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500" 
              />
              <button type="submit" disabled={loading} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-1">
                <Plus className="w-4 h-4" /> {uploadPercent === null ? t('addAction', language) : `${uploadPercent}%`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Past Images Modal */}
      {showPastImages && (
        <div onClick={() => setShowPastImages(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} ref={pastImagesDialog.dialogRef} {...pastImagesDialog.dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Folder className="w-5 h-5 text-emerald-500" />
                {t('selectPastUpload', language)}
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
                      <img src={url} alt={t('altPastUpload', language)} className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300" />
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
          <div onClick={(e) => e.stopPropagation()} ref={codeDialog.dialogRef} {...codeDialog.dialogProps} className="bg-white rounded-2xl p-8 max-w-sm w-full flex flex-col items-center shadow-2xl relative">
            <button onClick={() => setViewingAssetCode(null)} className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-900 bg-zinc-100 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-zinc-900 mb-6 text-center">{viewingAssetCode.name}</h3>
            
            <div className="bg-white p-4 rounded-xl flex items-center justify-center w-full min-h-[150px]">
              {/* How to draw it is decided in `barcodeFormat.ts` and drawn by one component,
                  so the three places a saved code appears cannot drift apart. */}
              <AssetBarcode
                value={viewingAssetCode.barcodeValue}
                format={viewingAssetCode.barcodeFormat}
                language={language}
              />
            </div>
            
            <p className="mt-6 text-sm text-zinc-500 text-center">
              {t('presentCodeHint', language)}
            </p>
          </div>
        </div>
      )}

      {/* Fullscreen Image Viewer Modal */}
      {viewingImage && (
        <div 
          onClick={() => setViewingImage(null)} 
          ref={imageDialog.dialogRef} {...imageDialog.dialogProps}
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
            alt={t('altAssetFullView', language)} 
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-200" 
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image itself
          />
        </div>
      )}
    </div>
  );
}
