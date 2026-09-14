// scripts/lint-gate.mjs
// The lint rules that are allowed to fail the build.
//
// ── Why this exists at all ───────────────────────────────────────────────────────────
//
// `eslint-plugin-react-hooks` has been a dependency of this repo the whole time, and `npm run lint`
// has been in package.json the whole time, and nothing ever ran either. On 2026-09-14 a user-facing
// crash — every single attempt to open an event died on React error #310 — turned out to be one
// `useRef` sitting below an early return in EventDetailsModal.tsx. The linter names that defect in
// words, including the sentence "Did you accidentally call a React Hook after an early return?".
//
// The tool was in the box. Nobody opened the box. So this wires it to CI.
//
// ── Why it is not just `eslint .` ────────────────────────────────────────────────────
//
// Because that is red on arrival: 338 `@typescript-eslint/no-explicit-any`, 23
// `react-hooks/set-state-in-effect`, and more. A gate that cannot be green on the day it is added
// gets switched off within a week, and then you are back to having a linter nobody runs — which is
// exactly the state that produced the bug.
//
// So the gate is a LIST, and the list holds rules that are already at zero. Those cannot regress
// without someone doing it today, which makes every failure actionable and every pass honest. The
// rest of the findings are printed as a backlog rather than swallowed: debt you can see is debt
// that can be paid, and the point is not to hide it but to stop pretending it blocks anything.
//
// To promote a rule: clean it to zero, then add it here. That is the whole process.

import { ESLint } from 'eslint';

/**
 * Rules that fail the build.
 *
 * Keep this list at rules with a CURRENT count of zero. Adding one that still has findings makes
 * the gate red, which teaches everyone to ignore it.
 */
const GATED = [
  // The one that shipped a crash. A hook after an early return, a hook in a condition, a hook in a
  // loop — all the same defect: the hook count changes between two renders of one component, and
  // React throws. It is invisible in review and invisible to the type checker.
  'react-hooks/rules-of-hooks',
];

const TARGET = ['src'];

const eslint = new ESLint({ errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(TARGET);

const gated = [];
const backlog = Object.create(null);

for (const file of results) {
  for (const m of file.messages) {
    const id = m.ruleId || '(parse error)';
    if (GATED.includes(id)) gated.push({ file: file.filePath, ...m });
    else backlog[id] = (backlog[id] || 0) + 1;
  }
}

const cwd = process.cwd();
const rel = (p) => p.startsWith(cwd) ? p.slice(cwd.length + 1).split('\\').join('/') : p;

console.log(`lint gate: ${results.length} files, ${GATED.length} gated rule(s)`);

if (gated.length > 0) {
  console.log('');
  for (const g of gated) {
    console.log(`  ${rel(g.file)}:${g.line}:${g.column}`);
    console.log(`    ${g.ruleId}  ${g.message.split('\n')[0]}`);
  }
}

// Printed every run, pass or fail. A gate that silently ignores most of what the linter found
// reads as "the code is clean", and it is not.
const backlogTotal = Object.values(backlog).reduce((a, b) => a + b, 0);
console.log('');
console.log(`not gated (${backlogTotal} findings, informational):`);
for (const [id, n] of Object.entries(backlog).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(n).padStart(5)}  ${id}`);
}

if (gated.length > 0) {
  console.log('');
  console.log(`FAILED: ${gated.length} violation(s) of a gated rule.`);
  process.exit(1);
}
console.log('');
console.log('gated rules clean.');
