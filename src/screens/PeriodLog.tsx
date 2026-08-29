// src/screens/PeriodLog.tsx
// What actually happened in a stretch of time, across every group you are in.
//
// ── Why this exists before any summary does ───────────────────────────────────────────
//
// The assistant Andrei asked for has two halves: a factual log, and a summary DERIVED from it.
// This is the first half, and it deliberately calls no model and spends nothing. That order is
// not caution for its own sake — a summary you cannot check against anything is a summary you
// have to take on faith, and the whole scope machinery underneath (deriveScope, the per-source
// fetchers, the completeness flags) exists precisely so the answer can be checked by eye.
//
// It reads `aiPreviewScope`, which returns only what the caller could already see: the scope is
// re-derived server-side from group membership, never trusted from the client.
//
// Everything the server admits it could not do is shown, not swallowed. An incomplete read, a
// truncated scope, a source that failed outright — each has a line. The alternative is a page
// that looks complete and is not, which is the exact failure that kept the expenses tab dead for
// three months.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Loader2, AlertTriangle, Receipt, CheckSquare } from 'lucide-react';
import { aiPreviewScope, type ScopePreview } from '../serverActions';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { isRealDay } from '../utils/period';

interface Row {
  kind: 'event' | 'expense';
  title: string;
  amount?: number;
  isTask?: boolean;
  scopeLabel?: string;
  virtual?: boolean;
}

const monthName = (y: number, m: number, lang: string) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function PeriodLog() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  // `toLocaleDateString` refuses `undefined` where `t()` tolerates it, so it is pinned once here
  // rather than defended at each of the three call sites.
  const lang = language || 'en-US';
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [data, setData] = useState<ScopePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (y: number, m: number) => {
    setBusy(true);
    setError(null);
    try {
      setData(await aiPreviewScope({ year: y, month: m }));
    } catch (e: any) {
      // The server sends stable codes; anything else is shown as it came rather than hidden.
      setError(e?.message || String(e));
      setData(null);
    }
    setBusy(false);
  };

  const step = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    setYear(y);
    setMonth(m);
    void load(y, m);
  };

  // Grouped by day, newest first — the order you read a diary in.
  const days = useMemo(() => {
    if (!data) return [] as { day: string; rows: Row[] }[];
    const byDay = new Map<string, Row[]>();
    const push = (day: string, row: Row) => {
      if (!isRealDay(day)) return; // a day the server could not place is not a day
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    };
    for (const e of data.events.preview) {
      push(e.day, { kind: 'event', title: e.title, isTask: e.isTask, scopeLabel: e.scopeLabel, virtual: e.virtual });
    }
    for (const x of data.expenses.preview ?? []) {
      push(x.day, { kind: 'expense', title: x.description, amount: x.amount, scopeLabel: x.scopeLabel });
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, rows]) => ({ day, rows }));
  }, [data]);

  // Every honest caveat the server sent, collected in one place so none of them can be missed.
  const caveats: string[] = [];
  if (data) {
    if (data.scope.truncated) {
      caveats.push(t('logScopeTruncated', language)
        .replace('{shown}', String(data.scope.groups))
        .replace('{total}', String(data.scope.totalGroups)));
    }
    if (!data.events.complete) caveats.push(t('logEventsPartial', language));
    if (data.events.unavailable) caveats.push(t('logEventsUnavailable', language));
    if (!data.expenses.complete) caveats.push(t('logExpensesPartial', language));
    if (data.expenses.unavailable) caveats.push(t('logExpensesUnavailable', language));
    if (!data.chat.complete) caveats.push(t('logChatPartial', language));
    if (data.chat.unavailable) caveats.push(t('logChatUnavailable', language));
    // The days below are built from `preview`, not from `count`, so a capped preview means whole
    // days are missing from the list while the summary line above still counts them.
    if (data.events.previewTruncated || data.expenses.previewTruncated) {
      caveats.push(t('logPreviewTruncated', language));
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <button onClick={() => navigate('/')} aria-label={t('back', language)} className="p-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <CalendarDays className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold">{t('logTitle', language)}</h1>
      </header>

      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => step(-1)} disabled={busy} className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-50">←</button>
          <span className="font-semibold">{monthName(year, month, lang)}</span>
          <button onClick={() => step(1)} disabled={busy} className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-50">→</button>
        </div>

        {!data && !busy && !error && (
          <button onClick={() => load(year, month)} className="w-full px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium">
            {t('logLoad', language)}
          </button>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-zinc-500 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('logLoading', language)}
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
          </p>
        )}

        {caveats.length > 0 && (
          // Not an error, and not decoration either: the answer below is narrower than the
          // question, and saying so is the only thing that makes it usable.
          <div role="status" className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-1">
            {caveats.map((c) => (
              <p key={c} className="text-xs text-amber-900 dark:text-amber-200">{c}</p>
            ))}
          </div>
        )}

        {data && (
          <p className="text-xs text-zinc-500">
            {t('logSummaryLine', language)
              .replace('{events}', String(data.events.count))
              .replace('{expenses}', String(data.expenses.count))
              .replace('{messages}', String(data.chat.count))
              .replace('{groups}', String(data.scope.groups))}
          </p>
        )}

        {data && days.length === 0 && !busy && (
          <p className="text-center text-zinc-500 italic py-8">{t('logNothing', language)}</p>
        )}

        {days.map(({ day, rows }) => (
          <div key={day} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-zinc-100 dark:border-zinc-800">
              {new Date(`${day}T12:00:00.000Z`).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r, i) => (
                <li key={`${day}-${i}`} className="flex items-start gap-2 px-3 py-2">
                  {r.kind === 'expense'
                    ? <Receipt className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
                    : <CheckSquare className={`w-4 h-4 mt-0.5 shrink-0 ${r.isTask ? 'text-indigo-500' : 'text-primary'}`} />}
                  <span className="text-sm flex-1">{r.title || t('logUntitled', language)}</span>
                  {r.amount !== undefined && <span className="text-sm font-mono">{r.amount.toFixed(2)}</span>}
                  {r.scopeLabel && <span className="text-[11px] text-zinc-500 self-center">{r.scopeLabel}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
