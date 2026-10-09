// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {importText, normalizeState, newDraft, showDraft, moveItem, removeItem, selectItem} from '../letters/web/core.js';
const {chromium} = createRequire(import.meta.url)('playwright');
const artifacts = process.argv[2];
const connection = JSON.parse(await fs.readFile(path.join(artifacts, 'connection.json'), 'utf8'));
const controlUrl = new URL(connection.control), origin = controlUrl.origin, token = controlUrl.searchParams.get('token');
const auth = {'X-OBS-Letters-Token': token};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test()) return; await sleep(80); }
  throw new Error(message);
}
async function get(id = connection.sourceId) { const r = await fetch(`${origin}/api/state/${id}`, {headers: auth}); assert.equal(r.status, 200); return r.json(); }
async function stats() { return JSON.parse(await fs.readFile(path.join(artifacts, 'native-stats.json'), 'utf8')); }
const browser = await chromium.launch({executablePath: process.env.LETTERS_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const context = await browser.newContext({viewport: {width: 1440, height: 1050}});
const page = await context.newPage(), display = await context.newPage();
const browserErrors = [];
for (const p of [page, display]) p.on('pageerror', error => browserErrors.push(error.message));
const passed = [];
function pass(message) { passed.push(message); console.log(`PASS: ${message}`); }
async function saved() { await until(async () => (await page.locator('#save-status').textContent()) === 'OBSに保存済み', 'changes did not persist'); }

try {
  const paragraphs = '一段落目。\n\n二段落目。';
  assert.deepEqual(importText(`${paragraphs}\n---\nもう一件。\n///\n三件目。`).map(item => item.text), [paragraphs, 'もう一件。', '三件目。']);
  const base = normalizeState({items: [{id: 'a', text: '表示中。'}, {id: 'b', text: '次のお便り。'}], draft: {id: 'a', text: '表示中。'}});
  showDraft(base); const snapshot = structuredClone(base.live);
  selectItem(base, 'b'); moveItem(base, 'b', 0); removeItem(base, 'a'); assert.deepEqual(base.live, snapshot);
  newDraft(base); assert.deepEqual(base.live, snapshot);
  pass('queue operations preserve the aired snapshot; paragraph imports preserve blank lines');

  assert.equal((await fetch(`${origin}/api/sources`)).status, 403);
  assert.equal((await fetch(`${origin}/api/sources`, {headers: {...auth, Origin: 'https://example.com'}})).status, 403);
  assert.equal((await fetch(`${origin}/runtime/http.lua`, {headers: auth})).status, 404);
  const sources = await (await fetch(`${origin}/api/sources`, {headers: auth})).json(); assert.equal(sources.sources.length, 2);
  pass('loopback API rejects missing credentials and foreign origins; sources remain independent');

  await page.goto(connection.control); await page.locator('#app').waitFor({state: 'visible'});
  await display.goto(connection.display);
  assert.equal((await get()).state.items.length, 0); assert.equal((await stats()).visible, false);
  await page.locator('#draft-title').fill('最近のゲーム');
  const first = '最近遊んでいるゲームと、おすすめの遊び方を教えてください。';
  await page.locator('#draft-text').fill(first); await page.locator('#save-draft').click(); await saved();
  assert.equal((await get()).state.items.length, 1); assert.equal((await stats()).visible, false);
  await page.locator('#show-letter').click();
  await until(async () => (await display.locator('.letter-text').textContent()) === first && (await stats()).visible, 'show did not reach browser and native output');
  const aired = structuredClone((await get()).state.live);
  await page.locator('#draft-text').fill('この編集はまだ配信には出ません。');
  await page.locator('#fontSize').fill('52'); await page.locator('#fontSize').dispatchEvent('change'); await saved();
  assert.deepEqual((await get()).state.live, aired); assert.equal(await display.locator('.letter-text').textContent(), first);
  assert.equal(await display.locator('.letter-text').evaluate(node => getComputedStyle(node).fontSize), '48px');
  pass('editing the next text or font leaves the current broadcast unchanged');

  await page.locator('#new-letter').click();
  const long = ('「日本語のお便り」です。句読点や括弧を自然に折り返し、読みやすい文字サイズを保ちます。' +
    'OBS Studio 123、ゲームのお話。👨‍👩‍👧‍👦 👍🏽 e\u0301 か\u3099\n\n').repeat(9);
  await page.locator('#draft-title').fill('長いお便り'); await page.locator('#draft-text').fill(long);
  await page.locator('#save-draft').click(); await saved();
  await until(async () => /全\d+ページ/.test(await page.locator('#preview-info').textContent()), 'long letter was not paginated');
  const pageInfo = await page.evaluate(async content => {
    const Core = await import('/core.js');
    const result = await fetch(`/api/state/${new URLSearchParams(location.search).get('source')}`, {headers: {'X-OBS-Letters-Token': new URLSearchParams(location.search).get('token')}});
    const state = (await result.json()).state, pages = await Core.paginate(content, state.style);
    const widths = [];
    for (let index = 0; index < pages.length; index++) {
      const host = document.createElement('div'); host.style.position = 'fixed'; host.style.left = '-20000px'; document.body.append(host);
      await Core.renderLetter(host, {text: content, title: '長いお便り'}, state.style, index);
      const body = host.querySelector('.letter-text'), viewport = host.querySelector('.letter-viewport');
      widths.push({height: body.getBoundingClientRect().height, limit: viewport.getBoundingClientRect().height, width: body.scrollWidth, limitWidth: body.clientWidth}); host.remove();
    }
    return {pages, widths};
  }, long);
  assert.equal(pageInfo.pages.join(''), long); assert(pageInfo.pages.length > 2);
  for (const size of pageInfo.widths) { assert(size.height <= size.limit + .1); assert(size.width <= size.limitWidth + 1); }
  for (const chunk of pageInfo.pages) { assert(!/^[\u0301\u3099\u200d\uFE0F]/.test(chunk)); assert(!chunk.endsWith('\u200d')); }
  await page.locator('#show-letter').click(); await until(async () => (await get()).renderedLiveRevision === (await get()).liveRevision, 'browser did not acknowledge long letter');
  await until(async () => (await stats()).visible, 'native output remained hidden');
  const beforePage = (await get()).state.live.page;
  await page.locator('#live-next').click(); await saved(); assert.equal((await get()).state.live.page, beforePage + 1);
  await until(async () => await display.locator('.letter-text').textContent() === pageInfo.pages[1], 'page button did not update rendered text');
  const outline = await display.locator('.letter-text').evaluate(node => getComputedStyle(node).fontSize); assert.equal(outline, '52px');
  await fs.writeFile(path.join(artifacts, 'hotkey.request'), 'previous');
  await until(async () => (await get()).state.live.page === 0, 'OBS hotkey did not change page');
  await until(async () => (await display.locator('.letter-text').textContent()) === pageInfo.pages[0], 'hotkey did not update browser page');
  assert.equal((await stats()).hotkeys, 6);
  pass('long Japanese text fits actual font metrics; page breaks preserve all text and emoji clusters');

  const edgeLayout = await page.evaluate(async () => {
    const Core = await import('/core.js');
    const style = {...Core.DEFAULT_STYLE, width: 320, height: 180, fontSize: 96, lineHeight: 1.1,
      padding: {top: 0, right: 0, bottom: 0, left: 0}, innerPadding: 0, showPageNumber: false};
    const started = performance.now(), content = '日本語。'.repeat(1000), pages = await Core.paginate(content, style);
    let invalid = false;
    try { await Core.paginate('収まらない', {...style, padding: {top: 400, right: 400, bottom: 400, left: 400}}); }
    catch { invalid = true; }
    return {pages: pages.length, exact: pages.join('') === content, milliseconds: performance.now() - started, invalid};
  });
  assert(edgeLayout.exact && edgeLayout.invalid); assert(edgeLayout.pages > 500); assert(edgeLayout.milliseconds < 10000);
  pass('small frames and long letters stay bounded; impossible padding yields a useful layout error');

  await page.locator('#finish-live').click(); await saved();
  assert.equal((await get()).state.live.visible, false); assert((await get()).state.items.find(item => item.title === '長いお便り').done);
  await until(async () => !(await stats()).visible, 'finish did not hide native output');
  await page.locator('.queue-select').last().click(); await page.locator('#move-up').click(); await saved();
  assert.equal((await get()).state.items[0].title, '長いお便り');
  await page.locator('#delete-letter').click(); await saved(); assert.equal((await get()).state.items.length, 1);
  await page.locator('#undo').click(); await saved(); assert.equal((await get()).state.items.length, 2);
  pass('finish selects the next letter without airing it; reorder, delete and undo work');

  await page.locator('#import-file').setInputFiles({name: 'お便り.txt', mimeType: 'text/plain', buffer: Buffer.from('最初の段落。\n\n次の段落。\n---\n<script>window.unwanted = true</script>')});
  await saved(); await until(async () => (await get()).state.items.length === 4, 'text import failed');
  assert.equal((await get()).state.items[2].text, '最初の段落。\n\n次の段落。');
  await page.locator('.queue-select').last().click(); await page.locator('#show-letter').click();
  await until(async () => (await display.locator('.letter-text').textContent())?.includes('<script>'), 'literal text did not render');
  assert.equal(await display.evaluate(() => window.unwanted), undefined); assert.equal(await page.evaluate(() => window.unwanted), undefined);
  const itemsBefore = (await get()).state.items.length;
  await page.locator('#import-file').setInputFiles({name: '壊れた.json', mimeType: 'application/json', buffer: Buffer.from('{bad json')});
  await sleep(300); assert.equal((await get()).state.items.length, itemsBefore);
  pass('text file imports preserve paragraphs; malformed JSON and HTML-looking text are handled safely');

  await page.locator('.import-menu summary').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await downloadPromise, backupPath = await download.path(), backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert.equal(backup.items.length, 4); assert.equal(backup.live.visible, true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restore-file').setInputFiles({name: 'バックアップ.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))});
  await saved(); await until(async () => !(await get()).state.live.visible, 'restoring backup did not hide output');
  assert.equal((await get()).state.items.length, 4);
  pass('backup export includes drafts and settings; restore keeps content and requires deliberate display');

  const envelope = await get();
  const conflict = await fetch(`${origin}/api/state/${connection.sourceId}`, {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: -100, state: envelope.state})});
  assert.equal(conflict.status, 409); assert.deepEqual((await get()).state, envelope.state);
  assert.equal((await get(connection.otherId)).state.items.length, 0);
  const stalePanel = await context.newPage();
  await stalePanel.goto(connection.control); await stalePanel.locator('#app').waitFor({state: 'visible'});
  const staleEnvelope = await get();
  await stalePanel.route('**/api/state/**', route => route.request().method() === 'GET' ?
    route.fulfill({json: staleEnvelope}) : route.continue());
  await page.locator('#draft-title').fill('こちらの画面で保存したメモ'); await saved();
  await stalePanel.locator('#draft-title').fill('競合した画面の未保存入力');
  await until(async () => (await stalePanel.locator('#save-status').textContent()) === '入力をこの画面に保持しています', 'stale panel did not preserve conflicting input');
  assert.equal((await get()).state.draft.title, 'こちらの画面で保存したメモ');
  assert.equal(await stalePanel.locator('#draft-title').inputValue(), '競合した画面の未保存入力');
  await stalePanel.close();
  pass('stale operation windows preserve conflicting input without overwriting; multiple sources have separate queues');

  await page.locator('#fontSize').fill('48'); await page.locator('#fontSize').dispatchEvent('change');
  await page.locator('#draft-title').fill('ゲーム選びのお便り'); await page.locator('#draft-text').fill('初めて遊ぶ人におすすめのゲームはありますか？\n\n最近の配信で楽しかった場面も、ぜひ教えてください。');
  await page.locator('#show-letter').click(); await saved();
  await until(async () => (await stats()).visible && (await get()).renderedLiveRevision === (await get()).liveRevision, 'final display not ready');
  await page.screenshot({path: path.join(artifacts, 'operation-panel.png'), fullPage: true});
  await display.setViewportSize({width: 960, height: 540}); await display.screenshot({path: path.join(artifacts, 'letter-output.png'), omitBackground: true});
  const beforeRestoreEnvelope = await get(), beforeRestore = beforeRestoreEnvelope.state;
  // Keep the panel on its acknowledged version until the post-restore action.
  // This makes a source-recreation race deterministic instead of waiting for its poll.
  await page.route('**/api/state/**', route => route.request().method() === 'GET' ?
    route.fulfill({json: beforeRestoreEnvelope}) : route.continue());
  await fs.writeFile(path.join(artifacts, 'save.request'), 'save');
  await until(async () => { try { await fs.stat(path.join(artifacts, 'saved-source.json')); return true; } catch { return false; } }, 'native scene save failed');
  const nativeSaved = JSON.parse(await fs.readFile(path.join(artifacts, 'saved-source.json'), 'utf8'));
  assert.deepEqual(JSON.parse(nativeSaved.settings.letter_state), beforeRestore);
  await fs.writeFile(path.join(artifacts, 'restore.request'), 'restore');
  await until(async () => { try { await fs.stat(path.join(artifacts, 'restored')); return true; } catch { return false; } }, 'native scene restore failed');
  await until(async () => (await get()).renderedLiveRevision === (await get()).liveRevision && (await stats()).visible, 'restored source did not resume after paint');
  assert.deepEqual((await get()).state, beforeRestore);
  await page.keyboard.press('Escape'); await saved(); await until(async () => !(await stats()).visible, 'Escape did not hide native output');
  await page.unroute('**/api/state/**');
  pass('native OBS save/restore keeps state; render readiness and immediate hide remain correct');

  await page.setViewportSize({width: 390, height: 844}); await sleep(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
  assert.deepEqual(browserErrors, []);
  pass('desktop and narrow layouts stay usable without horizontal overflow or browser errors');
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({passed, runtime: 'Linux libobs 30.2.3 + actual OBS LuaJIT + Chromium', caveat: 'OBS browser API is a stand-in in the host; the HTML renderer is exercised in real Chromium. macOS and Windows runtimes are not run here.'}, null, 2));
  console.log(`All ${passed.length} letter checks passed.`);
} catch (error) {
  await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: true}).catch(() => {});
  console.error('Operation panel:', await page.locator('#save-status').textContent(), await page.locator('#notice').textContent());
  throw error;
} finally { await browser.close(); }
