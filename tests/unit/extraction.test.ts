// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { articleFromSnapshot } from '@/shared/extraction/article';
import { collectBlocks, findContentRoot, rangeForSpan } from '@/shared/extraction/collect';
import { buildDoc } from '@/shared/text/doc';

const site = (name: string) => readFileSync(resolve(__dirname, '../fixtures/sites', name), 'utf8');
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('collectBlocks', () => {
  it('groups text by block, normalizes whitespace and keeps inline markup together', () => {
    const doc = parse('<div><h2>Title</h2><p>Hello <b>bold</b>\n   world.</p><ul><li>One</li><li>Two</li></ul></div>');
    const { blocks } = collectBlocks(doc.body, { live: false, dropFurniture: false, includeCode: false });
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Title' },
      { kind: 'paragraph', text: 'Hello bold world.' },
      { kind: 'list-item', text: 'One' },
      { kind: 'list-item', text: 'Two' },
    ]);
  });

  it('skips scripts, hidden content, form controls and page furniture', () => {
    const doc = parse(`
      <nav>Home About</nav>
      <div class="cookie-banner">We use cookies</div>
      <article><p>Real text here.</p><script>var x = 1;</script><p hidden>Secret</p><p style="display:none">Gone</p><button>Click</button></article>
      <aside class="related-posts">Related stuff</aside>
      <footer>Copyright</footer>`);
    const { blocks } = collectBlocks(doc.body, { live: false, dropFurniture: true, includeCode: false });
    expect(blocks.map((b) => b.text)).toEqual(['Real text here.']);
  });

  it('maps every character back to its source node so sentences become DOM ranges', () => {
    const doc = parse('<p>First <em>sentence</em> here. Second one.</p>');
    const { blocks, maps } = collectBlocks(doc.body, { live: false, dropFurniture: false, includeCode: false });
    const built = buildDoc({ title: 't', source: 'page', blocks, preNormalized: true });
    const second = built.sentences[1]!;
    expect(second.text).toBe('Second one.');
    expect(rangeForSpan(maps[0]!, second.start, second.end)!.toString()).toBe('Second one.');
    const first = built.sentences[0]!;
    expect(rangeForSpan(maps[0]!, first.start, first.end)!.toString()).toBe('First sentence here.');
  });

  it('restricts collection to a selection range, clipping partial nodes', () => {
    const doc = parse('<p id="a">Alpha beta gamma.</p><p id="b">Delta epsilon.</p>');
    const range = doc.createRange();
    range.setStart(doc.getElementById('a')!.firstChild!, 6);
    range.setEnd(doc.getElementById('b')!.firstChild!, 5);
    const { blocks } = collectBlocks(doc.body, { live: false, dropFurniture: false, includeCode: false, range });
    expect(blocks.map((b) => b.text)).toEqual(['beta gamma.', 'Delta']);
  });
});

describe('findContentRoot', () => {
  it('prefers the article landmark on a page with furniture', () => {
    const doc = parse(site('long-article.html'));
    expect(findContentRoot(doc).tagName).toBe('ARTICLE');
  });
  it('falls back to the densest container when there are no landmarks', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i} has a decent amount of text so that it counts toward the score of its parent container.</p>`).join('');
    const doc = parse(`<div id="menu"><p>Menu</p></div><div id="content">${paragraphs}</div>`);
    expect(findContentRoot(doc).id).toBe('content');
  });
});

describe('articleFromSnapshot (Smart Reader)', () => {
  it('extracts the article and drops cookie banners, ads, hidden text and related links', () => {
    const doc = articleFromSnapshot({ html: site('long-article.html'), url: 'http://localhost:4173/long-article.html', title: 'Long', language: 'en' });
    const text = doc.blocks.map((b) => b.text).join('\n');
    expect(doc.source).toBe('article');
    expect(doc.blocks.filter((b) => b.kind === 'heading').length).toBeGreaterThanOrEqual(6);
    expect(text).not.toContain('We use cookies');
    expect(text).not.toContain('ADVERTISEMENT');
    expect(text).not.toContain('HIDDEN TEXT SHOULD NOT BE READ');
    expect(text).not.toContain('Related: Ten other stories');
    expect(doc.sentences.length).toBeGreaterThan(40);
  });

  it('handles large pages', () => {
    const doc = articleFromSnapshot({ html: site('large.html'), url: 'http://localhost:4173/large.html', title: 'Large', language: 'en' });
    expect(doc.blocks.length).toBeGreaterThanOrEqual(300);
    expect(doc.sentences.length).toBeGreaterThanOrEqual(600);
  });

  it('keeps the English section of a right-to-left page', () => {
    const doc = articleFromSnapshot({ html: site('rtl.html'), url: 'http://localhost:4173/rtl.html', title: 'RTL', language: 'he' });
    expect(doc.blocks.map((b) => b.text).join(' ')).toContain('This English paragraph sits inside a right-to-left page.');
  });
});
