import React, { useState, useEffect } from 'react';
import { X, UserPlus, Mail, AlertCircle, CheckCircle2, Share2, Check, Users, Link2, Copy, QrCode, MessageCircle, Send, Smartphone, Trash2 } from 'lucide-react';
import QRCode from 'react-qr-code';
import { db, auth } from '../firebase';
import { collection, addDoc, doc } from 'firebase/firestore';
import { reportError } from '../reportError';
import { liveDoc } from '../utils/liveQuery';
import { useDialog } from '../hooks/useDialog';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import {
  createGroupInviteLink, listMyInviteLinks, revokeGroupInviteLink, type InviteLinkRow,
} from '../serverActions';
import {
  buildMessage, canUseNativeShare, channelHref, fullText, joinUrl,
  type InviteChannel,
} from '../utils/inviteShare';

interface Friend { uid: string; name?: string; email?: string }
/** One channel. Same edges, same padding, same place for the icon, seven times over. */
function ChannelButton({ onClick, icon, label }: {
  onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
    >
      {icon}
      <span className="text-[10px] font-medium leading-none text-center">{label}</span>
    </button>
  );
}


interface InviteFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId?: string;
  groupName?: string;
  memberIds?: string[];
}

export default function InviteFamilyModal({ isOpen, onClose, groupId, groupName, memberIds = [] }: InviteFamilyModalProps) {
  const { language } = useThemeStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [myLinks, setMyLinks] = useState<InviteLinkRow[]>([]);

  const { dialogRef, dialogProps } = useDialog(isOpen, onClose, {
    label: `${t('invite', language)} \u00b7 ${groupName || t('group', language)}`,
  });

  // Reset transient state when the modal opens or the target group changes, so a
  // selection made for one group can't carry over to another.
  useEffect(() => {
    if (isOpen) {
      setSelected(new Set()); setError(''); setSuccess(''); setEmail('');
      setLinkCode(null); setCopied(false); setShowQr(false);
    }
  }, [isOpen, groupId]);

  // Load my friends so I can invite them with one tap.
  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    const unsub = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'InviteFamilyModal.friends',
      (data) => setFriends(Array.isArray(data?.friends) ? data.friends : []),
      () => setFriends([]));
    return () => unsub();
  }, [isOpen]);

  // The links already minted for this group, so somebody does not create a fifth one because
  // they cannot see the four that already work.
  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    let cancelled = false;
    listMyInviteLinks(groupId ?? null)
      .then((rows) => { if (!cancelled) setMyLinks(rows); })
      .catch((err) => {
        // Deliberately silent in the UI: not being able to LIST old links must not stop somebody
        // creating a new one, which is the thing they came here to do.
        reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.listLinks' });
      });
    return () => { cancelled = true; };
  }, [isOpen, groupId, linkCode]);

  if (!isOpen) return null;

  const toggle = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const createInvite = async (toEmail: string, toId: string | null) => {
    await addDoc(collection(db, 'group_invites'), {
      fromId: auth.currentUser!.uid,
      fromEmail: auth.currentUser!.email,
      toId,
      toEmail: toEmail.toLowerCase(),
      groupId: groupId || null,
      groupName: groupName || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  };

  const handleInviteFriends = async () => {
    if (!auth.currentUser || selected.size === 0) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const chosen = friends.filter(f => selected.has(f.uid) && f.email);
      for (const f of chosen) {
        await createInvite(f.email!, f.uid);
      }
      setSuccess(t('inviteSentMsg', language));
      setSelected(new Set());
    } catch (err) {
      // `requestAlreadyPending` was reported for EVERY failure — a denied write, an offline
      // moment, a rules change — telling the user the invitation exists when it does not. There
      // is no duplicate check anywhere in this file for it to be reporting.
      reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.createInvite' });
      setError(t('inviteFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !auth.currentUser) return;
    if (email.toLowerCase() === auth.currentUser.email?.toLowerCase()) {
      setError(t('cannotFriendSelf', language));
      return;
    }
    setLoading(true); setError(''); setSuccess('');
    try {
      await createInvite(email, null);
      setSuccess(t('inviteSentMsg', language));
      setEmail('');
    } catch (err) {
      // `requestAlreadyPending` was reported for EVERY failure — a denied write, an offline
      // moment, a rules change — telling the user the invitation exists when it does not. There
      // is no duplicate check anywhere in this file for it to be reporting.
      reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.createInvite' });
      setError(t('inviteFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const myName = auth.currentUser?.displayName || (auth.currentUser?.email || '').split('@')[0] || '';

  const message = (code: string) => buildMessage({
    title: t('inviteLinkMessageTitle', language),
    body: (groupName
      ? t('inviteLinkMessageBodyGroup', language).replace('{group}', groupName)
      : t('inviteLinkMessageBody', language)
    ).replace('{name}', myName),
    origin: window.location.origin,
    code,
  });

  const handleCreateLink = async () => {
    setLinkBusy(true); setError('');
    try {
      const res = await createGroupInviteLink({ groupId: groupId ?? null });
      setLinkCode(res.code);
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.createLink' });
      setError(t('inviteFailed', language));
    } finally {
      setLinkBusy(false);
    }
  };

  /**
   * Hand the message to something the sender already has.
   *
   * Nothing is sent by us — no provider, no key, no domain to verify, which is the whole reason
   * these particular channels are the ones on offer.
   */
  const send = async (channel: InviteChannel) => {
    if (!linkCode) return;
    const m = message(linkCode);
    if (channel === 'copy') {
      try {
        await navigator.clipboard.writeText(fullText(m));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.copy' });
        setError(t('inviteFailed', language));
      }
      return;
    }
    if (channel === 'qr') { setShowQr((v) => !v); return; }
    if (channel === 'native') {
      try { await navigator.share({ title: m.title, text: m.text, url: m.url }); }
      catch { /* the sheet was dismissed; that is not a failure worth reporting */ }
      return;
    }
    const href = channelHref(channel, m);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleRevoke = async (code: string) => {
    try {
      await revokeGroupInviteLink(code);
      setMyLinks((rows) => rows.map((r) => (r.code === code ? { ...r, revoked: true } : r)));
      if (code === linkCode) setLinkCode(null);
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'InviteFamilyModal.revoke' });
      setError(t('inviteFailed', language));
    }
  };

  const invitableFriends = friends.filter(f => f.email);

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm flex flex-col max-h-[90vh] shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">

        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            {t('invite', language)} · {groupName || t('group', language)}
          </h3>
          <button aria-label={t('closeAction', language)} onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* ── Invite with a link ──────────────────────────────────────────────
              First, and deliberately: this is the one that reaches somebody who has no account
              and no reason to know which email address to sign up with. The email invitation
              below it is still the stronger form when you DO know the address, so it stays. */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" aria-hidden="true" />
                {t('inviteLinkSection', language)}
              </p>
              <p className="text-xs text-zinc-500">{t('inviteLinkHint', language)}</p>
            </div>

            {!linkCode ? (
              <button
                type="button"
                onClick={handleCreateLink}
                disabled={linkBusy}
                className="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {linkBusy ? t('inviteLinkCreating', language) : t('inviteLinkCreate', language)}
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                  <p className="text-xs font-mono text-zinc-600 dark:text-zinc-300 break-all">
                    {joinUrl(window.location.origin, linkCode)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-2">{t('inviteSendWith', language)}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {canUseNativeShare(navigator) && (
                      <ChannelButton onClick={() => send('native')} icon={<Share2 className="w-4 h-4" />} label={t('inviteChannelNative', language)} />
                    )}
                    <ChannelButton onClick={() => send('whatsapp')} icon={<MessageCircle className="w-4 h-4" />} label="WhatsApp" />
                    <ChannelButton onClick={() => send('email')} icon={<Mail className="w-4 h-4" />} label={t('inviteChannelEmail', language)} />
                    <ChannelButton onClick={() => send('sms')} icon={<Smartphone className="w-4 h-4" />} label="SMS" />
                    <ChannelButton onClick={() => send('telegram')} icon={<Send className="w-4 h-4" />} label="Telegram" />
                    <ChannelButton
                      onClick={() => send('copy')}
                      icon={copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      label={copied ? t('inviteCopied', language) : t('inviteCopyLink', language)}
                    />
                    <ChannelButton onClick={() => send('qr')} icon={<QrCode className="w-4 h-4" />} label={t('inviteShowQr', language)} />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCreateLink}
                  disabled={linkBusy}
                  className="text-xs text-primary font-medium hover:underline self-start disabled:opacity-50"
                >
                  {linkBusy ? t('inviteLinkCreating', language) : t('inviteLinkAnother', language)}
                </button>

                {showQr && (
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    {/* White ground on purpose, in both themes: a QR code inverted for dark mode
                        is not reliably readable by phone cameras. */}
                    <QRCode value={joinUrl(window.location.origin, linkCode)} size={160} />
                  </div>
                )}
              </div>
            )}

            {myLinks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400">{t('inviteLinkActiveLabel', language)}</p>
                {myLinks.map((row) => (
                  <div key={row.code} className="flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-zinc-500 truncate">{row.code.slice(0, 10)}…</p>
                      <p className="text-zinc-500">
                        {row.uses >= row.maxUses ? t('inviteLinkSpent', language) : t('inviteLinkUnused', language)}
                        {row.expiresAt ? ` · ${t('inviteLinkExpiresLabel', language).replace('{date}', new Date(row.expiresAt).toLocaleDateString(language))}` : ''}
                      </p>
                    </div>
                    {row.revoked ? (
                      <span className="text-zinc-400 shrink-0">{t('inviteLinkRevokedLabel', language)}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRevoke(row.code)}
                        aria-label={t('inviteLinkRevoke', language)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 rounded-md transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">{t('orInviteByEmail', language)}</span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>

          {/* Invite friends */}
          {invitableFriends.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {t('inviteFriends', language)}
              </h4>
              <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                {invitableFriends.map((f) => {
                  const inGroup = memberIds.includes(f.uid);
                  const isSel = selected.has(f.uid);
                  return (
                    <button
                      key={f.uid}
                      onClick={() => !inGroup && toggle(f.uid)}
                      disabled={inGroup}
                      className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left transition-colors ${inGroup ? 'opacity-50 border-zinc-200 dark:border-zinc-800' : isSel ? 'border-primary bg-primary/5' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{f.name || f.email}</p>
                        {f.email && <p className="text-xs text-zinc-500 truncate">{f.email}</p>}
                      </div>
                      {inGroup ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 shrink-0">{t('inGroupLabel', language)}</span>
                      ) : (
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${isSel ? 'bg-primary border-primary text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>
                          {isSel && <Check className="w-3.5 h-3.5" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleInviteFriends}
                disabled={loading || selected.size === 0}
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('invite', language)}{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">{t('orInviteByEmail', language)}</span>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </div>
          )}

          {/* Invite by email */}
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-5 h-5 text-zinc-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('friendEmailPlaceholder', language)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {t('invite', language)}
            </button>
          </form>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{success}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
