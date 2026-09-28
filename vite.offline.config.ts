// vite.offline.config.ts — the offline Cards page (src/offline/), built as ONE self-contained file.
//
// A second build, not a second input of the app's: scripts/bundleSplit.mjs refuses a main manifest
// with more than one entry, and shared chunks would reshuffle what the app loads at boot. The page
// must also have no subresource at all: the service worker stores exactly one file and serves it
// with no network (public/sw.js), so the script and the stylesheet are inlined into cards.html and
// the emitted files removed. scripts/stamp-offline.mjs then stamps its revision; check-offline.mjs
// refuses anything that loads from elsewhere.
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { inlinePage } from './scripts/offlineInline.mjs';

const root = fileURLToPath(new URL('./src/offline', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/offline', import.meta.url));

/** Inline the page's one script and one stylesheet into cards.html, then delete the files. */
function inlineIntoPage(): Plugin {
  return {
    name: 'ourdays-offline-inline',
    apply: 'build',
    closeBundle() {
      const htmlPath = join(outDir, 'cards.html');
      const fileOf = (url: string) => join(outDir, url.replace(/^\/offline\//, ''));
      // The rules (one script, `<!--` refused, `</script` escaped) live in scripts/offlineInline.mjs.
      const { html, used } = inlinePage(readFileSync(htmlPath, 'utf8'), (url: string) => readFileSync(fileOf(url), 'utf8'));
      for (const url of used) rmSync(fileOf(url));
      writeFileSync(htmlPath, html);
      // Nothing may be left: a second chunk, a font or an image would be a file the stored page cannot
      // reach offline. Checked BEFORE the empty folder is removed.
      const assetsDir = join(outDir, 'assets');
      const leftAssets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
      if (leftAssets.length) throw new Error(`offline page: files the page would need offline: ${leftAssets.join(', ')}`);
      rmSync(assetsDir, { recursive: true, force: true });
      const left = readdirSync(outDir).filter((f) => f !== 'cards.html');
      if (left.length) throw new Error(`offline page: unexpected files beside cards.html: ${left.join(', ')}`);
    },
  };
}

export default defineConfig({
  root,
  base: '/offline/',
  // public/ belongs to the app build (it holds sw.js); copying it here would put a second sw.js
  // under /offline/.
  publicDir: false,
  plugins: [react(), inlineIntoPage()],
  resolve: {
    alias: { '@warlord': fileURLToPath(new URL('./src/warlord/src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: [
            fileURLToPath(new URL('./src/offline/**/*.{ts,tsx,html}', import.meta.url)),
            fileURLToPath(new URL('./src/components/AssetBarcode.tsx', import.meta.url)),
          ],
          theme: { extend: {} },
        }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    manifest: false,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { input: join(root, 'cards.html') },
  },
});
