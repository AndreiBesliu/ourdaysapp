// scripts/test-tz.mjs
//
// Run the zone-sensitive tests under the zones where their defects live.
//
// The ordinary run (and CI) happens in whatever zone the machine has — UTC on a CI runner, where a
// local date formatter and a UTC one print the same day and every recurrence defect found on
// 24.09.2026 was invisible. So these files run twice more: Bucharest, which crosses DST in March
// and October, and New York, west of Greenwich.
//
// Each run passes EXPECT_TZ too, and the test asserts the zone actually took. A zone that silently
// failed to apply would otherwise turn this into a third UTC run reporting green.
//
// Usage: npm run test:tz

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ZONES = ['Europe/Bucharest', 'America/New_York'];
const FILES = ['src/utils/recurrenceZones.test.ts'];

let failed = false;
for (const zone of ZONES) {
  console.log(`\n── ${zone} ─────────────────────────────────────────────`);
  const r = spawnSync('npx', ['vitest', 'run', ...FILES], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TZ: zone, EXPECT_TZ: zone },
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
