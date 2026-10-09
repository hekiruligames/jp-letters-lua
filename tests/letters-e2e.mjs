// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {importText, normalizeState, newDraft, showDraft, moveItem, removeItem, selectItem} from '../letters/web/core.js';
import {UI_THEMES, contrast} from '../letters/web/themes.js';
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
  assert.equal((await fetch(`${origin}/api/font?name=DejaVu%20Sans`)).status, 403);
  assert.equal((await fetch(`${origin}/api/font?name=${encodeURIComponent('/etc/passwd')}`, {headers: auth})).status, 404);
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

  const environment = await (await fetch(`${origin}/api/environment`, {headers: auth})).json();
  const families = await (await fetch(`${origin}/api/fonts`, {headers: auth})).json();
  assert.equal(environment.canvasWidth, 1920); assert.equal(environment.canvasHeight, 1080);
  assert.equal(families.error, ''); assert(families.fonts.length > 2);
  await page.locator('#draft-text').fill('短いお便りです。'); await saved();
  const fontBefore = (await get()).state.style.font, liveBeforeFont = structuredClone((await get()).state.live);
  await page.locator('#font').selectOption('__custom__'); await page.locator('#font-custom').fill('DejaVu Sans Mono');
  await until(async () => page.evaluate(async () => {
    const Core = await import('/core.js'), status = Core.fontStatus('DejaVu Sans Mono');
    return status.loaded && document.querySelector('#preview-host .letter-text')?.style.fontFamily.includes(status.alias);
  }), 'font typing did not update preview without blur');
  const webfont = await page.evaluate(async () => {
    const Core = await import('/core.js'), alias = Core.fontStatus('DejaVu Sans Mono').alias;
    const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
    c.font = `500 48px "${alias}"`; const narrow = c.measureText('iiii').width, wide = c.measureText('WWWW').width;
    c.font = '500 48px sans-serif'; const fallback = [c.measureText('iiii').width, c.measureText('WWWW').width];
    return {loaded: [...document.fonts].some(face => face.family === alias && face.status === 'loaded'), narrow, wide, fallback};
  });
  assert(webfont.loaded); assert(Math.abs(webfont.narrow - webfont.wide) < .01);
  assert(Math.abs(webfont.fallback[0] - webfont.fallback[1]) > 10, 'the font test must detect fallback rendering');
  let exportedFont;
  await until(async () => {
    exportedFont = await fetch(`${origin}/api/font?name=${encodeURIComponent(environment.defaultFont)}`, {headers: auth});
    if (exportedFont.status === 202) { await exportedFont.text(); return false; }
    return true;
  }, 'font export did not finish');
  assert.equal(exportedFont.status, 200);
  const fontBytes = new Uint8Array(await exportedFont.arrayBuffer()), data = new DataView(fontBytes.buffer);
  let checksum = 0;
  for (let offset = 0; offset < fontBytes.length; offset += 4) checksum = (checksum + data.getUint32(offset)) >>> 0;
  assert.equal(checksum, 0xb1b0afba, 'the extracted TTC face must retain a valid SFNT checksum');
  assert(['OTTO', '\x00\x01\x00\x00'].includes(Buffer.from(fontBytes.slice(0, 4)).toString('latin1')));
  assert.equal(await page.locator('#font-custom').evaluate(node => node === document.activeElement), true);
  await saved(); assert.deepEqual((await get()).state.live, liveBeforeFont);
  await page.locator('#font').selectOption(fontBefore); await saved();
  const macPage = await context.newPage(); await macPage.addInitScript(() => Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'}));
  await macPage.goto(connection.control); await macPage.locator('#app').waitFor({state: 'visible'});
  assert.equal(await macPage.locator('#show-shortcut').textContent(), 'Option ↵'); await macPage.close();
  assert.equal(await page.locator('#show-shortcut').textContent(), 'Alt ↵');
  pass('host fonts populate the selector; private webfonts render real glyph metrics and valid TTC checksums; typing updates preview immediately; OS shortcut labels differ');

  await page.getByText('カードと表示する情報', {exact: true}).click();
  await page.locator('#backgroundOpacity').focus(); await page.locator('#backgroundOpacity').press('Home'); await saved();
  assert.equal((await get()).state.style.backgroundOpacity, 0);
  const range = await page.locator('#backgroundOpacity').boundingBox();
  await page.mouse.click(range.x + range.width - 1, range.y + range.height / 2); await saved();
  assert.equal(await page.locator('#backgroundOpacity').inputValue(), '100');
  assert.equal((await get()).state.style.backgroundOpacity, 1);
  assert.equal(await page.locator('#backgroundOpacity').evaluate(node => getComputedStyle(node).paddingRight), '0px');
  assert.equal(await page.locator('#opacity-value').textContent(), '100%');
  await page.locator('#show-letter').click(); await saved();
  await until(async () => (await display.locator('.letter-card').evaluate(node => getComputedStyle(node).backgroundColor)).endsWith(', 255, 255)'), 'opaque white card not rendered');
  await display.setViewportSize({width: 960, height: 540});
  await display.screenshot({path: path.join(artifacts, 'opaque-card.png'), omitBackground: true});
  const draftBeforeHide = (await get()).state.draft.text;
  await page.locator('#hide-editor').click(); await saved(); await until(async () => !(await stats()).visible, 'editor hide did not reach OBS');
  assert.equal((await get()).state.draft.text, draftBeforeHide);
  pass('right edge sets exactly 100% opacity without range padding; the editor hide button retains the draft');

  const beforeClear = (await get()).state.style;
  await page.locator('[data-theme="clear"]').click(); await saved();
  assert.deepEqual((await get()).state.style, {...beforeClear, backgroundOpacity: 0, outlineWidth: 8});
  await page.locator('[data-theme="maro"]').click(); await saved(); assert.equal((await get()).state.style.background, '#fff4f8');
  await page.locator('#ui-theme-open').click(); await page.locator('[data-ui-theme="sakura"]').click(); await saved();
  await page.locator('#ui-theme-dialog').getByText('閉じる', {exact: true}).click();
  const beforeReset = (await get()).state;
  await page.locator('#reset-style').click(); await saved();
  const reset = (await get()).state;
  assert.deepEqual(reset.items, beforeReset.items); assert.deepEqual(reset.draft, beforeReset.draft);
  assert.deepEqual(reset.live, beforeReset.live); assert.deepEqual(reset.ui, beforeReset.ui);
  assert.equal(reset.style.font, environment.defaultFont); assert.equal(reset.style.width, 960); assert.equal(reset.style.height, 540);
  assert.equal(reset.style.background, '#ffffff'); assert.equal(reset.style.textColor, '#222222');
  pass('transparent preset changes only opacity and outline; reset restores display defaults and preserves letters, live text and UI theme');

  await page.locator('[data-frame="1280,720"]').click(); await saved();
  assert.equal((await get()).state.style.height, 720); assert.equal((await get()).state.style.width, 1280);
  await page.locator('[data-frame="1920,1080"]').click(); await saved(); assert.equal((await get()).state.style.height, 1080);
  await page.locator('#obs-frame').click(); await saved(); assert.equal((await get()).state.style.width, environment.canvasWidth);
  await page.locator('[data-frame="960,540"]').click(); await page.locator('#auto-height').click(); await saved();
  await until(async () => (await page.locator('#preview-size').textContent()).includes('（自動）'), 'auto height preview not resolved');
  const shortHeight = await page.locator('#preview-host .letter-frame').evaluate(node => Number.parseFloat(node.style.height));
  assert(shortHeight >= 180 && shortHeight < 540);
  await page.locator('#show-letter').click(); await saved();
  await until(async () => (await stats()).height === shortHeight && (await stats()).visible, 'native source did not take the fitted height');
  assert.equal(await display.locator('.letter-frame').evaluate(node => Number.parseFloat(node.style.height)), shortHeight);
  const scrollingText = '最初の段落。\n\n' + '長いお便りをスクロールで読みます。改行と日本語の折り返しをそのまま残します。\n'.repeat(18) + '\n最後の行です。';
  await page.locator('#draft-text').fill(scrollingText); await saved();
  assert.equal((await stats()).height, shortHeight);
  await page.locator('#show-letter').click(); await saved();
  await until(async () => (await stats()).height === 540 && (await stats()).visible, 'long letter exceeded auto-height limit');
  pass('720p, 1080p and OBS canvas presets work; auto height fits short text and caps long letters without changing aired dimensions during prep');

  await page.locator('#readingMode').selectOption('scroll'); await saved();
  assert.equal((await get()).state.live.style.readingMode, 'pages');
  await page.locator('#show-letter').click(); await saved();
  await until(async () => (await get()).scrollMax > 0 && (await get()).renderedLiveRevision === (await get()).liveRevision, 'scroll layout not acknowledged');
  await until(async () => (await display.locator('.letter-text').textContent()) === scrollingText, 'scroll mode lost text');
  const scrollRevision = (await get()).liveRevision;
  await page.locator('#preview-scroll').focus(); await page.locator('#preview-scroll').press('End');
  assert.equal((await get()).state.live.scroll, 0);
  await page.locator('#live-next').click(); await saved();
  const firstScroll = (await get()).state.live.scroll; assert(firstScroll > 0 && firstScroll < 1);
  assert.equal((await get()).liveRevision, scrollRevision); assert.equal((await stats()).visible, true);
  await fs.writeFile(path.join(artifacts, 'hotkey.request'), 'next');
  await until(async () => (await get()).state.live.scroll > firstScroll, 'OBS hotkey did not scroll down');
  await until(async () => (await page.locator('#live-scroll').inputValue()) === String(Math.round((await get()).state.live.scroll * 1000)), 'panel did not catch hotkey scroll');
  await page.locator('#live-scroll').focus(); await page.locator('#live-scroll').press('End'); await saved();
  await until(async () => (await get()).state.live.scroll === 1, 'scroll did not reach the last line');
  await until(async () => await display.locator('.letter-frame').evaluate(node => {
    const body = node.querySelector('.letter-text').getBoundingClientRect(), viewport = node.querySelector('.letter-viewport').getBoundingClientRect();
    return Math.abs(body.bottom - viewport.bottom) < 1;
  }), 'last line was not aligned inside the viewport');
  assert.equal((await get()).liveRevision, scrollRevision);
  pass('scroll mode retains all text; preview is independent; buttons, slider and real OBS hotkeys reach the last line without blanking');

  for (const theme of Object.values(UI_THEMES)) {
    assert(contrast(theme.text, theme.panel) >= 4.5); assert(contrast(theme.text, theme.background) >= 4.5);
    assert(contrast(theme.accent, '#ffffff') >= 4.5);
  }
  const liveBeforeUI = structuredClone((await get()).state.live);
  await page.locator('#ui-theme-open').click();
  for (const preset of Object.keys(UI_THEMES)) {
    await page.locator(`[data-ui-theme="${preset}"]`).click(); await saved(); assert.equal((await get()).state.ui.preset, preset);
    const applied = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return Object.fromEntries(['ink', 'soft', 'muted', 'panel', 'line'].map(key => [key, root.getPropertyValue(`--${key}`).trim()]));
    });
    assert(contrast(applied.ink, applied.soft) >= 4.5); assert(contrast(applied.muted, applied.panel) >= 4.5);
    assert(contrast(applied.line, applied.panel) < 1.5, 'panel borders should remain subtle');
  }
  await page.locator('#ui-accent').fill('#8233b9'); await page.locator('#ui-accent').dispatchEvent('input'); await saved();
  assert.equal((await get()).state.ui.preset, 'custom'); assert.equal((await get()).state.ui.custom.accent, '#8233b9');
  assert.deepEqual((await get()).state.live, liveBeforeUI);
  await page.screenshot({path: path.join(artifacts, 'theme-custom.png'), fullPage: true});
  await page.locator('#ui-theme-dialog').getByText('閉じる', {exact: true}).click();
  const fullDownload = page.waitForEvent('download'); await page.locator('#export').click();
  const fullBackup = JSON.parse(await fs.readFile(await (await fullDownload).path(), 'utf8'));
  assert.deepEqual(fullBackup.ui, (await get()).state.ui); assert.equal(fullBackup.style.readingMode, 'scroll');
  const migrated = normalizeState({version: 1, items: [], style: {font: 'YuGothic', background: '#172437', backgroundOpacity: .94, textColor: '#ffffff'}});
  assert.equal(migrated.ui.preset, 'blue'); assert.equal(migrated.style.background, '#172437'); assert.equal(migrated.style.readingMode, 'pages');
  await page.locator('#ui-theme-open').click(); await page.locator('[data-ui-theme="blue"]').click(); await saved();
  await page.locator('#ui-theme-dialog').getByText('閉じる', {exact: true}).click(); await page.locator('#reset-style').click(); await saved();
  pass('current blue and four pastel themes have readable contrast; custom UI colours are separate, backed up and compatible with old data');

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
