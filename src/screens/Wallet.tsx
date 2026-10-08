import React, { useState, useEffect, useRef } from 'react';
import { auth, db, storage } from '../firebase';
import { collection, query, setDoc, updateDoc, deleteDoc, doc, getDoc, where, arrayUnion, arrayRemove } from 'firebase/firestore';
import { reportError } from '../reportError';
import { liveQuery, liveDoc } from '../utils/liveQuery';
import { ref, getDownloadURL, listAll } from 'firebase/storage';
import { uploadFile, UploadStalled, UploadAborted } from '../utils/uploadFile';
import { waitBound, settleWithin, handOverFailure } from '../utils/pendingWrite';
import {
  EMPTY_LEDGER, LEDGER_PREFIX, readLedger, updateLedger, onLedgerChange, record, settle, forget, dismiss,
  reconcile, fieldsOf, imageMark, newOpId, nextDueAt, recordCategoryOp, dropCategoryOp, categoryOutcome,
  judgeCategoryOps, type Ledger, type LedgerNotice, type CategoryOp, type CategoryOutcome,
} from '../utils/walletLedger';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { Wallet as WalletIcon, Plus, Image as ImageIcon, Trash2, Users, User, HeartPulse, Home, Car, DollarSign, Settings2, Folder, Edit2, Check, X, ScanLine, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { useDialog } from '../hooks/useDialog';
import AssetBarcode from '../components/AssetBarcode';
import ExpensesTab from '../components/ExpensesTab';
import OfflineCardsStatus from '../components/OfflineCardsStatus';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { transferAssetCopy } from '../serverActions';
import { groupNameText } from '../utils/groupName';
import { ASSET_CATEGORY_MAX, ASSET_NAME_MAX, assetImageSrc, normaliseAsset } from '../utils/walletAsset';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  canEdit, groupNameOf, mergeAssets, shareFieldsFor, shareKindOf, shareListenerGroupIds,
  shareTargetOf,
} from '../utils/assetSharing';
import {
  UNCATEGORIZED, DEFAULT_CATEGORIES, categoriesOf, affectedByRemoval, afterRemoval, afterRename, listAfterRename,
  orphanCategories, unionFor,
} from '../utils/walletCategories';

/** Where a save is (the Save button says which), or null. */
type SavePhase = 'upload' | 'server' | 'transfer';
/** A step that needs a connection the phone does not have: the person chooses, nothing is dropped silently. */
type NeedChoice = 'photoOffline' | 'photoStalled' | 'transferOffline';
type SaveOpts = { skipPhoto?: boolean; skipTransfer?: boolean };

const NOTE_KEY = {
  transferNotDone: 'walletTransferNotDone',
  transferRefused: 'walletTransferRefused',
  transferUnconfirmed: 'walletTransferUnconfirmed',
} as const;
const NOTICE_KEY = {
  notAdded: 'walletNoticeNotAdded',
  changeNotSaved: 'walletNoticeChangeNotSaved',
  notDeleted: 'walletNoticeNotDeleted',
} as const;
/** What happened to a hand-over that did not complete in the form. */
type WalletNote = 'transferNotDone' | 'transferRefused' | 'transferUnconfirmed';

/** The code a Firebase error carries, if any. */
const codeOf = (err: unknown): string => {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/**
 * Finish a category rename or removal, once its cards have answered (03.10.2026). The ONE place this
 * happens — from the answers in time, or later from the server's cards (utils/walletLedger.ts) — and
 * always in a live Wallet, so `listed` is the list as this screen holds it now, never a frozen copy.
 *   partial → the old name stays (a card still carries it), the refusal is reported, and a new name
 *             that nothing carries and that was not listed before goes again, so a retry works;
 *   kept    → a card added since carries the old name: it stays listed;
 *   done    → the list loses the old name — a rename keeps the new one in the old one's place.
 */
function finishCategoryChange(
  uid: string,
  o: CategoryOutcome,
  listed: readonly string[],
  listIsStored: boolean,
  onPartial: (o: CategoryOutcome) => void,
): void {
  const { op } = o;
  const context = op.kind === 'rename' ? 'Wallet.renameCategory' : 'Wallet.removeCategory';
  const report = (err: unknown) => reportError(messageOf(err), { context, stack: codeOf(err) });
  const userRef = doc(db, 'users', uid);
  if (o.result === 'partial') {
    onPartial(o);
    reportError(`refused on ${o.refusedCards} of ${op.cardIds.length} cards`, { context: `${context}.partial` });
    if (o.dropNewName && op.newName) {
      void setDoc(userRef, { walletCategories: arrayRemove(op.newName) }, { merge: true }).catch(report);
    }
    return;
  }
  if (o.result === 'kept') return;
  // A removal is a removal (no lost update, nothing reordered) — unless no list is stored yet, where
  // removing from the missing field would store an empty list and drop the defaults with it.
  const write = op.kind === 'rename' && op.newName
    ? { walletCategories: listAfterRename(listed, op.oldName, op.newName) }
    : listIsStored
      ? { walletCategories: arrayRemove(op.oldName) }
      : { walletCategories: listed.filter((c) => c !== op.oldName) };
  void setDoc(userRef, write, { merge: true }).catch(report);
}

/** The time a change is written down at (out here: a handler's clock, not a render's). */
const nowMs = (): number => Date.now();

/** Where a new card photo goes: the owner's folder, a time prefix against name clashes. */
const assetPhotoPath = (uid: string, file: File): string => `assets/${uid}/${Date.now()}_${file.name}`;

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
  // Distinct from `categoryError`: that one means the whole write threw. This one means some
  // cards were refused and the category was therefore KEPT — a different thing to tell someone.
  const [categoryPartial, setCategoryPartial] = useState(false);
  const [categories, setCategories] = useState<string[]>([...DEFAULT_CATEGORIES]);
  // Whether the account has STORED a list yet. Unknown counts as not: adding to an unstored list
  // carries the defaults along (unionFor), which can only re-add a name, never drop four.
  const [listIsStored, setListIsStored] = useState(false);
  // Cards with a write the server has not confirmed: their "Not sent yet" mark.
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  // Changes the server has not confirmed, and the ones it refused (utils/walletLedger.ts).
  const [ledger, setLedger] = useState<Ledger>(() => {
    const uid = auth.currentUser?.uid;
    return uid ? readLedger(uid) : EMPTY_LEDGER;
  });
  const [categoryBusy, setCategoryBusy] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<WalletNote | null>(null);
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
  // Was one `loading` shared by the form, the category rows and the past-photos scan, so a slow
  // Storage listing disabled Save, and a save that never ended disabled the categories (03.10).
  const [saving, setSaving] = useState<SavePhase | null>(null);
  const [pastImagesLoading, setPastImagesLoading] = useState(false);
  const [needChoice, setNeedChoice] = useState<{ kind: NeedChoice; opts: SaveOpts } | null>(null);
  // Null while nothing is uploading, and while the total size is not known yet. A 10 MB photo
  // used to be fifteen seconds of a button that did nothing and then an error.
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  // The notice an "Edit again" form came from: dismissed once the new write is issued, not on open.
  const redoNotice = useRef<string | null>(null);
  // Photo URLs this page saved, by mark, so "Edit again" can offer the same photo. In memory only:
  // a download URL is a bearer link and never goes into storage.
  const photoUrls = useRef(new Map<string, string>());
  // Read by a category change that finishes after the screen has moved on.
  const assetsRef = useRef(assets);
  const categoriesRef = useRef(categories);
  const listIsStoredRef = useRef(listIsStored);
  // The rename the server just refused (some cards): the same rename may be tried again, although its
  // new name is now listed.
  const refusedRename = useRef<{ from: string; to: string } | null>(null);
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

    // With metadata changes: a write the server confirms changes no data, so without them the "Not
    // sent yet" mark could never clear. The same query shape as the offline card copy, so the SDK
    // shares the target.
    // The server's last drained answer, and a timer for the entries that were too young for it: with
    // no further change, nothing else would ever judge them (review 03.10).
    let drained: Array<Record<string, unknown> & { id: string }> | null = null;
    let lookAgain: ReturnType<typeof setTimeout> | undefined;
    const judge = () => {
      clearTimeout(lookAgain);
      const docs = drained;
      if (!docs) return;
      let outcomes: CategoryOutcome[] = [];
      const after = updateLedger(uid, (l) => {
        const j = judgeCategoryOps(reconcile(l, docs, Date.now()), docs, Date.now());
        outcomes = j.outcomes;
        return j.ledger;
      });
      for (const o of outcomes) {
        finishCategoryChange(uid, o, categoriesRef.current, listIsStoredRef.current, (p) => {
          setCategoryPartial(true);
          if (p.op.kind === 'rename' && p.op.newName) refusedRename.current = { from: p.op.oldName, to: p.op.newName };
        });
      }
      const next = nextDueAt(after);
      if (next !== null) lookAgain = setTimeout(judge, Math.max(0, next - Date.now()) + 50);
    };
    const unsubscribe = liveQuery<any>(q, 'Wallet.assets',
      (docs, meta) => {
        setAssetsLoadError(false);
        setOwnedAssets(docs.map(normaliseAsset));
        setPendingIds(meta.pendingIds ?? []);
        // Judge unconfirmed changes only on the SERVER's answer with nothing pending: a cached answer,
        // or one still carrying a local write, says nothing about what the server holds. Any later
        // answer replaces it (or, carrying a pending write, withdraws it before the timer can use it).
        drained = !meta.fromCache && !meta.hasPendingWrites ? docs : null;
        judge();
      },
      () => setAssetsLoadError(true),
      { includeMetadataChanges: true, pendingIds: true });

    const unsubUser = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'Wallet.userDoc',
      (data) => {
        const stored = Array.isArray(data?.walletCategories);
        setListIsStored(stored);
        setCategories(stored ? data.walletCategories : [...DEFAULT_CATEGORIES]);
      },
      // Falling back to the defaults is right here — but only after the failure is on record,
      // otherwise a denied read looks like "this account has no custom categories".
      () => setCategories([...DEFAULT_CATEGORIES]));

    const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', auth.currentUser.uid));
    const unsubGroups = liveQuery<any>(qGroups, 'Wallet.groups', async (fetchedGroups) => {
      setMyGroups(fetchedGroups.map(g => ({ id: g.id, name: groupNameText(g.name) || t('group', language), members: Array.isArray(g.members) ? g.members : [] })));
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
      clearTimeout(lookAgain);
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
        // Other members' cards, through normaliseAsset: until 08.10.2026 one whose name was not text
        // crashed this screen for the whole group (walletAsset.ts).
        (docs) => setSharedAssets((prev) => ({ ...prev, [groupId]: docs.map(normaliseAsset) })),
        // No clearing on failure, for the same reason as the owned listener: a denied or dropped
        // read must not be rendered as "nobody shared anything with you".
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [groupIdsKey]);

  // Read by work that finishes after the render it started in (a category change).
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { listIsStoredRef.current = listIsStored; }, [listIsStored]);
  // "Not sent yet" appears only for a write still unconfirmed after a moment: an ordinary online save
  // is confirmed well before, and must not flash it, shift the page, or be read out (useDelayedFlag).
  const unsentShown = useDelayedFlag(pendingIds.length > 0 || ledger.entries.length > 0, 1200);

  // The ledger of unconfirmed changes: this page's own updates, and another tab's through 'storage'.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const refresh = () => setLedger(readLedger(uid));
    const off = onLedgerChange((who) => { if (who === uid) refresh(); });
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === LEDGER_PREFIX + uid) refresh(); };
    window.addEventListener('storage', onStorage);
    return () => { off(); window.removeEventListener('storage', onStorage); };
  }, []);

  // Five dialogs, five identities. This used to be ONE Escape handler that reset all seven
  // pieces of state at once, so dismissing the picture viewer stacked above a half-filled asset
  // form threw the form away with it. Each one now answers only while it is the dialog on top.

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

  // ── Saving a card ──────────────────────────────────────────────────────────────────
  //
  // A Firestore write resolves only when the SERVER confirms it, so `await setDoc(...)` behind Save
  // spun for ever without a connection — although the card was already in the list behind the form
  // and would be sent later (measured with the real SDK, DEVLOG 03.10). Now:
  //   1. the change is written down (utils/walletLedger.ts) BEFORE it is issued;
  //   2. the form waits for the server's answer for a bounded time only (utils/pendingWrite.ts) —
  //      none at all when the browser says it is offline;
  //   3. an answer in time behaves as before (a refusal keeps the form open with the input); no
  //      answer closes the form, and the card says "Not sent yet" until the server confirms it;
  //   4. a refusal that comes later is told as a notice on this screen, even after a reload.
  // A photo and a hand-over need the server itself: offline, the person chooses what to do.

  // Bumped whenever the form opens or closes — and when the screen goes: a save that was still
  // waiting must not touch a form the person has since closed, or another one they opened, and a
  // refusal that arrives after they left belongs in the ledger, not in an alert over another screen.
  const formSession = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    const isMounted = mounted;
    const session = formSession;
    isMounted.current = true;
    return () => { isMounted.current = false; session.current++; };
  }, []);
  // The card being handed over: a second hand-over of it cannot start while the first is in flight
  // (closing the form does not stop the call, and a second keep-a-copy would make a second copy).
  const [handOverCardId, setHandOverCardId] = useState<string | null>(null);

  // What happened to a hand-over reaches the person even if they left the screen meanwhile — as an
  // alert then, which is what the screen always did — but never anybody who signed in after them.
  const tellNote = (note: WalletNote, uid: string) => {
    if (mounted.current) { setWalletNote(note); return; }
    if (auth.currentUser?.uid === uid) alert(t(NOTE_KEY[note], language));
  };

  function closeForm() {
    formSession.current++;
    setIsAdding(false);
    setEditingAsset(null);
    setName('');
    setSelectedCategories([]);
    setFile(null);
    setSelectedPastImageUrl(null);
    setBarcodeValue('');
    setBarcodeFormat('');
    setShareGroupId(null);
    setNeedChoice(null);
    setSaving(null);
    setUploadPercent(null);
    redoNotice.current = null;
  }

  // Cancel, Escape and Back on the card form: the same thing, whatever the phase.
  //   uploading → the upload is stopped and nothing is written;
  //   waiting for the server → the form closes and the write goes on (the card says "Not sent yet");
  //   handing over → the form closes and the call goes on; its outcome is told on this screen.
  // Back must never be a dead press: it has already used the dialog's history entry, so ignoring it
  // made the NEXT Back leave the Wallet with the hand-over's outcome unseen (review 03.10).
  function requestCloseForm() {
    if (saving === 'upload') uploadAbort.current?.abort();
    closeForm();
  }

  // The card form, the fifth of the dialogs above: wired here, after requestCloseForm, which it calls.
  const assetForm = useDialog(Boolean(isAdding || editingAsset), () => requestCloseForm(),
    { label: editingAsset ? t('editAsset', language) : t('addNewAsset', language) });

  const saveCard = async (opts: SaveOpts = {}) => {
    const user = auth.currentUser;
    if (!user || saving) return;
    const uid = user.uid;
    const session = formSession.current;
    const current = () => session === formSession.current;
    setNeedChoice(null);

    const offline = navigator.onLine === false;
    const editing = editingAsset;
    const transferTo = editing && !opts.skipTransfer ? transferToUserId : '';
    if (transferTo && editing && handOverCardId === editing.id) return;
    // The two steps that need the server itself are asked about BEFORE anything is written.
    if (transferTo && offline) { setNeedChoice({ kind: 'transferOffline', opts }); return; }
    const newPhoto = opts.skipPhoto ? null : file;
    if (newPhoto && offline) { setNeedChoice({ kind: 'photoOffline', opts }); return; }

    let url: string | null = editing?.imageUrl ?? null;
    if (newPhoto) {
      // This raced a fifteen-second timer against an upload that could not be cancelled, so a
      // slow photo reported failure and then finished, leaving a file nobody points at. One of the
      // two orphans measured in the live bucket is under `assets/`, which is this line.
      // See src/utils/uploadWatch.ts for what replaced the duration.
      const abort = new AbortController();
      uploadAbort.current = abort;
      setSaving('upload');
      try {
        url = await uploadFile(
          assetPhotoPath(uid, newPhoto),
          await newPhoto.arrayBuffer(),
          { contentType: newPhoto.type, onProgress: setUploadPercent, signal: abort.signal },
        );
      } catch (err) {
        uploadAbort.current = null;
        if (!current()) return;
        setUploadPercent(null);
        setSaving(null);
        if (err instanceof UploadAborted) return;
        // A stalled upload is its own thing: the person chooses between waiting for a better
        // connection and saving the card without the new photo — never silently either.
        if (err instanceof UploadStalled) {
          reportError(messageOf(err), { context: 'Wallet.upload' });
          setNeedChoice({ kind: 'photoStalled', opts });
          return;
        }
        reportError(messageOf(err), { context: 'Wallet.upload' });
        alert(t('assetSaveFailed', language));
        return;
      }
      uploadAbort.current = null;
      // Stopped as it finished: nothing points at the file (it stays under "Pick from past uploads").
      if (abort.signal.aborted || !current()) return;
      setUploadPercent(null);
    } else if (selectedPastImageUrl) {
      url = selectedPastImageUrl;
    }
    // Signed out (in another tab) while the photo went up: nothing is written for anybody.
    if (auth.currentUser?.uid !== uid) { if (current()) setSaving(null); return; }

    const opId = newOpId();
    const assetData = {
      // Which change the card last received: the ledger's verdict asks the card itself (a later
      // category rename or share does not touch it), never only its fields (walletLedger.ts).
      lastWriteId: opId,
      name,
      categories: selectedCategories,
      category: selectedCategories[0] || UNCATEGORIZED,
      // `?? null`: an undefined field throws, and firebase.ts does not ignore them.
      imageUrl: url ?? null,
      ...shareFieldsFor(shareGroupId),
      barcodeValue: barcodeValue || null,
      barcodeFormat: barcodeFormat || null
    };
    if (url) photoUrls.current.set(imageMark(url), url);

    // A new card gets its id NOW: `addDoc` only hands the reference over once the server answers.
    const cardRef = editing ? doc(db, 'assets', editing.id) : doc(collection(db, 'assets'));
    updateLedger(uid, (l) => record(l, {
      opId, kind: editing ? 'edit' : 'add', assetId: cardRef.id, name, fields: fieldsOf(assetData), at: Date.now(),
    }));
    let write: Promise<void>;
    try {
      write = editing
        ? updateDoc(cardRef, assetData)
        : setDoc(cardRef, { ...assetData, ownerId: uid, createdAt: new Date().toISOString() });
    } catch (err) {
      // Refused before it was issued (an invalid field): there is nothing queued to report later.
      updateLedger(uid, (l) => forget(l, opId));
      reportError(messageOf(err), { context: 'Wallet.upload' });
      if (current()) { setSaving(null); alert(t('assetSaveFailed', language)); }
      return;
    }
    if (redoNotice.current) {
      const noticeId = redoNotice.current;
      redoNotice.current = null;
      updateLedger(uid, (l) => dismiss(l, noticeId));
    }

    // From here the write's end is recorded whatever the screen does. These handlers are attached
    // before the bounded wait's, so they run first.
    let handedOff = false;
    write.then(
      () => { updateLedger(uid, (l) => settle(l, opId, 'acked')); },
      (err) => {
        if (!handedOff && current()) return; // the form is open: the refusal is shown there
        reportError(messageOf(err), { context: 'Wallet.write.refused', stack: `add/edit ${codeOf(err)}` });
        updateLedger(uid, (l) => settle(l, opId, 'refused'));
      },
    );

    if (current()) setSaving('server');
    const answer = await settleWithin(write, waitBound(navigator.onLine, transferTo ? 'transfer' : 'save'));
    if (answer.kind === 'noAnswer') handedOff = true;
    if (!current()) {
      // The form was closed while waiting: the write goes on, but no hand-over starts behind it.
      if (transferTo && answer.kind !== 'refused') tellNote('transferNotDone', uid);
      return;
    }
    if (answer.kind === 'refused') {
      // In time: the form is still open with everything typed — the stale-share refusal among them.
      updateLedger(uid, (l) => forget(l, opId));
      reportError(messageOf(answer.error), { context: 'Wallet.upload' });
      setSaving(null);
      alert(t('assetSaveFailed', language));
      return;
    }
    if (transferTo && editing) {
      if (answer.kind === 'noAnswer') {
        // The hand-over copies the card as the SERVER holds it, which does not have this edit yet:
        // starting it now would hand over the old card.
        tellNote('transferNotDone', uid);
        closeForm();
        return;
      }
      setSaving('transfer');
      setHandOverCardId(editing.id);
      try {
        // Both through the callable: clients can only create assets they own, and a client
        // `updateDoc` that set `ownerId` used to be allowed by a rule that checked only the owner
        // the document already had. The server applies the shared-group check.
        await transferAssetCopy(keepCopy
          ? { assetId: editing.id, recipientId: transferTo }
          : { assetId: editing.id, recipientId: transferTo, mode: 'move' });
      } catch (err) {
        reportError(messageOf(err), { context: 'Wallet.transfer', stack: codeOf(err) });
        // The edit IS saved either way; what is not known is whether the hand-over happened.
        tellNote(handOverFailure(codeOf(err)) === 'refused' ? 'transferRefused' : 'transferUnconfirmed', uid);
      } finally {
        setHandOverCardId(null);
      }
    }
    if (current()) closeForm();
  };

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !name.trim() || selectedCategories.length === 0) {
      alert(t('assetNeedsNameAndCategory', language));
      return;
    }
    void saveCard();
  };

  const handleDelete = (id: string, isOwner: boolean) => {
    if (!isOwner) return alert(t('assetDeleteOwnOnly', language));
    if (!confirm(t('assetDeleteConfirm', language))) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Never awaited: offline the card leaves the list at once and the deletion is queued. If the
    // server refuses it later, the card comes back and the ledger says so; a card whose ADD was
    // refused is simply gone, and that is what the person asked for.
    const opId = newOpId();
    const card = ownedAssets.find((a) => a.id === id);
    updateLedger(uid, (l) => record(l, { opId, kind: 'delete', assetId: id, name: card?.name || '', fields: null, at: Date.now() }));
    let write: Promise<void>;
    try {
      write = deleteDoc(doc(db, 'assets', id));
    } catch (err) {
      updateLedger(uid, (l) => forget(l, opId));
      reportError(messageOf(err), { context: 'Wallet.handleDelete' });
      return;
    }
    write.then(
      () => { updateLedger(uid, (l) => settle(l, opId, 'acked')); },
      (err) => {
        reportError(messageOf(err), { context: 'Wallet.handleDelete', stack: codeOf(err) });
        updateLedger(uid, (l) => settle(l, opId, 'refused'));
      },
    );
  };

  // "Edit again" on a notice: the form, filled with the change that did not land. The notice goes
  // only once the new write is issued, so closing the form loses nothing.
  const redo = (n: LedgerNotice) => {
    const f = n.fields;
    if (!f) return;
    const existing = ownedAssets.find((a) => a.id === n.assetId);
    if (existing) openEditModal(existing); else openAddModal();
    setName(f.name);
    setSelectedCategories(f.categories.length ? f.categories : (f.category && f.category !== UNCATEGORIZED ? [f.category] : []));
    // As it was: a group the person has since left shows as such (staleShare), never quietly Private.
    setShareGroupId(f.sharedGroupId);
    setBarcodeValue(f.barcodeValue || '');
    setBarcodeFormat(f.barcodeFormat || '');
    const url = f.image ? photoUrls.current.get(f.image) : undefined;
    if (url && url !== existing?.imageUrl) setSelectedPastImageUrl(url);
    redoNotice.current = n.id;
  };

  // The card names a group this account is no longer in — left, or deleted under it. Nothing
  // clears `sharedGroupId` in either case, so the value survives and the select has no option
  // matching it; React then shows the FIRST option, so the form said “Private” about a card the
  // list showed as Shared. Saving failed every time and said only “that item was not saved”:
  // the rules refuse any write that leaves a stale share in place, which `rules-tests/
  // assets.test.ts` proves — and they allow the same write once it unshares.
  //
  // Shown rather than silently repaired. Quietly setting the form to Private would unshare a
  // card on the next Save without anybody asking for it, which is the shape of defect the
  // whole audit is about.
  const staleShare = !!shareGroupId && !myGroups.some((g) => g.id === shareGroupId);

  const openEditModal = (asset: any) => {
    formSession.current++;
    redoNotice.current = null;
    setNeedChoice(null);
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
    formSession.current++;
    redoNotice.current = null;
    setNeedChoice(null);
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

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const value = newFilterValue.trim();
    const uid = auth.currentUser?.uid;
    if (!value || !uid) return;
    if (categories.includes(value)) return alert(t('categoryExists', language));
    // A union, never awaited (03.10): the chip appears from the local cache at once, the write is
    // queued offline, and a list sent hours later cannot erase what another device added meanwhile —
    // which writing the whole array did. A merge, not an update: an update of a user document that
    // does not exist yet is refused, and the list would silently stay as it was.
    try {
      void setDoc(doc(db, 'users', uid), { walletCategories: arrayUnion(...unionFor(listIsStored, [value])) }, { merge: true })
        .catch((err) => reportError(messageOf(err), { context: 'Wallet.handleCreateCategory', stack: codeOf(err) }));
    } catch (err) {
      reportError(messageOf(err), { context: 'Wallet.handleCreateCategory' });
      return;
    }
    setNewFilterValue('');
  };

  const openPastImages = async () => {
    if (!auth.currentUser || pastImagesLoading) return;
    setPastImagesLoading(true);
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
      if (!uid) { setPastImagesLoading(false); return; }
      const roots = [`assets/${uid}`, `events/${uid}`, `checklists/${uid}`].map(path => ref(storage, path));
      await Promise.all(roots.map(rootRef => fetchAllFromRef(rootRef)));
      
      setPastImages(Array.from(urls));
      setShowPastImages(true);
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'Wallet.fetchAllFromRef' });
      console.error('Failed to fetch past images', e);
    }
    setPastImagesLoading(false);
  };

  // Rename and removal share one rule: the CARDS first, the list last, and the list only once
  // EVERY card change was accepted — one refusal must not abort the rest, and must keep the name.
  //
  // Proved on the emulator (`rules-tests/assets.test.ts`): the assets rule evaluates `shareTargetOk`
  // on the MERGED document, so a card still naming a group its owner has LEFT refuses every update —
  // including one that does not touch `sharedGroupId`. With `Promise.all` and the list written first,
  // one such card aborted the rest while the list had already changed: the name gone from the list
  // and still on the cards, under a heading with no control left for it.
  //
  // The wait for those answers is bounded (03.10). Without a connection the answers never came and
  // the whole category manager stayed disabled; now the row closes, says "Not sent yet", and the list
  // is finished when the answers arrive — guarded, so a card of mine that still carries the name keeps
  // it listed.
  const changeCategory = async (
    kind: 'rename' | 'remove',
    oldName: string,
    newName: string | null,
    cardChange: (a: any) => { categories: string[]; category: string },
    done: () => void,
  ) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setCategoryBusy(oldName);
    setCategoryError(false);
    setCategoryPartial(false);
    // The ownerId term (in affectedByRemoval) stays: the assets rule permits updates by the owner
    // only, so including a shared card would make this a guaranteed partial failure.
    const affected = affectedByRemoval(assets, oldName, uid);
    // Written down before the cards are touched: if the answers come after a reload, or after this
    // screen has gone, the change is still finished — or reported — from the server's cards.
    const op: CategoryOp = {
      opId: newOpId(), kind, oldName, newName,
      newWasListed: newName !== null && categories.includes(newName),
      cardIds: affected.map((a) => a.id), at: nowMs(),
    };
    updateLedger(uid, (l) => recordCategoryOp(l, op));
    let cards: Promise<PromiseSettledResult<void>[]>;
    try {
      cards = Promise.allSettled(affected.map((a) => updateDoc(doc(db, 'assets', a.id), cardChange(a))));
    } catch (err) {
      updateLedger(uid, (l) => dropCategoryOp(l, op.opId));
      // Its own flag, not assetsLoadError: that one only renders when the list is EMPTY.
      reportError(messageOf(err), { context: kind === 'rename' ? 'Wallet.renameCategory' : 'Wallet.removeCategory' });
      setCategoryError(true);
      setCategoryBusy(null);
      return;
    }
    const answer = await settleWithin(cards, waitBound(navigator.onLine, 'save'));
    if (answer.kind === 'acked' && mounted.current) {
      // The answers came in time: decided here, from them, and the ledger lets go.
      updateLedger(uid, (l) => dropCategoryOp(l, op.opId));
      const refused = new Set(affected.filter((_, i) => answer.value[i]?.status === 'rejected').map((a) => a.id));
      const outcome = categoryOutcome(op, refused, assetsRef.current.filter((a) => a.ownerId === uid));
      finishCategoryChange(uid, outcome, categoriesRef.current, listIsStoredRef.current, (p) => {
        setCategoryPartial(true);
        if (p.op.kind === 'rename' && p.op.newName) refusedRename.current = { from: p.op.oldName, to: p.op.newName };
      });
      // A refusal in time keeps the row open, as before.
      if (outcome.result !== 'partial') done();
    } else {
      // No answer yet (offline, or slow): the row closes and says "Not sent yet" (from the ledger); the
      // server's cards decide the rest, here or on any later visit.
      done();
    }
    setCategoryBusy(null);
  };

  const handleUpdateCategory = async (oldName: string) => {
    if (!editFilterValue.trim() || !auth.currentUser || editFilterValue.trim() === oldName) {
      setEditingFilter(null);
      return;
    }
    const newName = editFilterValue.trim();
    // Only a LISTED category can collide with another one. Renaming an ORPHAN onto an existing
    // name is a merge, and a merge is the obvious thing to want: it is how you fold a name the
    // list lost back into one it still has. Refusing it left the pencil on an orphan row with
    // no input at all that could repair anything.
    const renamingAnOrphan = !categories.includes(oldName);
    // Trying again the rename the server just refused on some cards is not a collision: its new name
    // is listed only because the first attempt put it there.
    const retrying = refusedRename.current?.from === oldName && refusedRename.current?.to === newName;
    if (!renamingAnOrphan && categories.includes(newName) && !retrying) {
      return alert(t('categoryExists', language));
    }
    refusedRename.current = null;
    const uid = auth.currentUser.uid;
    // The new name is listed BEFORE any card carries it, so no crash, reload or refusal in between
    // can leave a card under a name the list lacks. (listAfterRename later puts it where the old one
    // was, without a duplicate.) Assets carry BOTH `categories[]` and the legacy `category`;
    // afterRename rewrites both.
    try {
      void setDoc(doc(db, 'users', uid), { walletCategories: arrayUnion(...unionFor(listIsStored, [newName])) }, { merge: true })
        .catch((err) => reportError(messageOf(err), { context: 'Wallet.renameCategory', stack: codeOf(err) }));
    } catch (err) {
      reportError(messageOf(err), { context: 'Wallet.renameCategory' });
      setCategoryError(true);
      return;
    }
    await changeCategory(
      'rename',
      oldName,
      newName,
      (a) => afterRename(a, oldName, newName),
      () => {
        setActiveFilters((prev) => prev.map((f) => (f === oldName ? newName : f)));
        setEditingFilter(null);
      },
    );
  };

  const handleRemoveCategory = async (catName: string) => {
    if (!auth.currentUser) return;
    if (!confirm(t('categoryDeleteConfirm', language).replace('{name}', catName))) return;
    // Was: find by the LEGACY field, patch the LEGACY field — so the name vanished from the list and
    // stayed on the cards. affectedByRemoval/afterRemoval look at both fields.
    await changeCategory(
      'remove',
      catName,
      null,
      (a) => afterRemoval(a, catName),
      () => setActiveFilters((prev) => prev.filter((f) => f !== catName)),
    );
  };

  // Names sitting on my own cards that my list has lost. The screen already GROUPS by them; it
  // simply offered no control for them, so there was no way back to a card once its category
  // was gone. Listed here so the owner can rename or delete them — a repair they make, not one
  // made for them. Deliberately NOT offered in the picker when categorising a card: an orphan
  // is something to clear, not something to spread.
  const orphans = orphanCategories(assets, categories, auth.currentUser?.uid || '');
  const manageableCategories = [...categories, ...orphans];
  // Plus anything currently FILTERING that neither list contains any more. `orphans` is derived
  // from the cards, and `categories` from a live listener, so either can lose an entry while it
  // is still in `activeFilters` — delete the last card carrying an orphan, or remove a category
  // from another device. Tapping the chip is the only control that clears an entry, so without
  // this the wallet stays filtered to nothing with nothing on screen to switch off.
  const filterChips = [
    ...manageableCategories,
    ...activeFilters.filter((f) => !manageableCategories.includes(f)),
  ];

  // If active filters are selected, we just show matching assets in a flat list to avoid duplication
  // If no filters are selected, we group by the PRIMARY category (the first one) to avoid duplication
  const filteredAssets = activeFilters.length > 0 
    ? assets.filter(a => {
        const cats = categoriesOf(a);
        if (!cats.length) cats.push(UNCATEGORIZED);
        return activeFilters.every(f => cats.includes(f));
      })
    : [];

  // On an object with no prototype: on a plain `{}`, a card whose first category was "constructor"
  // (a word in Romanian too) or "toString" found a function already there, and `.push` on it crashed
  // the Wallet of everybody the card was shared with (08.10.2026).
  const groupedAssets: Record<string, any[]> = activeFilters.length === 0 ? assets.reduce((acc: Record<string, any[]>, asset: any) => {
    const primaryCat = categoriesOf(asset)[0] || UNCATEGORIZED;
      
    if (!acc[primaryCat]) acc[primaryCat] = [];
    acc[primaryCat].push(asset);
    return acc;
  }, Object.create(null)) : {};

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
    const photo = assetImageSrc(asset);
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
          className={`h-32 bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center group/img ${photo ? 'cursor-pointer' : ''}`}
          onClick={(e) => {
            if (photo) {
              e.stopPropagation();
              setViewingImage(photo);
            }
          }}
        >
          {photo ? (
            <>
              <img src={photo} alt={asset.name}className="w-full h-full object-cover transition-all group-hover/img:scale-105" />
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
          {asset.barcodeValue && photo && (
            <button
              aria-label={t('showCode', language)}
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
              {unsentShown && pendingIds.includes(asset.id) && (
                <p className="ourdays-fade-in mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">{t('walletNotSentYet', language)}</p>
              )}
            </div>
            {isOwner && (
              <div className="flex items-center gap-1 shrink-0">
                <button 
                  aria-label={t('editAsset', language)}
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
                  aria-label={t('deleteAsset', language)}
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

  const cardInBoundary = (asset: any) => (
    <ErrorBoundary
      key={asset.id}
      context="Wallet.card"
      fallback={
        <div role="alert" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-xs text-zinc-500">
          {t('cardCouldNotShow', language)}
        </div>
      }
    >
      {renderAssetCard(asset)}
    </ErrorBoundary>
  );

  return (
    <div className="min-h-screen bg-transparent flex flex-col pb-24 pt-[60px]">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
       <div className="max-w-5xl w-full mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} aria-label={t('goHome', language)} className="p-1.5 -ml-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
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
          // Its own boundary: a row the tab cannot draw costs the tab, not the app (08.10.2026).
          <ErrorBoundary
            context="ExpensesTab"
            fallback={<p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{t('expensesCouldNotShow', language)}</p>}
          >
            <ExpensesTab sharedUsers={sharedUsers} myGroups={myGroups} />
          </ErrorBoundary>
        ) : (
          <>
        <div className="flex flex-col gap-2">
        {/* Whether these cards can be shown with no network (the offline Cards page, public/sw.js). */}
        <OfflineCardsStatus language={language} />
        {unsentShown && (
          <p role="status" className="ourdays-fade-in text-xs text-amber-700 dark:text-amber-400">{t('offlineCardsPending', language)}</p>
        )}
        {walletNote && (
          <div role="status" className="flex items-start justify-between gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-800 dark:text-amber-300">
            <span>{t(NOTE_KEY[walletNote], language)}</span>
            <button type="button" onClick={() => setWalletNote(null)} className="shrink-0 text-xs font-medium underline">{t('dismissAction', language)}</button>
          </div>
        )}
        {/* What the server refused after the form had closed — kept until dismissed, also across a reload. */}
        {ledger.notices.map((n) => (
          <div key={n.id} role="alert" className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-sm text-rose-800 dark:text-rose-300">
            <span className="flex-1 min-w-0">{t(NOTICE_KEY[n.kind], language).replace('{name}', n.name)}</span>
            <div className="flex gap-2 shrink-0">
              {n.kind !== 'notDeleted' && n.fields && (
                <button type="button" onClick={() => redo(n)} className="px-2 py-1 rounded-md bg-white/70 dark:bg-zinc-900/40 font-medium">{t('walletEditAgain', language)}</button>
              )}
              <button
                type="button"
                onClick={() => { const uid = auth.currentUser?.uid; if (uid) updateLedger(uid, (l) => dismiss(l, n.id)); }}
                className="px-2 py-1 rounded-md font-medium"
              >
                {t('dismissAction', language)}
              </button>
            </div>
          </div>
        ))}
        </div>

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
          {categoryPartial && (
            <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{t('categoryPartialFailure', language)}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {filterChips.map(cat => {
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
                {filteredAssets.map(asset => cardInBoundary(asset))}
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
                {groupedAssets[catName].map((asset: any) => cardInBoundary(asset))}
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
                <input required maxLength={ASSET_NAME_MAX} value={name} onChange={e => setName(e.target.value)} type="text" placeholder={t('assetNamePlaceholder', language)}className="w-full mt-1 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 outline-none" />
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
                        src={file ? URL.createObjectURL(file) : (selectedPastImageUrl || assetImageSrc(editingAsset) || undefined)} 
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
                  <button type="button" onClick={openPastImages} disabled={pastImagesLoading} aria-label={t('walletPickFromPast', language)} className="disabled:opacity-50 flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed bg-zinc-50 dark:bg-zinc-800/30">
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
                      <button type="button" onClick={() => setIsScanning(true)} aria-label={t('walletScanCode', language)} className="flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors w-full h-full">
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
                {myGroups.length === 0 && !staleShare ? (
                  <p className="text-xs text-zinc-500 max-w-[45%] text-right">{t('walletShareNoGroups', language)}</p>
                ) : (
                  <select
                    value={shareGroupId ?? ''}
                    onChange={(e) => setShareGroupId(e.target.value || null)}
                    aria-label={t('walletShareAsset', language)}
                    className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500 max-w-[55%]"
                  >
                    <option value="">{t('walletSharePrivate', language)}</option>
                    {staleShare && (
                      <option value={shareGroupId as string}>{t('walletShareLostGroup', language)}</option>
                    )}
                    {myGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
                {staleShare && (
                  <p className="basis-full text-xs text-amber-700 dark:text-amber-400 mt-1">
                    {t('walletShareLostGroupHint', language)}
                  </p>
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

              {needChoice && (
                <div role="alert" className="p-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-800 dark:text-amber-300 space-y-2">
                  <p>
                    {t(needChoice.kind === 'transferOffline' ? 'walletTransferNeedsConnection'
                      : needChoice.kind === 'photoStalled' ? 'uploadStalled' : 'walletPhotoNeedsConnection', language)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCard(needChoice.kind === 'transferOffline'
                        ? { ...needChoice.opts, skipTransfer: true }
                        : { ...needChoice.opts, skipPhoto: true })}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white font-medium"
                    >
                      {t(needChoice.kind === 'transferOffline' ? 'walletSaveChangesOnly' : 'walletSaveWithoutNewPhoto', language)}
                    </button>
                    <button type="button" onClick={() => setNeedChoice(null)} className="px-3 py-1.5 rounded-lg bg-white/70 dark:bg-zinc-900/40 font-medium">
                      {t('walletKeepEditing', language)}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {/* Cancel, Escape and Back mean the same thing in every phase — see requestCloseForm. */}
                <button type="button" onClick={requestCloseForm} className="flex-1 py-2 text-zinc-600 dark:text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                  {saving === 'server' || saving === 'transfer' ? t('closeAction', language) : t('walletCancel', language)}
                </button>
                <button type="submit" disabled={saving !== null || (!!editingAsset && handOverCardId === editingAsset.id)} className="flex-1 py-2 text-white font-medium bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50">
                  {saving === 'upload' ? `${uploadPercent ?? 0}%`
                    : saving === 'server' ? t('walletWaitingForServer', language)
                    : saving === 'transfer' || (!!editingAsset && handOverCardId === editingAsset.id) ? t('walletHandingOver', language)
                    : t('save', language)}
                </button>
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
              <button onClick={() => { setIsManagingFilters(false); setEditingFilter(null); }} aria-label={t('closeAction', language)} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
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
                        maxLength={ASSET_CATEGORY_MAX}
                        className="flex-1 px-2 py-1 text-sm border rounded bg-white dark:bg-zinc-800 dark:border-zinc-600 outline-none focus:border-emerald-500"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateCategory(cat)} disabled={categoryBusy === cat} aria-label={t('save', language)} className="p-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingFilter(null)} disabled={categoryBusy === cat} aria-label={t('cancel', language)} className="p-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors">
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
                        {ledger.categoryOps.some((o) => o.oldName === cat) && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">{t('walletNotSentYet', language)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingFilter(cat); setEditFilterValue(cat); }} aria-label={t('editCategory', language)} className="p-1.5 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRemoveCategory(cat)} aria-label={t('deleteCategory', language)} className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors">
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
                maxLength={ASSET_CATEGORY_MAX}
                type="text" 
                placeholder={t('newCategoryPlaceholder', language)}
                className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 outline-none focus:border-emerald-500" 
              />
              <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center gap-1">
                <Plus className="w-4 h-4" /> {t('addAction', language)}
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
              <button onClick={() => setShowPastImages(false)} aria-label={t('closeAction', language)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
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
        <ErrorBoundary
          key={viewingAssetCode.id}
          context="Wallet.codeViewer"
          fallback={
            <div onClick={() => setViewingAssetCode(null)} className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
              <p role="alert" className="bg-white rounded-2xl p-6 text-sm text-zinc-700">{t('cardCouldNotShow', language)}</p>
            </div>
          }
        >
        <div onClick={() => setViewingAssetCode(null)}className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} ref={codeDialog.dialogRef} {...codeDialog.dialogProps} className="bg-white rounded-2xl p-8 max-w-sm w-full flex flex-col items-center shadow-2xl relative">
            <button onClick={() => setViewingAssetCode(null)} aria-label={t('closeAction', language)} className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-900 bg-zinc-100 rounded-full transition-colors">
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
        </ErrorBoundary>
      )}

      {/* Fullscreen Image Viewer Modal */}
      {viewingImage && (
        <div 
          onClick={() => setViewingImage(null)} 
          ref={imageDialog.dialogRef} {...imageDialog.dialogProps}
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200"
        >
          <button 
            aria-label={t('closeAction', language)}
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
