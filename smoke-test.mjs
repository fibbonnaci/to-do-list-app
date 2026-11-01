/**
 * End-to-end smoke test for the to-do app, driven through headless Chrome over
 * the DevTools protocol. Zero dependencies — Node 18+ ships fetch and WebSocket.
 *
 *   node server.js &        # app must be served first
 *   node smoke-test.mjs
 *
 * Exits non-zero if any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP_PORT = 9222;
const APP_URL = process.env.APP_URL || 'http://localhost:3000/';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- make sure the app is actually being served ---
try {
  await fetch(APP_URL);
} catch {
  console.error(`Cannot reach ${APP_URL}. Start the dev server first:\n  node server.js`);
  process.exit(1);
}

// --- launch chrome ---
const { existsSync } = await import('node:fs');
const chromeBin = CHROME_PATHS.find((p) => existsSync(p));
if (!chromeBin) {
  console.error('No Chrome/Chromium found. Install one, or set a path in CHROME_PATHS.');
  process.exit(1);
}

const profileDir = mkdtempSync(join(tmpdir(), 'todo-smoke-'));
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const cleanup = () => {
  chrome.kill();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// --- connect ---
let targets;
for (let i = 0; i < 40; i++) {
  try {
    targets = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
    break;
  } catch { await sleep(250); }
}
if (!targets) throw new Error('Chrome DevTools endpoint never came up');

const newTab = await (
  await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })
).json();

const ws = new WebSocket(newTab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result.result.value;
}

// Fresh slate, then reload so the app boots with empty storage.
await evaluate(`localStorage.clear()`);
await send('Page.reload');
await sleep(600);

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const PAGE_HELPERS = `
  window.__t = {
    items: () => [...document.querySelectorAll('.todo')],
    titles: () => [...document.querySelectorAll('.todo .title')].map(e => e.textContent),
    add: (text) => {
      const i = document.getElementById('new-todo-input');
      i.value = text;
      document.getElementById('new-todo-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    },
    count: () => document.getElementById('count').textContent,
    empty: () => { const e = document.getElementById('empty-state');
                   return e.hidden ? null : e.textContent; },
    filter: (f) => document.querySelector('.filter[data-filter="'+f+'"]').click(),
  };
  true;
`;
await evaluate(PAGE_HELPERS);

// 1. empty state
check('empty state on first load', await evaluate(`__t.empty()`) === 'Nothing here yet. Add your first task above.',
  await evaluate(`JSON.stringify(__t.empty())`));

// 2. add
await evaluate(`__t.add('buy milk'); __t.add('write tests'); __t.add('ship it')`);
check('adds three tasks', await evaluate(`__t.items().length`) === 3, `got ${await evaluate(`__t.items().length`)}`);
check('renders titles in order',
  JSON.stringify(await evaluate(`__t.titles()`)) === JSON.stringify(['buy milk', 'write tests', 'ship it']),
  await evaluate(`JSON.stringify(__t.titles())`));

// 3. blank input is rejected
await evaluate(`__t.add('   ')`);
check('rejects whitespace-only task', await evaluate(`__t.items().length`) === 3);

// 4. XSS safety
await evaluate(`__t.add('<img src=x onerror=alert(1)>')`);
check('escapes HTML in task text',
  await evaluate(`document.querySelectorAll('.todo .title img').length`) === 0);
await evaluate(`__t.items()[3].querySelector('.delete').click()`);

// 5. toggle
await evaluate(`__t.items()[0].querySelector('input[type=checkbox]').click()`);
check('toggle marks done', await evaluate(`__t.items()[0].classList.contains('done')`) === true);
check('count updates', await evaluate(`__t.count()`) === '2 tasks left', await evaluate(`__t.count()`));

// 6. filters
await evaluate(`__t.filter('active')`);
check('active filter hides done', await evaluate(`__t.items().length`) === 2);
await evaluate(`__t.filter('done')`);
check('done filter shows only done', await evaluate(`__t.items().length`) === 1);
await evaluate(`__t.filter('all')`);

// 7. persistence across reload
await send('Page.reload');
await sleep(600);
await evaluate(PAGE_HELPERS);
check('tasks persist across reload', await evaluate(`__t.items().length`) === 3,
  `got ${await evaluate(`__t.items().length`)}`);
check('done state persists', await evaluate(`__t.items()[0].classList.contains('done')`) === true);

// 8. edit via double-click
await evaluate(`__t.items()[1].querySelector('.title')
  .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(120);
check('double-click opens editor', await evaluate(`!!document.querySelector('.todo .edit')`) === true);
await evaluate(`(() => {
  const el = document.querySelector('.todo .edit');
  el.value = 'write MORE tests';
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(120);
check('edit saves new title', (await evaluate(`__t.titles()`))[1] === 'write MORE tests',
  await evaluate(`JSON.stringify(__t.titles())`));

// 9. escape cancels
await evaluate(`__t.items()[1].querySelector('.title')
  .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(120);
await evaluate(`(() => {
  const el = document.querySelector('.todo .edit');
  el.value = 'DISCARD ME';
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
})()`);
await sleep(120);
check('escape discards edit', (await evaluate(`__t.titles()`))[1] === 'write MORE tests',
  await evaluate(`JSON.stringify(__t.titles())`));

// 10. delete
await evaluate(`__t.items()[2].querySelector('.delete').click()`);
check('delete removes one task', await evaluate(`__t.items().length`) === 2);

// 11. clear completed
await evaluate(`document.getElementById('clear-done').click()`);
check('clear completed removes done tasks', await evaluate(`__t.items().length`) === 1);
check('clear button disables when nothing done',
  await evaluate(`document.getElementById('clear-done').disabled`) === true);

// 12. corrupted storage doesn't break boot
await evaluate(`localStorage.setItem('todos', '{not json')`);
await send('Page.reload');
await sleep(600);
await evaluate(PAGE_HELPERS);
check('survives corrupted localStorage', await evaluate(`__t.empty() !== null`) === true);

// --- report ---
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (consoleErrors.length) console.log(`\nConsole errors:\n` + consoleErrors.join('\n'));
else console.log('No console errors or uncaught exceptions.');

ws.close();
process.exit(failed.length ? 1 : 0);
