// scripts/bundleGuard.test.mjs
//
// The deploy gate's decision, run against fixtures instead of against a real deploy.
//
// Written in plain JS next to the script rather than under `src/`: it is build tooling, it has no
// place in the app's type graph, and the thing it guards runs as a node script.

import { describe, it, expect } from 'vitest';
import { bundleProblems, REQUIRED, PUSH } from './bundleGuard.mjs';

const FULL = {
  VITE_FIREBASE_API_KEY: 'AIzaKEY',
  VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'our-days-2a939',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
  VITE_FIREBASE_VAPID_KEY: 'BvapidKEY',
  VITE_APPCHECK_RECAPTCHA_KEY: '6LcSITEKEY',
};

/** A bundle that carries every configured value, plus enough bulk to look like a real build. */
const bundleFor = (config) => Object.values(config).join('|') + 'x'.repeat(2000);

const check = (over = {}) => bundleProblems({
  bundle: bundleFor(FULL),
  config: FULL,
  projectId: 'our-days-2a939',
  ...over,
});

describe('a bundle built with everything configured', () => {
  it('passes, and says what it actually found', () => {
    const { fatal, warnings, verified } = check();
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
    // Naming what was verified is the difference between "nothing was wrong" and "nothing was
    // looked at" — the failure mode of a check pointed at the wrong file.
    for (const name of [...REQUIRED, PUSH]) expect(verified).toContain(name);
    expect(verified.some((v) => v.includes('our-days-2a939'))).toBe(true);
  });

  it('never repeats a KEY back, only names', () => {
    // The project id is exempt and deliberately printed: it is in the committed `.firebaserc` and
    // the firebase CLI echoes it on every command. The keys are not — two of them are public by
    // nature, but a check that habitually echoes configuration is one paste away from doing it
    // with something that is not.
    const { verified } = check();
    for (const name of ['VITE_FIREBASE_API_KEY', PUSH, 'VITE_APPCHECK_RECAPTCHA_KEY']) {
      expect(verified.join(' '), `${name} was echoed`).not.toContain(FULL[name]);
    }
  });
});

describe('the failure that put ten errors in the live log', () => {
  it('refuses when the key is set but the build predates it', () => {
    // `.env` gained VITE_FIREBASE_VAPID_KEY; nobody rebuilt. A shape-matching check called this
    // fine, because a two-megabyte bundle contains SOMETHING that looks like a base64url key.
    const stale = { ...FULL };
    delete stale.VITE_FIREBASE_VAPID_KEY;
    const { fatal } = check({ bundle: bundleFor(stale) });
    expect(fatal.join(' ')).toMatch(/VAPID_KEY is configured but does NOT appear/);
  });

  it('refuses when the key was never configured at all', () => {
    const config = { ...FULL };
    delete config[PUSH];
    const { fatal } = check({ config });
    expect(fatal.join(' ')).toMatch(/push notifications would be silently dead/);
  });

  it('allows it only when asked in so many words', () => {
    const config = { ...FULL };
    delete config[PUSH];
    const { fatal, warnings } = check({ config, allowMissingPush: true });
    expect(fatal).toEqual([]);
    expect(warnings.join(' ')).toMatch(/web push will be off/);
  });
});

describe('the failure that would take the whole app down', () => {
  it('refuses a build made with no configuration whatsoever', () => {
    const { fatal } = check({ config: {}, bundle: 'x'.repeat(2000) });
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatch(/No VITE_FIREBASE_\* configuration/);
  });

  it('names each required value that is missing', () => {
    const config = { ...FULL };
    delete config.VITE_FIREBASE_API_KEY;
    const { fatal } = check({ config });
    expect(fatal.join(' ')).toMatch(/VITE_FIREBASE_API_KEY is not set/);
  });

  it('refuses a bundle built against a different project', () => {
    // A complete config is not the same as the RIGHT config.
    const { fatal } = check({ projectId: 'some-other-project' });
    expect(fatal.join(' ')).toMatch(/built against a different Firebase project/);
  });

  it('refuses an empty or missing dist', () => {
    const { fatal } = check({ bundle: '' });
    expect(fatal.join(' ')).toMatch(/empty or absurdly small/);
    expect(check({ bundle: 'tiny' }).fatal.join(' ')).toMatch(/empty or absurdly small/);
  });
});

describe('App Check is optional, and says so without blocking anyone', () => {
  it('warns rather than refusing', () => {
    const config = { ...FULL };
    delete config.VITE_APPCHECK_RECAPTCHA_KEY;
    const { fatal, warnings } = check({ config });
    expect(fatal).toEqual([]);
    expect(warnings.join(' ')).toMatch(/not be attested/);
  });
});
