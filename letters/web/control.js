// SPDX-License-Identifier: GPL-2.0-or-later
import * as Core from './core.js';
import {UI_THEMES, uiColours, applyUI} from './themes.js';
import {analysePaste, importKey, importProblem, MAX_IMPORT_CANDIDATES} from './imports.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), token = params.get('token') || '';
let sourceId = params.get('source') || '', state = null, revision = -1, metadata = {};
let persistedStateKey = '';
let generation = 0, savedGeneration = 0, writing = null, saveTimer, blocked = false;
let previewPage = 0, previewCount = 1, previewError = '', previewSerial = 0, liveCount = 1;
let previewController;
let filter = 'all', dragId = null, undoStack = [], toastTimer, liveLayoutKey = '', sourceRefreshAt = 0;
let environment = {}, availableFonts = [], fontOptionsKey = '', fontCustomMode = false;
let previewScroll = 0, previewMetrics = {scrollMax: 0, viewportHeight: 1}, previewStyle = null;
let liveMetrics = {scrollMax: 0, viewportHeight: 1};
let fontListHelp = 'PCのフォント一覧を取得しています。';
let deleteSession = null, deleteSelection = new Set(), deleteListKey = '';
let bulkSession = null, bulkDraft = {text: '', html: ''};

function updateFontHelp(family) {
  const status = Core.fontStatus(family);
  $('font-help').textContent = `${fontListHelp} ${status.pending ? '選んだ書体を読み込んでいます。' :
    status.loaded ? '選んだ書体でプレビューしています。' :
    'この書体は通常のPC内フォント表示を使います。Safariで異なる場合は、一覧から別の書体を選ぶかChrome/Edgeで確認してください。'}`;
}

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function connection(ok) {
  $('connection').textContent = ok ? 'OBSに接続中' : 'OBSとの接続を確認してください';
  $('connection').classList.toggle('offline', !ok);
}
async function request(path, payload) {
  const response = await fetch(path, {method: payload ? 'POST' : 'GET', cache: 'no-store',
    headers: {'X-OBS-Letters-Token': token, ...(payload ? {'Content-Type': 'application/json'} : {})},
    ...(payload ? {body: JSON.stringify(payload)} : {}), signal: Core.deadlineSignal(3000)});
  if (response.status === 409) return {conflict: true, ...(await response.json())};
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
function saveStatus() {
  $('save-status').textContent = blocked ? '入力をこの画面に保持しています' : generation > savedGeneration ? 'OBSに保存中…' : 'OBSに保存済み';
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { flush().catch(() => {}); }, 160); }
const stateKey = value => JSON.stringify(Core.normalizeState(value));
async function flush() {
  if (blocked) throw new Error('バックアップを書き出してから、操作画面を開き直してください。');
  if (writing) return writing;
  writing = (async () => {
    while (state && savedGeneration < generation) {
      const targetGeneration = generation, snapshot = Core.clone(state), targetSource = sourceId;
      let result = await request(`/api/state/${targetSource}`, {expectedRevision: revision, state: snapshot});
      // A source can be recreated while its panel stays open. Retry only when
      // OBS still holds exactly the state this panel last acknowledged.
      if (result.conflict && stateKey(result.state) === persistedStateKey) {
        revision = result.revision;
        result = await request(`/api/state/${targetSource}`, {expectedRevision: revision, state: snapshot});
      }
      if (result.conflict) {
        blocked = true;
        notice('別の操作画面から更新されました。入力はこの画面に残しています。バックアップを書き出してから、操作画面を開き直してください。');
        throw new Error('別の操作画面で更新されています。');
      }
      revision = result.revision; metadata = result; savedGeneration = targetGeneration;
      persistedStateKey = stateKey(result.state);
      connection(true); saveStatus(); updateLive();
    }
  })().catch(error => {
    connection(false); saveStatus();
    if (!blocked) notice(`保存できていません。入力はこの画面に残しています。${error.message || 'OBSとの接続を確認してください。'}`);
    throw error;
  }).finally(() => { writing = null; });
  return writing;
}
function mutate(operation, remember = false, prepare = true) {
  if (!state || blocked) return false;
  try {
    const previous = Core.clone(state), next = Core.clone(state);
    operation(next);
    state = Core.normalizeState(next);
    if (remember) { undoStack.push(previous); if (undoStack.length > 15) undoStack.shift(); }
    generation++; saveStatus(); if (prepare) render(); else updateLive(); scheduleSave(); return true;
  } catch (error) { toast(error.message); return false; }
}
function setInput(id, value) {
  const input = $(id); if (document.activeElement !== input) input.value = value;
  if (input.type === 'range') input.style.setProperty('--range-progress', `${(Number(value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
}
const fontLabels = {'Yu Gothic': '游ゴシック', YuGothic: '游ゴシック', 'Hiragino Kaku Gothic ProN': 'ヒラギノ角ゴ',
  'Hiragino Mincho ProN': 'ヒラギノ明朝', 'Noto Sans CJK JP': 'Noto Sans（日本語）', 'Noto Serif CJK JP': 'Noto Serif（日本語）'};
function renderFonts() {
  const search = $('font-search').value.toLocaleLowerCase('ja'), key = JSON.stringify([search, availableFonts, state.style.font, fontCustomMode]);
  if (key === fontOptionsKey) return;
  fontOptionsKey = key;
  const candidates = [...new Set([state.style.font, ...availableFonts])].filter(family => family === state.style.font ||
    `${family} ${fontLabels[family] || ''}`.toLocaleLowerCase('ja').includes(search));
  $('font').replaceChildren(...candidates.map(family => {
    const option = document.createElement('option'); option.value = family;
    option.textContent = fontLabels[family] ? `${fontLabels[family]} · ${family}` : family;
    return option;
  }));
  const custom = document.createElement('option'); custom.value = '__custom__'; custom.textContent = 'フォント名を入力…'; $('font').append(custom);
  $('font').value = fontCustomMode ? '__custom__' : state.style.font;
  $('font-custom').hidden = !fontCustomMode; setInput('font-custom', state.style.font);
}
function renderUI() {
  const ratio = applyUI(state.ui), colours = uiColours(state.ui);
  document.querySelectorAll('[data-ui-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.uiTheme === state.ui.preset)));
  for (const key of ['background', 'panel', 'accent', 'text']) setInput(`ui-${key}`, colours[key]);
  $('ui-contrast').textContent = ratio < 4.5 ? '文字と背景が近い色です。文字色を濃くすると読みやすくなります。' : 'この配色は文字を読みやすい濃さにしています。';
}
function renderInputs() {
  setInput('draft-title', state.draft.title); setInput('draft-text', state.draft.text);
  $('character-count').textContent = `${Array.from(state.draft.text).length.toLocaleString('ja-JP')}文字`;
  for (const key of ['fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor',
    'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background']) setInput(key, state.style[key]);
  for (const side of ['top', 'right', 'bottom', 'left']) setInput(`padding-${side}`, state.style.padding[side]);
  setInput('backgroundOpacity', Math.round(state.style.backgroundOpacity * 100));
  $('opacity-value').textContent = `${Math.round(state.style.backgroundOpacity * 100)}%`;
  $('backgroundOpacity').style.setProperty('--range-progress', `${state.style.backgroundOpacity * 100}%`);
  setInput('readingMode', state.style.readingMode); renderFonts();
  $('auto-height').setAttribute('aria-pressed', String(state.style.autoHeight));
  $('height-label').textContent = state.style.autoHeight ? '最大の高さ' : '枠の高さ';
  $('showTitle').checked = state.style.showTitle; $('showPageNumber').checked = state.style.showPageNumber;
  $('save-draft').disabled = !state.draft.text.trim();
  $('undo').disabled = !undoStack.length;
}
function renderQueue() {
  const search = $('search').value.toLocaleLowerCase();
  const items = state.items.filter(item => (filter === 'all' || (filter === 'done') === item.done) &&
    `${item.title}\n${item.text}`.toLocaleLowerCase().includes(search));
  $('queue-count').textContent = state.items.length;
  $('queue-empty').hidden = !!items.length;
  $('queue-empty').textContent = state.items.length ? 'この条件に合うお便りはありません。' : 'マシュマロの本文を貼り付けて、最初のお便りを準備しましょう。';
  const nodes = items.map(item => {
    const li = document.createElement('li'); li.className = 'queue-item'; li.dataset.id = item.id;
    li.classList.toggle('selected', item.id === state.selectedId);
    const handle = document.createElement('button'); handle.className = 'drag-handle'; handle.textContent = '⠿';
    handle.draggable = true; handle.setAttribute('aria-label', `${Core.label(item)}を並べ替える`);
    handle.addEventListener('dragstart', event => { dragId = item.id; event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; });
    handle.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target')); });
    li.addEventListener('dragover', event => { if (dragId) { event.preventDefault(); li.classList.add('drop-target'); } });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', event => {
      event.preventDefault();
      if (dragId && dragId !== item.id) { const moved = dragId; mutate(s => Core.moveItem(s, moved, s.items.findIndex(entry => entry.id === item.id)), true); }
      dragId = null;
    });
    const button = document.createElement('button'); button.className = 'queue-select';
    button.setAttribute('aria-pressed', String(item.id === state.selectedId));
    button.setAttribute('aria-label', `${state.items.indexOf(item) + 1}. ${Core.label(item)}${item.done ? '（紹介済み）' : ''}`);
    const heading = document.createElement('span'); heading.className = 'item-heading';
    const index = document.createElement('span'); index.className = 'item-index'; index.textContent = String(state.items.indexOf(item) + 1).padStart(2, '0');
    const title = document.createElement('strong'); title.textContent = Core.label(item); heading.append(index, title);
    if (item.done) { const badge = document.createElement('span'); badge.className = 'item-done'; badge.textContent = '✓ 済'; heading.append(badge); }
    const snippet = document.createElement('span'); snippet.className = 'item-snippet'; snippet.textContent = item.text;
    button.append(heading, snippet); button.addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(s => Core.selectItem(s, item.id)); });
    li.append(handle, button); return li;
  });
  $('queue-list').replaceChildren(...nodes);
  const index = state.items.findIndex(item => item.id === state.selectedId);
  $('move-up').disabled = index <= 0; $('move-down').disabled = index < 0 || index >= state.items.length - 1;
  $('delete-letter').disabled = index < 0; $('toggle-done').disabled = index < 0;
  $('delete-bulk-open').disabled = !state.items.length;
  $('toggle-done').textContent = index >= 0 && state.items[index].done ? '未紹介に戻す' : '紹介済み';
  renderDeleteDialog();
  updateBulkSelection();
}
function scalePreview() {
  if (!state) return;
  const box = $('preview-viewport');
  const dimensions = previewStyle || state.style;
  const scale = Math.min((box.clientWidth - 24) / dimensions.width, (box.clientHeight - 20) / dimensions.height, 1);
  $('preview-host').style.transform = `scale(${Math.max(.05, scale)})`;
}
async function updatePreview() {
  if (!state) return;
  const serial = ++previewSerial, draft = Core.clone(state.draft), style = Core.clone(state.style);
  previewController?.abort(); previewController = new AbortController();
  $('preview-size').textContent = `${style.width} × ${style.height}`;
  $('preview-empty').hidden = !!draft.text.trim();
  if (!draft.text.trim()) {
    $('preview-host').replaceChildren(); previewCount = 1; previewError = '';
    previewStyle = null; previewMetrics = {scrollMax: 0, viewportHeight: 1}; $('preview-scroll').hidden = true;
    $('preview-page').textContent = '—'; $('preview-prev').disabled = true; $('preview-next').disabled = true;
    $('show-letter').disabled = true;
    $('preview-info').textContent = '長文は読みやすい文字サイズのままページに分けます。'; $('preview-info').classList.remove('error');
    return;
  }
  try {
    updateFontHelp(style.font);
    const scratch = document.createElement('div');
    const result = await Core.renderLetter(scratch, {...draft, scroll: previewScroll}, style, previewPage, {signal: previewController.signal});
    if (serial !== previewSerial) return;
    updateFontHelp(style.font);
    $('preview-host').replaceChildren(result.frame); previewCount = result.pages.length; previewPage = result.page;
    previewError = '';
    previewMetrics = result; previewStyle = result.style; scalePreview();
    $('preview-size').textContent = `${result.style.width} × ${result.style.height}${style.autoHeight ? '（自動）' : ''}`;
    const scrolling = style.readingMode === 'scroll'; $('preview-scroll').hidden = !scrolling;
    $('preview-prev').textContent = scrolling ? '↑ 上へ' : '← 前'; $('preview-next').textContent = scrolling ? '下へ ↓' : '次 →';
    $('preview-prev').setAttribute('aria-label', scrolling ? '準備中の文章を上へ' : '準備中の前のページ');
    $('preview-next').setAttribute('aria-label', scrolling ? '準備中の文章を下へ' : '準備中の次のページ');
    $('preview-page').textContent = scrolling ? `${Math.round(previewScroll * 100)}%` : `${previewPage + 1} / ${previewCount}`;
    setInput('preview-scroll', Math.round(previewScroll * 1000));
    $('preview-info').textContent = scrolling ? (result.scrollMax > 0 ? '全文を上下にスクロールできます。' : '全文がこの枠に収まります。') :
      previewCount > 1 ? `全${previewCount}ページ。ここでは表示前の内容を確認できます。` : 'この内容は1ページに収まります。';
    $('preview-info').classList.remove('error'); $('show-letter').disabled = false;
  } catch (error) {
    if (serial !== previewSerial) return;
    previewError = error.message; $('preview-host').replaceChildren();
    $('preview-info').textContent = previewError; $('preview-info').classList.add('error');
    $('show-letter').disabled = true; previewCount = 1; $('preview-page').textContent = '—';
  }
  updatePreviewNavigation();
}
function updatePreviewNavigation() {
  const scrolling = state.style.readingMode === 'scroll';
  $('preview-prev').disabled = previewError || (scrolling ? previewScroll <= 0 || previewMetrics.scrollMax <= 0 : previewPage <= 0);
  $('preview-next').disabled = previewError || (scrolling ? previewScroll >= 1 || previewMetrics.scrollMax <= 0 : previewPage >= previewCount - 1);
  $('preview-scroll').disabled = previewError || previewMetrics.scrollMax <= 0;
  if (scrolling) {
    $('preview-page').textContent = `${Math.round(previewScroll * 100)}%`; setInput('preview-scroll', Math.round(previewScroll * 1000));
  }
}
function movePreviewScroll(position) {
  previewScroll = Math.max(0, Math.min(1, position));
  const frame = $('preview-host').querySelector('.letter-frame');
  if (frame) Core.setScroll(frame, previewScroll);
  updatePreviewNavigation();
}
function updateLive() {
  if (!state) return;
  const live = state.live, onAir = live.visible;
  $('live-panel').classList.toggle('on-air', onAir);
  $('live-status').textContent = onAir ? '表示中' : '非表示'; $('live-status').classList.toggle('on-air', onAir);
  $('live-title').textContent = onAir ? Core.label(live) : '配信には表示していません';
  $('live-excerpt').textContent = onAir ? Array.from(live.text).slice(0, 220).join('') : '';
  $('live-excerpt').hidden = !onAir;
  const ready = metadata.renderedLiveRevision === metadata.liveRevision;
  if (ready && metadata.pageCount) liveCount = metadata.pageCount;
  if (ready) liveMetrics = {scrollMax: metadata.scrollMax || 0, viewportHeight: metadata.viewportHeight || 1};
  const scrolling = live.style?.readingMode === 'scroll';
  $('live-detail').textContent = onAir ? (ready ? '表示前のプレビューとは、読む位置を別々に操作できます。' : '表示を更新しています…') : '下の「このお便りを配信に表示」から始められます。';
  setInput('live-reading-mode', scrolling ? 'scroll' : 'pages'); $('live-reading-mode').disabled = !onAir;
  $('live-page').textContent = onAir ? (scrolling ? `${Math.round(live.scroll * 100)}%` : `${Math.min(live.page + 1, liveCount)} / ${liveCount}`) : '—';
  $('live-prev').textContent = scrolling ? '↑ 上へスクロール' : '← 前のページ'; $('live-next').textContent = scrolling ? '下へスクロール ↓' : '次のページ →';
  $('live-prev').setAttribute('aria-label', scrolling ? '表示中の文章を上へ' : '配信中の前のページ');
  $('live-next').setAttribute('aria-label', scrolling ? '表示中の文章を下へ' : '配信中の次のページ');
  $('live-prev').disabled = !onAir || (scrolling ? live.scroll <= 0 || liveMetrics.scrollMax <= 0 : live.page <= 0);
  $('live-next').disabled = !onAir || (scrolling ? live.scroll >= 1 || liveMetrics.scrollMax <= 0 : live.page >= liveCount - 1);
  $('live-scroll-row').hidden = !onAir || !scrolling; $('live-scroll').disabled = !onAir || liveMetrics.scrollMax <= 0;
  setInput('live-scroll', Math.round(live.scroll * 1000));
  $('hide-live').disabled = !onAir; $('hide-editor').disabled = !onAir; $('finish-live').disabled = !onAir;
  const key = JSON.stringify([live.text, live.style]);
  if (onAir && key !== liveLayoutKey) {
    liveLayoutKey = key;
    Core.renderLetter(document.createElement('div'), live, live.style || state.style, live.page, {prepared: true}).then(result => {
      if (key !== liveLayoutKey) return;
      if (metadata.renderedLiveRevision !== metadata.liveRevision) { liveCount = result.pages.length; liveMetrics = result; }
      updateLive();
    }).catch(() => {});
  }
}
function render() { if (state) { renderUI(); renderInputs(); renderQueue(); updateLive(); updatePreview(); } }

async function loadSource(id) {
  if ($('delete-dialog').open) $('delete-dialog').close();
  if ($('bulk-dialog').open) $('bulk-dialog').close();
  if (state && generation > savedGeneration) await flush();
  const result = await request(`/api/state/${id}`);
  sourceId = id; state = Core.normalizeState(result.state); revision = result.revision; metadata = result;
  persistedStateKey = stateKey(result.state);
  generation = savedGeneration = 0; blocked = false; undoStack = []; previewPage = 0; liveLayoutKey = '';
  previewScroll = 0; fontCustomMode = false; fontOptionsKey = ''; previewStyle = null;
  const url = new URL(location.href); url.searchParams.set('source', id); history.replaceState(null, '', url);
  $('source-picker').value = id; $('app').hidden = false; $('empty-setup').hidden = true;
  connection(true); notice(result.error || ''); saveStatus(); render();
}
async function refreshSources() {
  const result = await request('/api/sources'), sources = result.sources.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const old = $('source-picker').value;
  $('source-picker').replaceChildren(...sources.map(source => { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; return option; }));
  if (!sources.length) { if ($('delete-dialog').open) $('delete-dialog').close(); state = null; sourceId = ''; $('app').hidden = true; $('empty-setup').hidden = false; return; }
  const id = sources.some(source => source.id === sourceId) ? sourceId : sources.some(source => source.id === old) ? old : sources[0].id;
  $('source-picker').value = id;
  if (!state || id !== sourceId) await loadSource(id);
}
async function poll() {
  try {
    if (!token) throw new Error('この操作画面は、OBSのソースのプロパティから開いてください。');
    if (!state) await refreshSources();
    else if (!writing && generation === savedGeneration && !blocked) {
      if (Date.now() > sourceRefreshAt) { await refreshSources(); sourceRefreshAt = Date.now() + 3000; }
      if (!state) return;
      const target = sourceId, result = await request(`/api/state/${sourceId}`);
      if (target !== sourceId || writing || generation !== savedGeneration) return;
      metadata = result;
      if (revision !== result.revision) { state = Core.normalizeState(result.state); revision = result.revision; render(); }
      else updateLive();
      persistedStateKey = stateKey(result.state);
      connection(true); if (!result.error) notice('');
    } else if (!writing && !blocked) await flush();
  } catch (error) { connection(false); if (!blocked) notice(error.message || 'OBSを起動して、このスクリプトが有効になっているか確認してください。'); }
  finally { setTimeout(poll, 500); }
}

$('source-picker').addEventListener('change', () => { loadSource($('source-picker').value).catch(error => { $('source-picker').value = sourceId; toast(error.message); }); });
$('search').addEventListener('input', () => state && renderQueue());
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  if (state) renderQueue();
}));
$('new-letter').addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(Core.newDraft); $('draft-text').focus(); });
for (const [id, key] of [['draft-title', 'title'], ['draft-text', 'text']]) $(id).addEventListener('input', () => {
  const value = $(id).value; previewPage = 0; previewScroll = 0; mutate(s => { s.draft[key] = value; });
});
$('save-draft').addEventListener('click', () => { if (mutate(Core.saveDraft, true)) toast('一覧に保存しました。配信への表示は変わりません。'); });
async function show() {
  if (!state || !state.draft.text.trim()) return;
  try {
    const expected = generation;
    const prepared = await Core.renderLetter(document.createElement('div'), state.draft, state.style);
    if (expected !== generation) return show();
    if (!mutate(s => Core.showDraft(s, prepared.style))) return;
    await flush(); toast('このお便りを配信に表示します。');
  } catch (error) { toast(error.message || previewError); }
}
$('show-letter').addEventListener('click', show);
function changeLivePage(delta) {
  mutate(s => {
    if (s.live.style?.readingMode === 'scroll') {
      const step = liveMetrics.scrollMax > 0 ? 0.85 * liveMetrics.viewportHeight / liveMetrics.scrollMax : 0;
      s.live.scroll = Math.max(0, Math.min(1, s.live.scroll + delta * step));
    } else s.live.page = Math.max(0, Math.min(liveCount - 1, s.live.page + delta));
  }, false, false);
  flush().catch(() => {});
}
$('live-prev').addEventListener('click', () => changeLivePage(-1)); $('live-next').addEventListener('click', () => changeLivePage(1));
$('live-reading-mode').addEventListener('change', () => {
  if (!state?.live.visible) return;
  const mode = $('live-reading-mode').value;
  if (mode === state.live.style?.readingMode) return;
  liveLayoutKey = ''; liveCount = 1; liveMetrics = {scrollMax: 0, viewportHeight: 1};
  if (!mutate(s => { s.live.style = {...Core.clone(s.live.style || s.style), readingMode: mode}; s.live.page = 0; s.live.scroll = 0; }, false, false)) return;
  flush().catch(() => {});
  toast(`${mode === 'scroll' ? 'スクロール' : 'ページ送り'}に切り替え、配信中のお便りを先頭から表示します。`);
});
for (const [id, delta] of [['preview-prev', -1], ['preview-next', 1]]) $(id).addEventListener('click', () => {
  if (state.style.readingMode === 'scroll') movePreviewScroll(previewScroll + delta * (previewMetrics.scrollMax > 0 ? .85 * previewMetrics.viewportHeight / previewMetrics.scrollMax : 0));
  else { previewPage = Math.max(0, Math.min(previewCount - 1, previewPage + delta)); updatePreview(); }
});
$('preview-scroll').addEventListener('input', () => movePreviewScroll(Number($('preview-scroll').value) / 1000));
$('preview-viewport').addEventListener('wheel', event => {
  if (!state || state.style.readingMode !== 'scroll' || previewMetrics.scrollMax <= 0) return;
  event.preventDefault(); movePreviewScroll(previewScroll + event.deltaY / previewMetrics.scrollMax);
}, {passive: false});
$('live-scroll').addEventListener('input', () => { const position = Number($('live-scroll').value) / 1000; mutate(s => { s.live.scroll = position; }, false, false); });
for (const id of ['hide-live', 'hide-editor']) $(id).addEventListener('click', () => {
  mutate(s => { s.live.visible = false; }, false, false); flush().catch(() => {});
});
$('finish-live').addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(Core.finishLive, true); flush().catch(() => {}); });
for (const [id, delta] of [['move-up', -1], ['move-down', 1]]) $(id).addEventListener('click', () => {
  mutate(s => Core.moveItem(s, s.selectedId, s.items.findIndex(item => item.id === s.selectedId) + delta), true);
});
$('toggle-done').addEventListener('click', () => mutate(s => { const item = s.items.find(item => item.id === s.selectedId); if (item) item.done = !item.done; }, true));
$('delete-letter').addEventListener('click', () => { mutate(s => Core.removeItem(s, s.selectedId), true); toast('一覧から削除しました。「一覧の操作を戻す」で復元できます。'); });
function deleteCandidates() {
  if (!deleteSession || deleteSession.sourceId !== sourceId || !state) return [];
  const present = new Set(state.items.map(item => item.id));
  return deleteSession.items.filter(item => present.has(item.id) && ($('delete-scope').value !== 'done' || item.done));
}
function deleteTargetIds() {
  return deleteCandidates().filter(item => $('delete-scope').value !== 'selected' || deleteSelection.has(item.id)).map(item => item.id);
}
function updateDeleteSelection() {
  const targets = new Set(deleteTargetIds());
  $('delete-count').textContent = `${targets.size}件を選択`;
  $('delete-confirm').textContent = `${targets.size}件を削除`;
  $('delete-confirm').disabled = !targets.size || blocked;
  $('delete-draft-note').hidden = !targets.has(state?.draft.id);
  for (const checkbox of $('delete-list').querySelectorAll('input')) checkbox.checked = targets.has(checkbox.value);
}
function renderDeleteDialog() {
  if (!deleteSession || !$('delete-dialog').open) return;
  const items = deleteCandidates(), selecting = $('delete-scope').value === 'selected';
  $('delete-selection-tools').hidden = !selecting;
  $('delete-empty').hidden = !!items.length; $('delete-list').hidden = !items.length;
  const key = JSON.stringify([$('delete-scope').value, items.map(item => item.id)]);
  if (key !== deleteListKey) {
    deleteListKey = key;
    $('delete-list').replaceChildren(...items.map(item => {
      const li = document.createElement('li'), label = document.createElement('label'); label.className = 'delete-item';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id; checkbox.disabled = !selecting;
      checkbox.setAttribute('aria-label', `${Core.label(item)}を削除対象にする`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) deleteSelection.add(item.id); else deleteSelection.delete(item.id);
        updateDeleteSelection();
      });
      const text = document.createElement('span'), title = document.createElement('strong'), snippet = document.createElement('span');
      title.textContent = Core.label(item); snippet.className = 'delete-snippet'; snippet.textContent = item.text;
      text.append(title, snippet); label.append(checkbox, text);
      if (item.done) { const done = document.createElement('span'); done.className = 'delete-done'; done.textContent = '紹介済み'; label.append(done); }
      li.append(label); return li;
    }));
  }
  updateDeleteSelection();
}
$('delete-bulk-open').addEventListener('click', () => {
  if (!state?.items.length || blocked) return;
  // Freeze reviewed candidates so later arrivals are never silently included.
  deleteSession = {sourceId, items: state.items.map(item => item.id === state.draft.id ? {...Core.clone(item), title: state.draft.title, text: state.draft.text} : Core.clone(item))};
  deleteSelection.clear(); deleteListKey = ''; $('delete-scope').value = 'selected';
  $('delete-dialog').showModal(); renderDeleteDialog(); $('delete-scope').focus();
});
$('delete-dialog').addEventListener('close', () => { deleteSession = null; deleteSelection.clear(); deleteListKey = ''; });
$('delete-scope').addEventListener('change', renderDeleteDialog);
$('delete-select-all').addEventListener('click', () => { deleteSelection = new Set(deleteCandidates().map(item => item.id)); updateDeleteSelection(); });
$('delete-clear').addEventListener('click', () => { deleteSelection.clear(); updateDeleteSelection(); });
$('delete-confirm').addEventListener('click', () => {
  if (!$('delete-dialog').open || blocked) return;
  const ids = deleteTargetIds(); if (!ids.length) return;
  if (ids.includes(state.draft.id)) { previewPage = 0; previewScroll = 0; }
  if (!mutate(s => Core.removeItems(s, ids), true)) return;
  $('delete-dialog').close(); flush().catch(() => {});
  toast(`${ids.length}件を削除しました。「一覧の操作を戻す」でまとめて戻せます。`);
});
$('undo').addEventListener('click', () => { const previous = undoStack.pop(); if (previous) mutate(s => {
  const {live, style, ui} = s; Object.assign(s, Core.clone(previous), {live, style, ui});
}); });
$('font-search').addEventListener('input', () => state && renderFonts());
$('font').addEventListener('change', () => {
  const family = $('font').value; fontCustomMode = family === '__custom__';
  if (fontCustomMode) { fontOptionsKey = ''; renderFonts(); $('font-custom').focus(); $('font-custom').select(); return; }
  previewPage = 0; previewScroll = 0; mutate(s => { s.style.font = family; });
});
$('font-custom').addEventListener('input', () => {
  const family = $('font-custom').value; previewPage = 0; previewScroll = 0;
  if (family.trim()) mutate(s => { s.style.font = family; });
});
for (const key of ['fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor', 'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background', 'readingMode']) {
  $(key).addEventListener('change', () => {
    const value = ['align', 'verticalAlign', 'textColor', 'outlineColor', 'background', 'readingMode'].includes(key) ? $(key).value : Number($(key).value);
    previewPage = 0; previewScroll = 0; mutate(s => { s.style[key] = value; });
  });
}
for (const side of ['top', 'right', 'bottom', 'left']) $(`padding-${side}`).addEventListener('change', () => {
  const value = Number($(`padding-${side}`).value); previewPage = 0; mutate(s => { s.style.padding[side] = value; });
});
$('backgroundOpacity').addEventListener('input', () => { const value = Number($('backgroundOpacity').value) / 100; mutate(s => { s.style.backgroundOpacity = value; }); });
for (const key of ['showTitle', 'showPageNumber']) $(key).addEventListener('change', () => { const checked = $(key).checked; previewPage = 0; mutate(s => { s.style[key] = checked; }); });
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => mutate(s => Core.applyDisplayPreset(s.style, button.dataset.theme))));
$('reset-style').addEventListener('click', () => {
  previewPage = 0; previewScroll = 0; fontCustomMode = false; fontOptionsKey = '';
  mutate(s => { s.style = Core.normalizeStyle({...Core.DEFAULT_STYLE, font: environment.defaultFont || Core.DEFAULT_STYLE.font}); });
  toast('表示設定を初期値に戻しました。配信中のお便りと操作画面の配色は保っています。');
});
document.querySelectorAll('[data-frame]').forEach(button => button.addEventListener('click', () => {
  const [width, height] = button.dataset.frame.split(',').map(Number);
  previewPage = 0; previewScroll = 0; mutate(s => Object.assign(s.style, {width, height}));
}));
$('obs-frame').addEventListener('click', () => {
  if (environment.canvasWidth > 3840 || environment.canvasHeight > 2160) { toast('この版の枠は3840×2160pxまでです。幅と高さを入力してください。'); return; }
  previewPage = 0; previewScroll = 0; mutate(s => Object.assign(s.style, {width: environment.canvasWidth, height: environment.canvasHeight}));
});
$('auto-height').addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(s => { s.style.autoHeight = !s.style.autoHeight; }); });

for (const [key, theme] of Object.entries(UI_THEMES)) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.uiTheme = key;
  const swatch = document.createElement('span'); swatch.className = 'theme-swatch';
  swatch.style.background = `linear-gradient(135deg, ${theme.background} 0% 65%, ${theme.accent} 65%)`;
  button.append(swatch, document.createTextNode(theme.name));
  button.addEventListener('click', () => mutate(s => { s.ui.preset = key; })); $('ui-theme-presets').append(button);
}
$('ui-theme-open').addEventListener('click', () => state && $('ui-theme-dialog').showModal());
for (const key of ['background', 'panel', 'accent', 'text']) $(`ui-${key}`).addEventListener('input', () => {
  const value = $(`ui-${key}`).value;
  mutate(s => { s.ui.custom = {...uiColours(s.ui), [key]: value}; s.ui.preset = 'custom'; });
});

function bulkError(message = '') { $('bulk-error').textContent = message; $('bulk-error').hidden = !message; }
function existingImportKeys() {
  const keys = new Set(state.items.map(item => importKey(item.id === state.draft.id ? state.draft.text : item.text)));
  if (state.draft.text.trim()) keys.add(importKey(state.draft.text));
  return keys;
}
function updateBulkSelection() {
  const session = bulkSession;
  if (!session?.candidates || !$('bulk-dialog').open) return;
  if (session.committed) {
    $('bulk-add').disabled = session.saving || blocked;
    $('bulk-add').textContent = session.saving ? 'OBSに保存中…' : '保存を再試行';
    return;
  }
  const seen = existingImportKeys();
  for (const candidate of session.candidates) {
    const key = importKey(candidate.text), problem = importProblem(candidate.text);
    candidate.duplicate = seen.has(key); seen.add(key);
    if (problem || (candidate.duplicate && !candidate.userSelected)) candidate.selected = false;
    candidate.checkbox.checked = candidate.selected;
    candidate.checkbox.disabled = !!problem;
    candidate.node.classList.toggle('selected', candidate.selected);
    candidate.status.textContent = `${Array.from(candidate.text).length.toLocaleString('ja-JP')}文字${problem ? ` · ${problem}` : candidate.duplicate ? ' · 同じ本文があります' : ''}`;
    candidate.status.classList.toggle('error', !!problem);
  }
  const selected = session.candidates.filter(candidate => candidate.selected).length;
  const room = Math.max(0, 300 - state.items.length - (!state.draft.id && state.draft.text.trim() ? 1 : 0));
  $('bulk-count').textContent = `${selected} / ${session.candidates.length}件を選択 · あと${room}件登録できます`;
  $('bulk-add').textContent = `${selected}件を一覧に登録`;
  $('bulk-add').disabled = !selected || selected > room || blocked || session.sourceId !== sourceId;
  if (selected > room) bulkError(`一覧は300件までです。選択するお便りを${room}件以内にしてください。`);
  else if ($('bulk-error').textContent.startsWith('一覧は300件までです。')) bulkError();
}
function bulkPhase(review) {
  $('bulk-input').hidden = review; $('bulk-review').hidden = !review;
  $('bulk-input-step').toggleAttribute('aria-current', !review);
  $('bulk-review-step').toggleAttribute('aria-current', review);
  (review ? $('bulk-review-step') : $('bulk-input-step')).setAttribute('aria-current', 'step');
}
function bulkModeHelp() {
  const inbox = $('bulk-mode').value === 'inbox';
  $('bulk-help').hidden = !inbox;
  $('bulk-text').placeholder = inbox ? '受信箱からコピーした内容を、ここに貼り付けてください。' : '1件目のお便り\n---\n2件目のお便り\n\n本文内の空行は段落として残ります。';
}
function renderBulkCandidates() {
  const session = bulkSession;
  $('bulk-candidates').replaceChildren(...session.candidates.map((candidate, index) => {
    const node = document.createElement('li'); node.className = 'bulk-candidate'; candidate.node = node;
    const heading = document.createElement('div'); heading.className = 'bulk-candidate-heading';
    const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    candidate.checkbox = checkbox; label.append(checkbox, document.createTextNode(`お便り ${index + 1}`));
    checkbox.addEventListener('change', () => { candidate.selected = checkbox.checked; candidate.userSelected = true; updateBulkSelection(); });
    const status = document.createElement('span'); status.className = 'bulk-candidate-status'; candidate.status = status;
    heading.append(label, status);
    const editor = document.createElement('textarea'); editor.value = candidate.text; editor.setAttribute('aria-label', `お便り${index + 1}の本文`);
    editor.addEventListener('input', () => { candidate.text = editor.value; updateBulkSelection(); updateSplit(); });
    const split = document.createElement('button'); split.type = 'button'; split.className = 'bulk-split small'; split.textContent = 'カーソル位置で分ける';
    split.title = '分けたい位置を本文内でクリックしてから押してください。';
    function updateSplit() { split.disabled = editor.selectionStart <= 0 || editor.selectionStart >= editor.value.length || session.committed; }
    for (const event of ['click', 'keyup', 'select']) editor.addEventListener(event, updateSplit);
    split.addEventListener('click', () => {
      const position = editor.selectionStart;
      if (session.committed || position <= 0 || position >= candidate.text.length) return;
      if (session.candidates.length >= MAX_IMPORT_CANDIDATES) { bulkError('一度に確認できるのは500件までです。コピーする範囲を分けてください。'); return; }
      const parts = [candidate.text.slice(0, position), candidate.text.slice(position)];
      if (parts.some(part => !part.trim())) { bulkError('本文がある位置で分けてください。'); return; }
      session.candidates.splice(index, 1, ...parts.map(text => ({text, selected: candidate.selected, userSelected: candidate.userSelected})));
      renderBulkCandidates(); session.candidates[index + 1].node.querySelector('textarea').focus();
    });
    node.append(heading, editor, split); updateSplit(); return node;
  }));
  updateBulkSelection();
}
function openBulk(mode) {
  if (!state || blocked) { toast('OBSとの接続を確認してから開いてください。'); return; }
  bulkSession = {sourceId, html: bulkDraft.html, candidates: null, committed: false, saving: false};
  $('bulk-source').textContent = $('source-picker').selectedOptions[0]?.textContent || '選択中のソース';
  $('bulk-mode').value = mode; $('bulk-text').value = bulkDraft.text;
  $('bulk-back').disabled = false; $('bulk-select-new').disabled = false; $('bulk-clear').disabled = false;
  $('bulk-candidates').replaceChildren(); bulkPhase(false); bulkModeHelp(); bulkError();
  $('bulk-dialog').showModal(); $('bulk-text').focus();
}
$('inbox-open').addEventListener('click', () => openBulk('inbox'));
$('bulk-open').addEventListener('click', () => openBulk('separated'));
$('bulk-dialog').addEventListener('close', () => {
  bulkDraft = {text: $('bulk-text').value, html: bulkSession?.html || ''}; bulkSession = null;
});
$('bulk-text').addEventListener('input', () => { if (bulkSession) { bulkSession.html = ''; bulkSession.candidates = null; } bulkError(); });
$('bulk-mode').addEventListener('change', () => { if (bulkSession) bulkSession.candidates = null; bulkModeHelp(); bulkError(); });
$('bulk-text').addEventListener('paste', event => {
  if (!bulkSession || !event.clipboardData) return;
  const input = $('bulk-text'), fullPaste = !input.value || (input.selectionStart === 0 && input.selectionEnd === input.value.length);
  bulkSession.html = ''; bulkSession.candidates = null; bulkError();
  if ($('bulk-mode').value === 'inbox' && fullPaste) {
    event.preventDefault();
    input.value = event.clipboardData.getData('text/plain'); bulkSession.html = event.clipboardData.getData('text/html');
  }
});
$('bulk-analyse').addEventListener('click', () => {
  if (!bulkSession || blocked) return;
  try {
    if (!bulkSession.candidates) {
      const result = analysePaste({text: $('bulk-text').value, html: bulkSession.html, mode: $('bulk-mode').value});
      const seen = existingImportKeys();
      bulkSession.candidates = result.texts.map(text => {
        const key = importKey(text), selected = result.select && !seen.has(key) && !importProblem(text); seen.add(key);
        return {text, selected, userSelected: false};
      });
      $('bulk-method').textContent = result.note;
    }
    bulkError(); bulkPhase(true); renderBulkCandidates(); $('bulk-candidates').querySelector('textarea')?.focus();
  } catch (error) { bulkError(error.message); }
});
$('bulk-back').addEventListener('click', () => { if (!bulkSession?.committed) { bulkPhase(false); bulkError(); $('bulk-text').focus(); } });
$('bulk-select-new').addEventListener('click', () => {
  if (!bulkSession?.candidates || bulkSession.committed) return;
  updateBulkSelection(); for (const candidate of bulkSession.candidates) { candidate.selected = !candidate.duplicate && !importProblem(candidate.text); candidate.userSelected = false; }
  updateBulkSelection();
});
$('bulk-clear').addEventListener('click', () => {
  if (!bulkSession?.candidates || bulkSession.committed) return;
  for (const candidate of bulkSession.candidates) { candidate.selected = false; candidate.userSelected = true; } updateBulkSelection();
});

function appendItems(items, quiet = false) {
  if (!items.length) throw new Error('追加するお便りが見つかりませんでした。');
  if (items.some(item => item.text.length > 12000)) throw new Error('1件のお便りは12,000文字以内にしてください。');
  if (state.items.length + items.length > 300) throw new Error('お便りは300件まで登録できます。');
  previewPage = 0; previewScroll = 0;
  if (!mutate(s => { Core.saveDraft(s); s.items.push(...items); Core.selectItem(s, items[0].id); }, true)) {
    throw new Error('追加できませんでした。お便りの数と本文を確認してください。');
  }
  if (!quiet) toast(`${items.length}件のお便りを追加しました。配信への表示は変わりません。`);
}
$('bulk-add').addEventListener('click', async () => {
  const session = bulkSession;
  if (!session?.candidates || session.saving || session.sourceId !== sourceId || blocked) return;
  try {
    if (!session.committed) {
      updateBulkSelection(); if ($('bulk-add').disabled) return;
      const items = session.candidates.filter(candidate => candidate.selected).map(candidate => ({id: Core.uid(), title: '', text: candidate.text, done: false}));
      session.committed = true;
      try { appendItems(items, true); } catch (error) { session.committed = false; throw error; }
      session.addedCount = items.length;
      for (const candidate of session.candidates) for (const input of candidate.node.querySelectorAll('input, textarea, button')) input.disabled = true;
      $('bulk-back').disabled = true; $('bulk-select-new').disabled = true; $('bulk-clear').disabled = true;
    }
    session.saving = true; bulkError(); updateBulkSelection(); await flush();
    if (bulkSession === session) { $('bulk-text').value = ''; session.html = ''; $('bulk-dialog').close(); }
    toast(`${session.addedCount}件のお便りをOBSに保存しました。「一覧の操作を戻す」でまとめて戻せます。`);
  } catch (error) {
    if (bulkSession === session) { bulkError(session.committed ? `追加した内容はこの画面に残っています。${error.message} 保存を再試行できます。` : error.message); }
  } finally { session.saving = false; if (bulkSession === session) updateBulkSelection(); }
});
$('import-open').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try { if (file.size > 1000000) throw new Error('1MB以内のファイルを選んでください。'); const content = await file.text(); appendItems(file.name.toLowerCase().endsWith('.json') ? Core.importJson(content) : Core.importText(content)); }
  catch (error) { toast(error.message); } finally { $('import-file').value = ''; }
});
$('export').addEventListener('click', () => {
  if (!state) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'}), url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `お便りバックアップ-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('お便り・表示設定・画面の配色のバックアップを書き出しました。');
});
$('restore-open').addEventListener('click', () => $('restore-file').click());
$('restore-file').addEventListener('change', async () => {
  const file = $('restore-file').files[0]; if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('1MB以内のファイルを選んでください。');
    const parsed = JSON.parse(await file.text()); if (parsed.version !== 1) throw new Error('お便りテキストのバックアップを選んでください。');
    const restored = Core.normalizeState(parsed);
    if (!confirm('お便りの一覧と表示設定をバックアップで置き換え、配信への表示を非表示にします。続けますか？')) return;
    restored.live.visible = false;
    mutate(s => Object.assign(s, restored), true); previewPage = 0; await flush(); toast('バックアップを復元しました。表示前にプレビューを確認してください。');
  } catch (error) { toast(error.message); } finally { $('restore-file').value = ''; }
});
document.addEventListener('keydown', event => {
  if ($('bulk-dialog').open || $('ui-theme-dialog').open || $('delete-dialog').open || !state) return;
  if (event.altKey && event.key === 'Enter') { event.preventDefault(); show(); }
  else if (event.key === 'Escape' && state.live.visible) { event.preventDefault(); $('hide-live').click(); }
  else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && state.live.visible) { event.preventDefault(); changeLivePage(event.key === 'ArrowRight' ? 1 : -1); }
});
new ResizeObserver(scalePreview).observe($('preview-viewport'));
window.addEventListener('beforeunload', event => { if (generation > savedGeneration) { event.preventDefault(); event.returnValue = ''; } });
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$('bulk-copy-shortcut').textContent = mac ? '⌘A → ⌘C' : 'Ctrl＋A → Ctrl＋C';
$('show-shortcut').textContent = `${mac ? 'Option' : 'Alt'} ↵`;
$('show-letter').title = `${mac ? 'Option' : 'Alt'}＋Enterで表示`;
async function initializeControls() {
  const results = await Promise.allSettled([request('/api/environment'), request('/api/fonts')]);
  if (results[0].status === 'fulfilled') {
    environment = results[0].value; $('obs-frame').disabled = !environment.canvasWidth;
    $('obs-frame').title = environment.canvasWidth ? `${environment.canvasWidth} × ${environment.canvasHeight}` : '';
  }
  if (results[1].status === 'fulfilled') {
    availableFonts = results[1].value.fonts.map(item => item.family).sort((a, b) => a.localeCompare(b, 'ja'));
    fontListHelp = results[1].value.error ? 'フォント名を手入力できます。一覧はOBSを再起動すると読み直します。' : `このPCの${availableFonts.length}書体から選べます。`;
  } else fontListHelp = '一覧を取得できませんでした。「フォント名を入力」から指定できます。';
  if (state) { fontOptionsKey = ''; renderFonts(); updateFontHelp(state.style.font); }
  else $('font-help').textContent = fontListHelp;
}
initializeControls();
poll();
