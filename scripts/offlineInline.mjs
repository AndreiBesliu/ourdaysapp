// scripts/offlineInline.mjs
//
// Inlines the offline Cards page's one script and its stylesheet into cards.html (28.09.2026). Pure:
// strings in, strings out; vite.offline.config.ts does the file work around it. Out here so the
// rules below are tested (offlineInline.test.mjs) rather than trusted inside a build hook.

/**
 * @param {string} html  cards.html as Vite emitted it
 * @param {(url: string) => string} read  the text of an emitted file, by the URL the page uses
 * @returns {{ html: string, used: string[] }}  the page with nothing left to load, and the URLs inlined
 */
export function inlinePage(html, read) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
  const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)];
  if (scripts.length !== 1) throw new Error(`offline page: expected one script, found ${scripts.length}`);
  if (styles.length > 1) throw new Error(`offline page: expected at most one stylesheet, found ${styles.length}`);
  const used = [];
  let out = html;
  for (const [tag, url] of scripts) {
    const raw = read(url);
    // `<!--` inside an inline script switches the HTML parser into an escaped state that can swallow
    // the rest of the page. Rewriting it is not safe in every JS context (a /u regex refuses `\!`), so
    // the build refuses instead: nothing in the page's code contains it today.
    if (raw.includes('<!--')) throw new Error('offline page: the script contains "<!--"; it cannot be inlined safely');
    // `</script` inside strings and regexes is equivalent to `<\/script` there.
    const js = raw.replace(/<\/script/gi, '<\\/script');
    // A function, not a string: minified code is full of `$&` and `$'`, which a replacement STRING expands.
    out = out.replace(tag, () => `<script type="module">${js}</script>`);
    used.push(url);
  }
  for (const [tag, url] of styles) {
    const css = read(url).replace(/<\/style/gi, '<\\/style');
    out = out.replace(tag, () => `<style>${css}</style>`);
    used.push(url);
  }
  return { html: out, used };
}
