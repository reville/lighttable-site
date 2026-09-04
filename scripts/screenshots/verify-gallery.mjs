#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [url, outputDirectory, browserExecutable] = process.argv.slice(2);
const modulePath = process.env.LIGHTTABLE_PLAYWRIGHT_MODULE;
if (!url || !outputDirectory || !browserExecutable || !modulePath) {
  throw new Error('usage: verify-gallery.mjs URL OUTPUT_DIR BROWSER_EXECUTABLE');
}
const { chromium } = await import(pathToFileURL(modulePath).href);
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
const results = [];
try {
  for (const test of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'mobile', viewport: { width: 390, height: 844 } },
  ]) {
    const page = await browser.newPage({ viewport: test.viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const figures = page.locator('.gallery figure');
    const count = await figures.count();
    if (count !== 10) throw new Error(`${test.name}: expected 10 figures, found ${count}`);
    for (let index = 0; index < count; index += 1) {
      await figures.nth(index).scrollIntoViewIfNeeded();
      await page.waitForTimeout(180);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.gallery img')].every(
      (image) => image.complete && image.naturalWidth > 0));
    const state = await page.evaluate(() => ({
      visible: [...document.querySelectorAll('.gallery figure')].filter(
        (figure) => figure.classList.contains('is-visible')).length,
      decoded: [...document.querySelectorAll('.gallery img')].filter(
        (image) => image.complete && image.naturalWidth > 0).length,
      uniqueSources: new Set([...document.querySelectorAll('.gallery img')].map(
        (image) => image.getAttribute('src'))).size,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    if (state.visible !== 10 || state.decoded !== 10 || state.uniqueSources !== 10
        || state.overflow > 1 || errors.length) {
      throw new Error(`${test.name}: ${JSON.stringify({ state, errors })}`);
    }
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(outputDirectory, `gallery-${test.name}.png`), fullPage: true,
    });
    results.push({ name: test.name, ...state });
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
