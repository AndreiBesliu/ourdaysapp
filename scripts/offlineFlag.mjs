// scripts/offlineFlag.mjs — the offline Cards kill switch, resolved the way Vite resolves it.
//
// The app reads VITE_OFFLINE_CARDS through Vite, which also reads .env, .env.local, .env.production and
// .env.production.local. The worker's stamp and the predeploy check used to read only the shell's
// environment, so a switch put in .env (where every other VITE_ flag lives) turned off the app half
// and left the worker live (review, 28.09.2026). One resolution for both, here.
import { loadEnv } from 'vite';

export function offlineKillSwitch(cwd = process.cwd()) {
  const env = { ...loadEnv('production', cwd, 'VITE_'), ...process.env };
  return env.VITE_OFFLINE_CARDS === '0';
}
