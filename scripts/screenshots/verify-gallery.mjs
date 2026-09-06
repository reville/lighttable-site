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
const plan = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
try {
  for (const test of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'tablet', viewport: { width: 1024, height: 900 } },
    { name: 'mobile', viewport: { width: 390, height: 844 } },
    { name: 'narrow', viewport: { width: 320, height: 740 } },
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

    await page.goto(new URL('./index.html', url).href, { waitUntil: 'domcontentloaded' });
    const details = page.locator('.ui-detail');
    if (await details.count() !== plan.homepage.details.length) {
      throw new Error(`${test.name}: homepage closeups differ from the plan`);
    }
    // Exercise lazy loading and reveals through the real page before taking proof.
    for (const element of await page.locator('.reveal').all()) {
      await element.scrollIntoViewIfNeeded();
      await page.waitForTimeout(180);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.hero-preview img, .ui-detail img')]
      .every((image) => image.complete && image.naturalWidth > 0));
    const homepage = await page.evaluate(() => {
      const hero = document.querySelector('.hero-preview img');
      const link = document.querySelector('.hero-preview .screenshot-link');
      const heroRect = hero.getBoundingClientRect();
      return {
        background: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hero: { width: hero.naturalWidth, height: hero.naturalHeight },
        portrait: heroRect.height > heroRect.width,
        linkBelowImage: link.getBoundingClientRect().top >= heroRect.bottom,
        captionsStacked: [...document.querySelectorAll('.ui-detail figcaption')].every((caption) => {
          const label = caption.querySelector('.eyebrow').getBoundingClientRect();
          const heading = caption.querySelector('h3').getBoundingClientRect();
          const description = caption.querySelector('.ui-detail-caption').getBoundingClientRect();
          return heading.top >= label.bottom && description.top >= heading.bottom;
        }),
        insets: [...document.querySelectorAll('.ui-detail-inset img')].map((image) => ({
          src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight,
          displayedWidth: image.getBoundingClientRect().width,
        })),
      };
    });
    if (homepage.overflow > 1 || !homepage.portrait || !homepage.linkBelowImage || !homepage.captionsStacked
        || homepage.background !== 'rgb(36, 36, 36)' || errors.length) {
      throw new Error(`${test.name}: ${JSON.stringify({ homepage, errors })}`);
    }
    const [, , heroWidth, heroHeight] = plan.homepage.hero.crop;
    if (homepage.hero.width !== heroWidth || homepage.hero.height !== heroHeight) {
      throw new Error(`${test.name}: homepage hero is not the planned crop`);
    }
    for (const [index, inset] of homepage.insets.entries()) {
      const entry = plan.homepage.details[index];
      if (inset.src !== `screenshots/${entry.asset}` || inset.width !== entry.crop[2]
          || inset.height !== entry.crop[3] || inset.displayedWidth < Math.min(250, test.viewport.width - 80)) {
        throw new Error(`${test.name}: missing or unreadably small closeup ${entry.id}`);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outputDirectory, `homepage-${test.name}.png`), fullPage: true });
    // Keep scroll at zero: element screenshots of tall sections can pull an
    // offscreen fixed skip link into the captured region.
    for (const [selector, label] of [['.hero', 'hero'], ['.ui-details', 'closeups']]) {
      const clip = await page.locator(selector).boundingBox();
      await page.screenshot({
        path: path.join(outputDirectory, `${label}-${test.name}.png`), fullPage: true, clip,
      });
    }
    const insetLink = page.locator('.ui-detail-inset').first();
    await insetLink.click();
    await page.waitForURL(`**/screenshots/${plan.homepage.details[0].asset}`);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.locator('.hero-preview .screenshot-link').click();
    await page.waitForURL('**/screenshots.html');
    results.push({ name: `homepage-${test.name}`, ...homepage, linksWork: true });
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
