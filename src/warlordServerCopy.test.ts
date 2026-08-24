// src/warlordServerCopy.test.ts
// The combat engine exists TWICE, and nothing enforced that the copies agree.
//
// ── Why this is a test and not a comment ──────────────────────────────────────────────
//
// PvP is server-authoritative: Cloud Functions replay the same pure engine, so a divergence
// between `src/warlord/src/logic/combat/*` and `functions/src/warlordCombat/combat/*` means the
// server resolves a battle differently from the client that submitted the move. There is no error
// for that. The battle simply comes out wrong, on one side only, and the loser is told they lost.
//
// The rule has been written in two CLAUDE.md files for months. It was never checked by anything.
// Today it was checked by hand for the first time and every one of the five files reported as
// DIFFERENT — 832 changed lines in engine.ts alone. It turned out to be CRLF against LF: the game
// is a submodule checked out on Windows, the functions copy is not. Nothing had diverged.
//
// That near-miss is the actual reason this file exists. A check that cries wolf on every run is
// worse than no check, because the first thing anyone learns is to ignore it. So line endings are
// normalised, and the failure message says what a real divergence looks like.
//
// `logic/types.ts` is deliberately NOT part of the copy: it diverged long ago, harmlessly. What
// must hold is narrower and is asserted separately below — the server imports exactly seven
// symbols from it, and those seven must mean the same thing on both sides.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const GAME = join(here, "warlord", "src", "logic");
const SERVER = join(here, "..", "functions", "src", "warlordCombat");

/** The engine files that must be identical. `army.ts`, `ai.ts` and `enemies.ts` are client-only. */
const MIRRORED = ["types", "rng", "stats", "engine", "pvp"] as const;

/** Everything the server copy is allowed to import from the game-wide `logic/types.ts`. */
const CONTRACT = ["SoldierType", "SoldierTypes", "Rank", "Ranks", "RankNumber", "UnitBucket", "Weapon"] as const;

/** CRLF vs LF is a checkout artefact, not a divergence. Trailing whitespace likewise. */
const normalise = (s: string) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();

const read = (p: string) => readFileSync(p, "utf8");

describe("the combat engine's two copies", () => {
  it("both copies exist where the rule says they do", () => {
    for (const f of MIRRORED) {
      expect(existsSync(join(GAME, "combat", `${f}.ts`)), `game copy of ${f}.ts`).toBe(true);
      expect(existsSync(join(SERVER, "combat", `${f}.ts`)), `server copy of ${f}.ts`).toBe(true);
    }
    expect(existsSync(join(SERVER, "types.ts"))).toBe(true);
  });

  for (const f of MIRRORED) {
    it(`${f}.ts is identical on both sides`, () => {
      const game = normalise(read(join(GAME, "combat", `${f}.ts`)));
      const server = normalise(read(join(SERVER, "combat", `${f}.ts`)));
      if (game !== server) {
        // A useful failure, not just "not equal": say WHERE, and say what it means.
        const g = game.split("\n"), s = server.split("\n");
        const at = g.findIndex((line, i) => line !== s[i]);
        throw new Error(
          `combat/${f}.ts has DIVERGED between the game and functions/src/warlordCombat.\n` +
          `First difference at line ${at + 1}:\n` +
          `  game  : ${JSON.stringify(g[at] ?? "<end of file>")}\n` +
          `  server: ${JSON.stringify(s[at] ?? "<end of file>")}\n` +
          `PvP is server-authoritative, so this means the server would resolve a battle differently ` +
          `from the client that submitted the move — with no error anywhere. Copy the file across ` +
          `and redeploy functions. (Line endings and trailing whitespace are already normalised, ` +
          `so this is a real difference.)`
        );
      }
      expect(game).toBe(server);
    });
  }
});

describe("the seven symbols the server borrows from logic/types.ts", () => {
  const serverSources = MIRRORED.map((f) => read(join(SERVER, "combat", `${f}.ts`))).join("\n");

  it("the server imports nothing else from it", () => {
    // The contract is only as narrow as what actually crosses it. An eighth import is not
    // forbidden — it just has to be added HERE first, which forces someone to check it matches.
    const imported = new Set<string>();
    for (const m of serverSources.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]\.\.\/types['"]/g)) {
      for (const raw of m[1].split(",")) {
        const name = raw.replace(/\btype\b/, "").trim().split(/\s+as\s+/)[0].trim();
        if (name) imported.add(name);
      }
    }
    expect([...imported].sort()).toEqual([...CONTRACT].sort());
  });

  for (const sym of CONTRACT) {
    it(`${sym} means the same thing on both sides`, () => {
      // Compare the declaration itself, from `export ... <sym>` up to the next top-level export.
      const grab = (src: string) => {
        const re = new RegExp(`^export\\s+(?:type|const|interface)\\s+${sym}\\b`, "m");
        const m = re.exec(src);
        if (!m) return null;
        const rest = src.slice(m.index + m[0].length);
        const next = rest.search(/^export\s/m);
        return normalise(m[0] + (next === -1 ? rest : rest.slice(0, next)));
      };
      const game = grab(read(join(GAME, "types.ts")));
      const server = grab(read(join(SERVER, "types.ts")));
      expect(game, `${sym} not found in the game's logic/types.ts`).toBeTruthy();
      expect(server, `${sym} not found in the server's types.ts`).toBeTruthy();
      expect(server).toBe(game);
    });
  }

  it("and logic/types.ts as a whole is NOT required to match", () => {
    // Stated as a test so nobody "fixes" the divergence by copying the whole file over: the game
    // file carries slices the server has no business knowing about, and copying it has cost a
    // functions deploy for nothing more than once.
    const game = normalise(read(join(GAME, "types.ts")));
    const server = normalise(read(join(SERVER, "types.ts")));
    expect(game).not.toBe(server);
  });
});
