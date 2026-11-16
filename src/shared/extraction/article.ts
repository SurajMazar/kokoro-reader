import { Readability } from '@mozilla/readability';
import type { PageSnapshot } from '../messages/contract';
import { buildDoc } from '../text/doc';
import type { ReadingDoc } from '../types';
import { collectBlocks, findContentRoot } from './collect';

/**
 * Builds a Smart Reader document from a page snapshot using Mozilla
 * Readability, falling back to the main-content heuristic when Readability
 * cannot find an article. Runs only in extension pages: the HTML is parsed
 * into an inert document and only text is extracted, never rendered.
 */
export function articleFromSnapshot(snapshot: PageSnapshot): ReadingDoc {
  const parser = new DOMParser();
  const doc = parser.parseFromString(snapshot.html, 'text/html');
  // Resolve relative URLs for any later link handling, and give Readability the page URL.
  const base = doc.createElement('base');
  base.href = snapshot.url;
  doc.head?.prepend(base);

  const siteName = safeHost(snapshot.url);
  let article: ReturnType<Readability<string>['parse']> = null;
  try {
    article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse();
  } catch {
    article = null;
  }

  if (article?.content) {
    const content = parser.parseFromString(article.content, 'text/html');
    const { blocks } = collectBlocks(content.body, { live: false, dropFurniture: false, includeCode: false });
    if (blocks.length) {
      const title = article.title || snapshot.title;
      const firstIsTitle = blocks[0]?.kind === 'heading' && blocks[0].text.trim() === title.trim();
      return buildDoc({
        title,
        url: snapshot.url,
        siteName: article.siteName || siteName,
        byline: article.byline ?? undefined,
        source: 'article',
        language: article.lang || snapshot.language,
        blocks: firstIsTitle ? blocks : [{ kind: 'heading', level: 1, text: title }, ...blocks],
      });
    }
  }

  const root = findContentRoot(doc);
  const { blocks } = collectBlocks(root, { live: false, dropFurniture: true, includeCode: false });
  return buildDoc({ title: snapshot.title, url: snapshot.url, siteName, source: 'article', language: snapshot.language, blocks });
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
