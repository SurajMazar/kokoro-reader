// @vitest-environment jsdom
/**
 * "Read page" on the layouts of real Nepali news sites (structure reproduced
 * from onlinekhabar.com, ekantipur.com and setopati.com, November 2026, with
 * placeholder text).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readPage } from '@/content/extraction/page-reader';

const para = (n: number) => `<p>अनुच्छेद ${n}: यो समाचारको मुख्य भाग हो र यसमा पर्याप्त लामो वाक्य छन् जसले लेखलाई पढ्न योग्य बनाउँछ ।</p>`;
const paras = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => para(from + i)).join('');

function load(html: string, title: string) {
  document.head.innerHTML = `<meta property="og:title" content="${title}"><title>${title} – Site</title>`;
  document.body.innerHTML = html;
}

const read = () => readPage().doc.blocks.map((block) => block.text);

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('readPage on Nepali news layouts', () => {
  it('onlinekhabar: skips the score widget and ticker that share <main> with the article', () => {
    load(
      `<header><h1><a href="/">onlinekhabar</a></h1></header>
       <main id="primary">
         <div class="live-score"><span>सुदूरपश्चिम रोयल्स 2026</span><div>0/0</div><div>vs</div><div>TU INTERNATIONAL CRICKET STADIUM</div></div>
         <div class="ticker"><p>मलेसिया श्रमिक ठगी प्रकरण : पूर्वमुख्यसचिव अर्याल पनि जोडिए, पक्राउ पुर्जी जारी</p></div>
         <article><div class="title"><h1>पुरुषहरूलाई पनि चाहिन्छ भावनात्मक सहयोग</h1></div>
           <div class="ok18-single-post-content-wrap"><div class="entry-content">${paras(1, 6)}</div></div>
         </article>
       </main>`,
      'पुरुषहरूलाई पनि चाहिन्छ भावनात्मक सहयोग',
    );
    const blocks = read();
    expect(blocks[0]).toBe('पुरुषहरूलाई पनि चाहिन्छ भावनात्मक सहयोग');
    expect(blocks.slice(1)).toHaveLength(6);
    expect(blocks.join(' ')).not.toMatch(/0\/0|STADIUM|मलेसिया/);
  });

  it('ekantipur: reads every section of a story split into sibling sections, from the headline to the last paragraph', () => {
    const sections = Array.from({ length: 12 }, (_, i) => `<section class="news-section-wrap-story"><div class="news-inner-wrapper">${paras(i * 3 + 1, i * 3 + 3)}</div></section><div class="ad">ADVERTISEMENT</div>`).join('');
    load(
      `<div class="top-menu"><a href="/">गृहपृष्ठ</a> <a href="/news">समाचार</a> <span>बिहीबार, मंसिर ४, २०८३</span></div>
       <section class="news-section-wrap"><div class="article-header"><div class="headline">प्रधानमन्त्रीको भारत भ्रमणमा दीर्घकालीन मुद्दा</div></div></section>
       ${sections}
       <section class="more-news"><h2>थप समाचार</h2><ul><li><a href="/x">अर्को समाचार</a></li></ul></section>
       <footer><p>कान्तिपुर पब्लिकेशन्स् लि., सेन्ट्रल बिजनेस पार्क, थापाथली, काठमाडौं, नेपाल ।</p></footer>`,
      'प्रधानमन्त्रीको भारत भ्रमणमा दीर्घकालीन मुद्दा',
    );
    const blocks = read();
    expect(blocks[0]).toBe('प्रधानमन्त्रीको भारत भ्रमणमा दीर्घकालीन मुद्दा');
    expect(blocks.filter((text) => text.startsWith('अनुच्छेद'))).toHaveLength(36);
    expect(blocks.at(-1)).toMatch(/^अनुच्छेद 36/);
    expect(blocks.join(' ')).not.toMatch(/गृहपृष्ठ|थप समाचार|अर्को समाचार/);
  });

  it('setopati: reads a story whose body is inside an <aside>', () => {
    load(
      `<nav><a href="/">सेतोपाटी</a></nav>
       <div id="content"><div class="container">
         <div class="title-wrap"><h1 class="news-big-title">टिनको छानामुनि चिसोले काम्दै बसिरहेकी गर्भवती महिला</h1></div>
         <div class="row"><aside class="left-side"><div class="row"><div class="editor-box">${paras(1, 5)}</div></div></aside>
           <div class="right-side"><p>विज्ञापन</p></div></div>
       </div></div>`,
      'टिनको छानामुनि चिसोले काम्दै बसिरहेकी गर्भवती महिला',
    );
    const blocks = read();
    expect(blocks[0]).toBe('टिनको छानामुनि चिसोले काम्दै बसिरहेकी गर्भवती महिला');
    expect(blocks.slice(1)).toHaveLength(5);
  });

  it('keeps the whole article when one long lead paragraph has its own wrapper', () => {
    const lead = `<div class="lead"><p>${'मुख्य '.repeat(200)}।</p></div>`;
    load(`<article><h1>शीर्षक यहाँ छ र लामो छ</h1>${lead}<div class="body">${paras(1, 3)}</div></article>`, 'शीर्षक यहाँ छ र लामो छ');
    expect(read()).toHaveLength(5);
  });
});
