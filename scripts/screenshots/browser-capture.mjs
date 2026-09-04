#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const modulePath = process.env.LIGHTTABLE_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('LIGHTTABLE_PLAYWRIGHT_MODULE is not set');
const { chromium } = await import(pathToFileURL(modulePath).href);

const browser = await chromium.launch({
  headless: true,
  executablePath: config.browserExecutable,
});
const page = await browser.newPage({ viewport: config.viewport });
const diagnostics = [];
page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => diagnostics.push(
  `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    diagnostics.push(`console.${message.type()}: ${message.text()}`);
  }
});
await page.addInitScript(() => { window.__LIGHTTABLE_BENCHMARK__ = true; });

async function api(route, method = 'GET', body = null) {
  return page.evaluate(async ({ route: target, method: verb, body: payload }) => {
    const options = { method: verb, cache: 'no-store' };
    if (payload !== null) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(target, options);
    const value = await response.json();
    if (!response.ok) throw new Error(`${verb} ${target}: ${response.status} ${value.error || ''}`);
    return value;
  }, { route, method, body });
}

function mergeState(current, patch) {
  const merged = { ...current, ...patch };
  for (const field of ['params', 'grade', 'optics']) {
    if (patch[field]) merged[field] = { ...(current[field] || {}), ...patch[field] };
  }
  for (const field of ['name', 'provenance', 'width', 'height', 'raw', 'kind', 'folder',
    'sourceName', 'displayName', 'fileKey', 'mtime', 'ai', 'virtual']) delete merged[field];
  return merged;
}

async function updateState(name, patch, label) {
  const current = await api(`/api/state?name=${encodeURIComponent(name)}`);
  const entry = mergeState(current, patch);
  await api('/api/state', 'POST', {
    name, ...entry, origin: 'website-screenshot-pipeline', historyLabel: label,
  });
}

async function uiCommand(command, args = {}) {
  const response = await api('/api/ui/command', 'POST', {
    command, args, origin: 'website-screenshot-pipeline', timeout: 30,
  });
  if (response.ok === false) throw new Error(response.error || `${command} failed`);
  return response;
}

async function uiState() {
  return api('/api/ui/state');
}

async function waitForUI(name, pane, expectation = {}) {
  const deadline = Date.now() + 240_000;
  let state = {};
  while (Date.now() < deadline) {
    state = await uiState();
    const render = state.render || {};
    const ready = state.current === name
      && state.pane === `${pane}Pane`
      && render.state === 'ready'
      && render.name === name;
    const compareReady = expectation.compare === undefined
      || Boolean(state.compare?.active) === Boolean(expectation.compare);
    const toolReady = expectation.activeTool === undefined
      || state.activeTool === expectation.activeTool;
    if (ready && compareReady && toolReady) return state;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`shot did not settle for ${name}: ${JSON.stringify(state)}`);
}

const output = { schema: 1, shots: [], diagnostics };
try {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(
    () => window.__lightTablePerf && document.querySelector('#editor:not(.hide)'),
    null, { timeout: 240_000 },
  );
  const library = await api('/api/images?limit=100');
  const names = new Map(library.images.map((item) => [item.displayName, item.name]));

  for (const [index, shot] of config.shots.entries()) {
    const name = names.get(shot.source);
    if (!name) throw new Error(`source is not visible in the app: ${shot.source}`);
    let state = await uiState();
    if (state.compare?.active) await uiCommand('compare');
    await uiCommand('goto', { name });

    if (shot.historySteps?.length) {
      for (const step of shot.historySteps) {
        await updateState(name, step.patch || {}, step.label);
      }
    } else {
      await updateState(name, shot.patch || {}, `Gallery: ${shot.title}`);
    }

    await uiCommand('goto', { name });
    await uiCommand(`pane:${shot.pane}`);
    if (shot.pane === 'mask') await uiCommand('mask.show', { id: 'gallery-radial' });
    for (const command of shot.commands || []) await uiCommand(command);
    await uiCommand('zoomFit');
    state = await waitForUI(name, shot.pane, shot.expect || {});
    await page.waitForFunction(
      () => !document.querySelector('.toast.show'), null, { timeout: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, config.settleMilliseconds));
    const destination = path.join(config.outputDirectory, `${shot.id}.png`);
    await page.screenshot({ path: destination, animations: 'disabled' });
    output.shots.push({
      id: shot.id,
      source: shot.source,
      backend: state.render?.backend || 'unknown',
      pane: state.pane,
      width: config.viewport.width,
      height: config.viewport.height,
    });
    process.stderr.write(`[${String(index + 1).padStart(2, '0')}/10] ${shot.id}\n`);
  }

  const fatal = diagnostics.filter((entry) => entry.startsWith('pageerror:'));
  if (fatal.length) throw new Error(`browser page errors: ${fatal.join('; ')}`);
} catch (error) {
  const snapshot = await page.evaluate(() => ({
    readyState: document.readyState,
    status: document.querySelector('#rstat')?.textContent || null,
    current: document.querySelector('#filename')?.textContent || null,
  })).catch(() => ({}));
  process.stderr.write(`${JSON.stringify({
    error: String(error?.message || error), snapshot, diagnostics: diagnostics.slice(-30),
  }, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(output)}\n`);
