/**
 * Renders public/icons/icon.svg to the PNG sizes Chrome needs, using the
 * Playwright Chromium already installed for the end-to-end tests.
 *   node scripts/render-icons.ts
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '../public/icons');
const svg = readFileSync(resolve(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: resolve(dir, `icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log('Rendered icons');
