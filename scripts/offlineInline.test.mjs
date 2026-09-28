// scripts/offlineInline.test.mjs — the offline page's script and style, inlined (offlineInline.mjs).
import { describe, it, expect } from 'vitest';
import { inlinePage } from './offlineInline.mjs';

const HTML = '<!doctype html><head><script type="module" crossorigin src="/offline/assets/cards-x.js"></script>'
  + '<link rel="stylesheet" crossorigin href="/offline/assets/style-y.css"></head><body><div id="root"></div></body>';
const files = (js, css = 'a{color:red}') => (url) => {
  if (url === '/offline/assets/cards-x.js') return js;
  if (url === '/offline/assets/style-y.css') return css;
  throw new Error(`unexpected read ${url}`);
};

describe('inlinePage', () => {
  it('leaves nothing to load, and says what it inlined', () => {
    const { html, used } = inlinePage(HTML, files('console.log(1)'));
    expect(html).not.toMatch(/\b(src|href)=/);
    expect(html).toContain('<script type="module">console.log(1)</script>');
    expect(html).toContain('<style>a{color:red}</style>');
    expect(used).toEqual(['/offline/assets/cards-x.js', '/offline/assets/style-y.css']);
  });

  it('keeps `$&` and `$\'` in the code as written (a replacement string would expand them)', () => {
    const js = 'a.replace(/x/g,"$&$&");b.replace(/y/,"$\'")';
    expect(inlinePage(HTML, files(js)).html).toContain(`<script type="module">${js}</script>`);
  });

  it('cannot be closed early by `</script` or `</style` in the code', () => {
    const { html } = inlinePage(HTML, files('s="</script>";t="</SCRIPT"', 'a::after{content:"</style>"}'));
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it('refuses `<!--` in the script rather than rewriting code', () => {
    expect(() => inlinePage(HTML, files('if (a <!--b) {}'))).toThrow(/<!--/);
  });

  it('refuses a page with no script, or two, and more than one stylesheet', () => {
    expect(() => inlinePage('<div></div>', files(''))).toThrow(/one script/);
    const two = HTML.replace('</head>', '<script type="module" src="/offline/assets/cards-x.js"></script></head>');
    expect(() => inlinePage(two, files(''))).toThrow(/one script/);
    const css2 = HTML.replace('</head>', '<link rel="stylesheet" href="/offline/assets/style-y.css"></head>');
    expect(() => inlinePage(css2, files(''))).toThrow(/stylesheet/);
  });
});
