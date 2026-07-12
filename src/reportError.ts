import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase';

const seen = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;

// Best-effort error reporter → the logClientError callable (server writes the
// errorLogs collection). Requires a signed-in user (server rate-limits per uid).
// De-dupes identical messages (30s) and caps the overall rate (10 / 10s) so a
// storm of distinct errors can't flood; NEVER throws from within itself.
export function reportError(message: string, opts?: { stack?: string; context?: string }) {
  try {
    if (!auth.currentUser) return;
    const now = Date.now();
    if (now - windowStart > 10000) { windowStart = now; windowCount = 0; }
    if (windowCount >= 10) return;
    const key = String(message || '').slice(0, 120) + (opts?.context || '');
    const prev = seen.get(key);
    if (prev && now - prev < 30000) return; // de-dupe identical bursts
    seen.set(key, now);
    windowCount++;
    if (seen.size > 50) { for (const [k, t] of seen) if (now - t > 30000) seen.delete(k); }
    httpsCallable(getFunctions(app), 'logClientError')({
      message: String(message || 'Unknown error'),
      stack: opts?.stack || null,
      url: typeof window !== 'undefined' ? window.location.pathname : null,
      context: opts?.context || null,
    }).catch(() => {});
  } catch { /* the reporter must never break the app */ }
}

// Global capture for uncaught errors + unhandled promise rejections.
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    reportError(e.message || 'window.onerror', { stack: (e.error as any)?.stack, context: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e.reason;
    reportError(r?.message || String(r) || 'unhandledrejection', { stack: r?.stack, context: 'unhandledrejection' });
  });
}
