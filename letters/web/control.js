// SPDX-License-Identifier: GPL-2.0-or-later
import * as Core from './core.js';
import {UI_THEMES, uiColours, applyUI} from './themes.js';
import {analysePaste, importKey, importProblem, MAX_IMPORT_CANDIDATES} from './imports.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), token = params.get('token') || '';
let sourceId = params.get('source') || '', state = null, revision = -1, metadata = {};
let persistedStateKey = '';
let generation = 0, savedGeneration = 0, writing = null, saveTimer, blocked = false;
let saveFailed = false, advancing = false;
let previewPage = 0, previewCount = 1, previewError = '', previewSerial = 0, liveCount = 1;
let previewController;
let filter = 'all', dragId = null, undoStack = [], toastTimer, liveLayoutKey = '', sourceRefreshAt = 0;
let environment = {}, availableFonts = [], fontOptionsKey = '', fontCustomMode = false;
let previewScroll = 0, previewMetrics = {scrollMax: 0, viewportHeight: 1}, previewStyle = null;
let liveMetrics = {scrollMax: 0, viewportHeight: 1};
let fontListHelp = 'PCのフォント一覧を取得しています。';
let deleteSession = null, deleteSelection = new Set(), deleteListKey = '';
let bulkSession = null, bulkDraft = {text: '', html: ''};
let managerSelection = new Set(), managerKey = '', managerSource = '', managerDrag = null, managerEdit = null;

function updateFontHelp(family) {
  const status = Core.fontStatus(family);
  $('font-help').textContent = `${fontListHelp} ${status.pending ? '選んだ書体を読み込んでいます。' :
    status.loaded ? '選んだ書体でプレビューしています。' :
    'この書体は通常のPC内フォント表示を使います。Safariで異なる場合は、一覧から別の書体を選ぶかChrome/Edgeで確認してください。'}`;
}

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  if ($('manager-dialog').open) $('manager-message').textContent = message;
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
  const pending = generation > savedGeneration;
  $('save-status').dataset.state = blocked ? 'blocked' : pending ? saveFailed ? 'error' : 'saving' : 'saved';
  $('save-status').textContent = blocked ? '入力をこの画面に保持しています' : pending ? saveFailed ? 'OBSに未保存・再試行中' : 'OBSに保存中…' : 'OBSに保存済み';
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { flush().catch(() => {}); }, 160); }
const stateKey = value => JSON.stringify(Core.normalizeState(value));
async function flush() {
  if (blocked) throw new Error('「ファイルに保存」で入力を保管してから、操作画面を開き直してください。');
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
        notice('別の操作画面から更新されました。入力はこの画面に残しています。画面上部の「ファイルに保存」で保管してから、操作画面を開き直してください。');
        throw new Error('別の操作画面で更新されています。');
      }
      revision = result.revision; metadata = result; savedGeneration = targetGeneration;
      persistedStateKey = stateKey(result.state);
      saveFailed = false;
      connection(true); saveStatus(); updateLive();
    }
  })().catch(error => {
    saveFailed = true; connection(false); saveStatus();
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
  setInput('draft-title', state.draft.title); setInput('draft-text', state.draft.text); setInput('reply-note', state.draft.replyNote || '');
  $('character-count').textContent = `${Array.from(state.draft.text).length.toLocaleString('ja-JP')}文字`;
  for (const key of ['fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor',
    'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background', 'frameBackground']) setInput(key, state.style[key]);
  for (const side of ['top', 'right', 'bottom', 'left']) setInput(`padding-${side}`, state.style.padding[side]);
  setInput('backgroundOpacity', Math.round(state.style.backgroundOpacity * 100));
  $('opacity-value').textContent = `${Math.round(state.style.backgroundOpacity * 100)}%`;
  $('backgroundOpacity').style.setProperty('--range-progress', `${state.style.backgroundOpacity * 100}%`);
  setInput('frameBackgroundOpacity', Math.round(state.style.frameBackgroundOpacity * 100));
  $('frame-opacity-value').textContent = `${Math.round(state.style.frameBackgroundOpacity * 100)}%`;
  $('frameBackgroundOpacity').style.setProperty('--range-progress', `${state.style.frameBackgroundOpacity * 100}%`);
  setInput('readingMode', state.draft.groupId ? 'pages' : state.style.readingMode); $('readingMode').disabled=!!state.draft.groupId; renderFonts();
  $('auto-height').setAttribute('aria-pressed', String(state.style.autoHeight));
  $('height-label').textContent = state.style.autoHeight ? '最大の高さ' : '枠の高さ';
  setInput('quick-width', state.style.width); setInput('quick-height', state.style.height);
  $('quick-height-label').textContent = state.style.autoHeight ? '最大高さ' : '高さ';
  $('quick-auto-height').setAttribute('aria-pressed', String(state.style.autoHeight));
  $('showTitle').checked = state.style.showTitle; $('showPageNumber').checked = state.style.showPageNumber;
  $('showServiceLabel').checked = state.style.showServiceLabel;
  setInput('serviceLabel', state.style.serviceLabel);
  $('showIcon').checked = state.style.showIcon; $('showIcon').disabled = !state.style.iconData;
  $('icon-remove').disabled = !state.style.iconData;
  const iconPreview = $('icon-preview');
  iconPreview.hidden = !state.style.iconData;
  if (state.style.iconData) iconPreview.src = state.style.iconData; else iconPreview.removeAttribute('src');
  $('icon-name').textContent = state.style.iconData ? `選択中：${state.style.iconName || '画像'}` : '画像は選ばれていません。';
  $('save-draft').disabled = !state.draft.text.trim();
  $('undo').disabled = !undoStack.length;
}
function renderQueue() {
  const search = $('search').value.toLocaleLowerCase();
  const items = state.items.filter(item => (filter === 'all' || (filter === 'done') === item.done) &&
    `${item.title}\n${item.text}`.toLocaleLowerCase().includes(search));
  $('queue-count').textContent = state.items.length;
  $('queue-progress').textContent = `未紹介 ${state.items.filter(item => !item.done).length} 件 / 全 ${state.items.length} 件`;
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
    const grouped = state.groups?.find(g=>g.members.some(m=>m.id===item.id));
    if(grouped){const badge=document.createElement('span');badge.className='group-member-badge';badge.textContent='組'+grouped.number;badge.title=groupLabel(grouped);heading.append(badge);}
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
  renderManager();
  renderGroups();
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
  const serial = ++previewSerial, draft = Core.clone(Core.preparedValue(state)), style = Core.clone(state.style);
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
    const result = await Core.renderPresentation(scratch, {...draft, scroll: previewScroll}, style, previewPage, {signal: previewController.signal});
    if (serial !== previewSerial) return;
    updateFontHelp(style.font);
    $('preview-host').replaceChildren(result.frame); previewCount = result.pages.length; previewPage = result.page;
    previewError = '';
    previewMetrics = result; previewStyle = result.style; scalePreview();
    $('preview-size').textContent = `${result.style.width} × ${result.style.height}${style.autoHeight ? '（自動）' : ''}`;
    const scrolling = result.style.readingMode === 'scroll'; $('preview-scroll').hidden = !scrolling;
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
  const scrolling = !state.draft.groupId && state.style.readingMode === 'scroll';
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
  setInput('live-reading-mode', scrolling ? 'scroll' : 'pages'); $('live-reading-mode').disabled = !onAir || !!live.groupCards;
  $('live-page').textContent = onAir ? (scrolling ? `${Math.round(live.scroll * 100)}%` : `${Math.min(live.page + 1, liveCount)} / ${liveCount}`) : '—';
  $('live-prev').textContent = scrolling ? '↑ 上へスクロール' : '← 前のページ'; $('live-next').textContent = scrolling ? '下へスクロール ↓' : '次のページ →';
  $('live-prev').setAttribute('aria-label', scrolling ? '表示中の文章を上へ' : '配信中の前のページ');
  $('live-next').setAttribute('aria-label', scrolling ? '表示中の文章を下へ' : '配信中の次のページ');
  $('live-prev').disabled = !onAir || (scrolling ? live.scroll <= 0 || liveMetrics.scrollMax <= 0 : live.page <= 0);
  $('live-next').disabled = !onAir || (scrolling ? live.scroll >= 1 || liveMetrics.scrollMax <= 0 : live.page >= liveCount - 1);
  $('live-scroll-row').hidden = !onAir || !scrolling; $('live-scroll').disabled = !onAir || liveMetrics.scrollMax <= 0;
  setInput('live-scroll', Math.round(live.scroll * 1000));
  $('hide-live').disabled = !onAir; $('finish-live').disabled = !onAir;
  const candidate = nextAiredCandidate();
  $('finish-next-live').disabled = !candidate || advancing || blocked;
  $('next-label').textContent = onAir ? (candidate ? `次：${Core.label(candidate)}` : '次に表示するお便りはありません') : `準備中：${Core.label(Core.preparedValue(state))}`;
  const key = JSON.stringify([live.text, live.style, live.groupCards, live.groupLayout]);
  if (onAir && key !== liveLayoutKey) {
    liveLayoutKey = key;
    Core.renderPresentation(document.createElement('div'), live, live.style || state.style, live.page, {prepared: true}).then(result => {
      if (key !== liveLayoutKey) return;
      if (metadata.renderedLiveRevision !== metadata.liveRevision) { liveCount = result.pages.length; liveMetrics = result; }
      updateLive();
    }).catch(() => {});
  }
}
function render() { if (state) { renderUI(); renderInputs(); renderQueue(); updateLive(); updatePreview(); } }

async function loadSource(id) {
  if ($('group-dialog').open) $('group-dialog').close();
  if ($('manager-edit-dialog').open) $('manager-edit-dialog').close();
  if ($('manager-dialog').open) $('manager-dialog').close();
  if ($('delete-dialog').open) $('delete-dialog').close();
  if ($('bulk-dialog').open) $('bulk-dialog').close();
  if (state && generation > savedGeneration) await flush();
  const result = await request(`/api/state/${id}`);
  sourceId = id; state = Core.normalizeState(result.state); revision = result.revision; metadata = result;
  persistedStateKey = stateKey(result.state);
  generation = savedGeneration = 0; blocked = false; saveFailed = false; undoStack = []; previewPage = 0; liveLayoutKey = '';
  previewScroll = 0; fontCustomMode = false; fontOptionsKey = ''; previewStyle = null;
  const url = new URL(location.href); url.searchParams.set('source', id); history.replaceState(null, '', url);
  $('source-picker').value = id; $('app').hidden = false; $('empty-setup').hidden = true;
  connection(true); notice(result.error || ''); saveStatus(); render();
}
async function refreshSources() {
  const result = await request('/api/sources'), sources = result.sources.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const old = $('source-picker').value;
  $('source-picker').replaceChildren(...sources.map(source => { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; return option; }));
  if (!sources.length) { if ($('group-dialog').open) $('group-dialog').close(); if ($('manager-edit-dialog').open) $('manager-edit-dialog').close(); if ($('manager-dialog').open) $('manager-dialog').close(); if ($('delete-dialog').open) $('delete-dialog').close(); state = null; sourceId = ''; $('app').hidden = true; $('empty-setup').hidden = false; return; }
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
      const target = sourceId, readRevision = revision, readGeneration = generation;
      const result = await request(`/api/state/${sourceId}`);
      // A save may finish while this GET is in flight. Its older response must
      // not replace the newly acknowledged state or rewind the revision.
      if (target !== sourceId || writing || generation !== savedGeneration ||
          revision !== readRevision || generation !== readGeneration) return;
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
$('reply-note').addEventListener('input', () => {
  const replyNote = $('reply-note').value;
  mutate(s => {
    const item = s.items.find(item => item.id === s.draft.id);
    for (const target of [s.draft,item].filter(Boolean)) {
      if (replyNote) target.replyNote = replyNote; else delete target.replyNote;
    }
  }, false, false);
});
$('save-draft').addEventListener('click', () => { if (mutate(Core.saveDraft, true)) toast('一覧に保存しました。配信への表示は変わりません。'); });
async function show() {
  if (!state || !state.draft.text.trim()) return;
  try {
    const expected = generation;
    const prepared = await Core.renderPresentation(document.createElement('div'), Core.preparedValue(state), state.style);
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
  if (!state?.live.visible || state.live.groupCards) return;
  const mode = $('live-reading-mode').value;
  if (mode === state.live.style?.readingMode) return;
  liveLayoutKey = ''; liveCount = 1; liveMetrics = {scrollMax: 0, viewportHeight: 1};
  if (!mutate(s => { s.live.style = {...Core.clone(s.live.style || s.style), readingMode: mode}; s.live.page = 0; s.live.scroll = 0; }, false, false)) return;
  flush().catch(() => {});
  toast(`${mode === 'scroll' ? 'スクロール' : 'ページ送り'}に切り替え、配信中のお便りを先頭から表示します。`);
});
for (const [id, delta] of [['preview-prev', -1], ['preview-next', 1]]) $(id).addEventListener('click', () => {
  if (!state.draft.groupId && state.style.readingMode === 'scroll') movePreviewScroll(previewScroll + delta * (previewMetrics.scrollMax > 0 ? .85 * previewMetrics.viewportHeight / previewMetrics.scrollMax : 0));
  else { previewPage = Math.max(0, Math.min(previewCount - 1, previewPage + delta)); updatePreview(); }
});
$('preview-scroll').addEventListener('input', () => movePreviewScroll(Number($('preview-scroll').value) / 1000));
$('preview-viewport').addEventListener('wheel', event => {
  if (!state || state.draft.groupId || state.style.readingMode !== 'scroll' || previewMetrics.scrollMax <= 0) return;
  event.preventDefault(); movePreviewScroll(previewScroll + event.deltaY / previewMetrics.scrollMax);
}, {passive: false});
$('live-scroll').addEventListener('input', () => { const position = Number($('live-scroll').value) / 1000; mutate(s => { s.live.scroll = position; }, false, false); });
$('hide-live').addEventListener('click', () => {
  mutate(s => { s.live.visible = false; }, false, false); flush().catch(() => {});
});
$('finish-live').addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(Core.finishLive, true); flush().catch(() => {}); });
// This is an explicit one-click broadcast action, separate from the safe prepare-only flow.
// Never replay the completed letter when there is no next item to display.
function nextAiredCandidate() {
  if (!state?.live.visible) return null;
  const prepared = Core.clone(state);
  Core.finishLive(prepared);
  const value = Core.preparedValue(prepared);
  const aired = new Set(state.live.groupCards?.map(c=>c.id) || [state.live.id]);
  return value.text.trim() && Core.presentationId(value)!==Core.presentationId(state.live) && (value.groupCards ? value.groupCards.some(c=>!aired.has(c.id)) : !aired.has(value.id)) ? value : null;
}
async function finishAndShowNext() {
  if (!state?.live.visible || advancing || blocked) return;
  const candidate = nextAiredCandidate();
  if (!candidate) { toast('次に表示できるお便りがありません。「紹介済み → 次を準備」を使ってください。'); return; }
  const expectedGeneration = generation, expectedSource = sourceId;
  advancing = true; $('finish-next-live').disabled = true;
  try {
    // Resolve pagination and dimensions before modifying the current broadcast.
    const prepared = await Core.renderPresentation(document.createElement('div'), candidate, state.style);
    if (generation !== expectedGeneration || sourceId !== expectedSource || blocked) {
      toast('操作中に準備内容が変更されました。内容を確認して再度操作してください。'); return;
    }
    previewPage = 0; previewScroll = 0;
    if (!mutate(s => { Core.finishLive(s); Core.showDraft(s, prepared.style); }, true)) return;
    await flush();
    toast('紹介済みにして、次のお便りを配信に表示しました。');
  } catch (error) { toast(error.message || '次のお便りを表示できませんでした。'); }
  finally { advancing = false; if (state) updateLive(); }
}
$('finish-next-live').addEventListener('click', finishAndShowNext);

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

function managerItems() {
  if (!state) return [];
  const search = $('manager-search').value.trim().toLocaleLowerCase('ja'), mode = $('manager-filter').value;
  return state.items.map(item => item.id === state.draft.id ? {...item, title:state.draft.title,text:state.draft.text,replyNote:state.draft.replyNote || ''} : item)
    .filter(item => (mode === 'all' || (mode === 'done') === item.done) && (item.title+' '+item.text+' '+(item.replyNote || '')).toLocaleLowerCase('ja').includes(search));
}
function updateManagerSelection() {
  if (!state || !$('manager-dialog').open) return;
  const ids = new Set(managerItems().map(item => item.id));
  for (const id of managerSelection) if (!ids.has(id)) managerSelection.delete(id);
  const count = managerSelection.size, total = state.items.length;
  $('manager-count').textContent = `${count}件選択`;
  $('manager-summary').textContent = `全 ${total} 件 / 未紹介 ${state.items.filter(item => !item.done).length} 件` + (ids.size !== total ? ` / 表示 ${ids.size} 件` : '');
  $('manager-all').disabled = !ids.size || count === ids.size;
  $('manager-group-create').disabled = count < 2 || count > Core.MAX_GROUP_MEMBERS || blocked || (state.groups || []).some(g=>g.members.some(m=>managerSelection.has(m.id)));
  $('manager-mark-done').disabled = !count || blocked;
  $('manager-mark-pending').disabled = !count || blocked;
  $('manager-delete').disabled = !count || blocked;
  $('manager-delete-bulk').disabled = !total || blocked;
  $('manager-clear').disabled = !count;
  document.querySelectorAll('[data-manager-move]').forEach(button => { button.disabled = !count || count === total || blocked; });
  const position = $('manager-position'), maximum = Math.max(1,total-count+1);
  position.max = maximum;
  if (Number(position.value) > maximum) position.value = maximum;
  position.disabled = !count || count === total || blocked;
  $('manager-undo').disabled = !undoStack.length || blocked;
  for (const row of $('manager-list').children) {
    const checked = managerSelection.has(row.dataset.id);
    row.classList.toggle('selected', checked);
    row.querySelector('input').checked = checked;
  }
}
function renderManager() {
  if (!state || !$('manager-dialog').open || managerSource !== sourceId) return;
  const visibleItems = managerItems();
  const key = JSON.stringify([visibleItems,state.items.map(item=>item.id),state.groups]);
  if (key !== managerKey) {
    managerKey = key;
    const list = $('manager-list');
    list.replaceChildren(...visibleItems.map(item => {
      const index = state.items.findIndex(entry=>entry.id===item.id);
      const row = document.createElement('li'); row.className = 'manager-row'; row.dataset.id = item.id;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `${index+1}. ${Core.label(item)}を選択`);
      checkbox.addEventListener('change', () => { if (checkbox.checked) managerSelection.add(item.id); else managerSelection.delete(item.id); updateManagerSelection(); });
      const handle = document.createElement('span'); handle.className = 'manager-handle'; handle.textContent = '⠿'; handle.draggable = true;
      handle.setAttribute('aria-label', `${Core.label(item)}をドラッグして移動`); handle.setAttribute('role','img');
      handle.addEventListener('dragstart', event => {
        if (blocked) { event.preventDefault(); return; }
        if (!managerSelection.has(item.id)) { managerSelection = new Set([item.id]); updateManagerSelection(); }
        managerDrag = [...managerSelection]; event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move';
      });
      handle.addEventListener('dragend', () => { managerDrag = null; list.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); });
      row.addEventListener('dragover', event => { if (managerDrag && !managerDrag.includes(item.id)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', event => { event.preventDefault(); row.classList.remove('drop-target'); if (managerDrag && !managerDrag.includes(item.id)) moveManaged('before',item.id); managerDrag = null; });
      const number = document.createElement('span'); number.className = 'manager-number'; number.textContent = String(index+1).padStart(2,'0');
      const grouped=state.groups?.find(g=>g.members.some(m=>m.id===item.id));
      if(grouped){const badge=document.createElement('span');badge.className='group-member-badge';badge.textContent='組'+grouped.number;badge.title=groupLabel(grouped);number.append(badge);}
      const content = document.createElement('div'); content.className = 'manager-content';
      const title = document.createElement('strong'); title.textContent = Core.label(item);
      const body = document.createElement('p'); body.textContent = item.text;
      const actions = document.createElement('div'); actions.className = 'manager-row-actions';
      const edit = document.createElement('button'); edit.textContent = '編集'; edit.addEventListener('click',()=>openManagerEdit(item.id));
      const prepare = document.createElement('button'); prepare.textContent = '配信の準備'; prepare.addEventListener('click',()=>{ previewPage=0; previewScroll=0; if(mutate(s=>Core.selectItem(s,item.id))) toast('準備中のお便りに設定しました。配信表示は変わりません。'); });
      actions.append(edit,prepare); content.append(title,body);
      if (item.replyNote) { const note = document.createElement('p'); note.className = 'manager-reply-note'; note.textContent = '返答用メモ：'+item.replyNote; content.append(note); }
      content.append(actions);
      const status = document.createElement('span'); status.className = 'manager-status'; status.textContent = item.done ? '✓ 紹介済み' : '未紹介';
      row.append(checkbox,handle,number,content,status); return row;
    }));
  }
  $('manager-empty').hidden = !!visibleItems.length;
  $('manager-empty').textContent = state.items.length ? '条件に合うお便りはありません。' : 'お便りはありません。';
  updateManagerSelection();
}
function moveManaged(mode, target = 0) {
  if (!state || blocked || managerSource !== sourceId || !managerSelection.size) return;
  const ids = [...managerSelection], next = Core.clone(state);
  Core.moveItems(next,ids,mode,target);
  if (JSON.stringify(next.items.map(item => item.id)) === JSON.stringify(state.items.map(item => item.id))) {
    $('manager-message').textContent = '順番は変わりません。'; return;
  }
  if (mutate(s => Core.moveItems(s,ids,mode,target),true)) {
    $('manager-message').textContent = `${ids.length}件を移動しました。`;
    flush().catch(() => { $('manager-message').textContent = 'OBSに保存できていません。操作画面の保存状況を確認してください。'; });
  }
}
$('manager-open').addEventListener('click', () => {
  if (!state || blocked) return;
  managerSource = sourceId; managerSelection.clear(); managerKey = ''; managerDrag = null;
  $('manager-position').value = 1; $('manager-message').textContent = ''; $('manager-search').value = ''; $('manager-filter').value = 'all';
  $('manager-dialog').showModal(); renderManager(); renderGroups();
});
for (const id of ['manager-close','manager-done']) $(id).addEventListener('click', () => $('manager-dialog').close());
$('manager-dialog').addEventListener('close', () => { managerSelection.clear(); managerKey = ''; managerSource = ''; managerDrag = null; });
$('manager-all').addEventListener('click', () => { if (state) managerSelection = new Set(managerItems().map(item => item.id)); updateManagerSelection(); });
$('manager-clear').addEventListener('click', () => { managerSelection.clear(); updateManagerSelection(); });
document.querySelectorAll('[data-manager-move]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.managerMove;
  if (mode === 'position') {
    const position = $('manager-position');
    if (!position.value || !position.checkValidity()) { position.reportValidity(); return; }
    moveManaged(mode,Number(position.value)-1);
  } else moveManaged(mode);
}));
$('manager-undo').addEventListener('click', () => { if (!state || blocked) return; $('undo').click(); $('manager-message').textContent = '直前の一覧操作を戻しました。'; flush().catch(() => { $('manager-message').textContent = 'OBSに保存できていません。'; }); });


for (const [id,event] of [['manager-search','input'],['manager-filter','change']]) $(id).addEventListener(event,()=>{managerSelection.clear(); renderManager();});
for (const [id,target] of [['manager-inbox','inbox-open'],['manager-paste','bulk-open'],['manager-import','import-open'],['manager-export','export'],['manager-restore','restore-open'],['manager-delete-bulk','delete-bulk-open']]) $(id).addEventListener('click',()=>$(target).click());
$('manager-delete').addEventListener('click',()=>{
  if (!managerSelection.size || blocked) return;
  const ids = new Set(managerSelection);
  $('delete-bulk-open').click();
  if ($('delete-dialog').open) {deleteSelection=ids; updateDeleteSelection();}
});
for (const [id,done] of [['manager-mark-done',true],['manager-mark-pending',false]]) $(id).addEventListener('click',()=>{
  if (!managerSelection.size || blocked) return;
  const ids = new Set(managerSelection);
  if (mutate(s=>{for(const item of s.items) if(ids.has(item.id)) item.done=done;},true)) {
    toast(ids.size+'件の紹介状態を変更しました。'); flush().catch(()=>{});
  }
});
function openManagerEdit(id=null) {
  if (!state || blocked || ($('manager-dialog').open && managerSource!==sourceId)) return;
  const item = id ? state.items.find(item=>item.id===id) : null;
  if (id && !item) return;
  const original = item && id === state.draft.id ? state.draft : item;
  managerEdit = {id,source:sourceId,original:original ? {title:original.title,text:original.text,replyNote:original.replyNote || ''} : null};
  $('manager-edit-heading').textContent = id ? 'お便りを編集' : 'お便りを新規作成';
  $('manager-edit-title').value = original?.title || '';
  $('manager-edit-text').value = original?.text || '';
  $('manager-edit-reply').value = original?.replyNote || '';
  $('manager-edit-error').textContent = '';
  $('manager-edit-dialog').showModal();
  $('manager-edit-text').focus();
}
$('manager-new').addEventListener('click',()=>openManagerEdit());
for (const id of ['manager-edit-close','manager-edit-cancel']) $(id).addEventListener('click',()=>$('manager-edit-dialog').close());
$('manager-edit-dialog').addEventListener('close',()=>{managerEdit=null;});
$('manager-edit-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (!managerEdit || blocked || managerEdit.source!==sourceId) return;
  const {id,original}=managerEdit;
  const title=$('manager-edit-title').value,text=$('manager-edit-text').value,replyNote=$('manager-edit-reply').value;
  const error = message => { $('manager-edit-error').textContent=message; };
  if (!text.trim()) return error('本文を入力してください。');
  if (/^https?:\/\/(?:www\.)?marshmallow-qa\.com\/\S+\s*$/.test(text)) return error('URLではなく本文を貼り付けてください。');
  if (!id && state.items.length>=300) return error('お便りは300件まで登録できます。');
  if (id) {
    const item=state.items.find(item=>item.id===id), current=id===state.draft.id ? state.draft : item;
    if (!item || current.title!==original.title || current.text!==original.text || (current.replyNote || '')!==original.replyNote) return error('別の操作で内容が変わりました。閉じて開き直してください。');
  }
  if (mutate(s=>{
    if (id) {
      const item = s.items.find(item=>item.id===id);
      for (const target of [item,s.draft.id===id ? s.draft : null].filter(Boolean)) {
        Object.assign(target,{title,text}); if (replyNote) target.replyNote=replyNote; else delete target.replyNote;
      }
    } else s.items.push({id:Core.uid(),title,text,done:false,...(replyNote ? {replyNote} : {})});
  },true)) {
    $('manager-edit-dialog').close(); toast('一覧に保存しました。配信中の表示は変わりません。'); flush().catch(()=>{});
  }
});


let groupEdit=null;
const groupLabel=g=>'組'+g.number+' '+(g.title || 'まとめたお便り')+'（'+g.members.length+'件）';
function prepareGroup(id){
  previewPage=0;previewScroll=0;
  if(mutate(s=>Core.selectGroup(s,id))) toast('グループを準備しました。配信表示は変わりません。');
}

let groupReaderKey='';
function renderGroupReader(group) {
  const reader=$('group-reader');
  reader.hidden=!group;
  $('single-reply-note').hidden=!!group;$('single-editor').hidden=!!group;
  if(!group){reader.replaceChildren();groupReaderKey='';return;}
  const items=group.members.map(m=>state.items.find(i=>i.id===m.id)).filter(Boolean).map(i=>i.id===state.draft.id?{...i,...state.draft}:i);
  const key=JSON.stringify([group.id,group.number,group.title,items.map(i=>[i.id,i.title,i.text])]);
  const resize=el=>{el.style.height='auto';el.style.height=Math.min(400,Math.max(66,el.scrollHeight+4))+'px';};
  const addNote=(parent,id,label,value,update)=>{
    const lab=document.createElement('label');lab.htmlFor=id;lab.textContent=label;
    const input=document.createElement('textarea');input.id=id;input.maxLength=4000;input.rows=2;input.value=value||'';input.placeholder='話したいこと・返事の下書きなど';
    input.addEventListener('input',()=>{resize(input);update(input.value);});
    parent.append(lab,input);return input;
  };
  if(key!==groupReaderKey){
    groupReaderKey=key;reader.replaceChildren();
    const heading=document.createElement('div');heading.className='group-reader-heading';
    const title=document.createElement('strong');title.textContent=groupLabel(group)+' の本文';
    const hint=document.createElement('span');hint.textContent='手元で読むための表示です。返答用メモは配信に出ません。';heading.append(title,hint);
    const common=document.createElement('div');common.className='group-reader-common';
    addNote(common,'group-common-reply','グループ共通の返答用メモ',group.replyNote,value=>mutate(s=>{const g=s.groups?.find(x=>x.id===group.id);if(g){if(value)g.replyNote=value;else delete g.replyNote;}},false,false));
    const list=document.createElement('div');list.className='group-reader-list';
    for(const [index,item] of items.entries()){
      const card=document.createElement('article');card.className='group-reader-card';card.dataset.id=item.id;
      const head=document.createElement('header'), title=document.createElement('strong');title.textContent=(index+1)+'. '+Core.label(item);
      const edit=document.createElement('button');edit.type='button';edit.textContent='本文を編集';edit.addEventListener('click',()=>openManagerEdit(item.id));head.append(title,edit);
      const body=document.createElement('div');body.className='group-reader-body';body.textContent=item.text;
      card.append(head,body);
      const input=addNote(card,'group-member-reply-'+index,'返答用メモ',item.replyNote,value=>mutate(s=>{const target=s.items.find(i=>i.id===item.id);for(const entry of [target,s.draft.id===item.id?s.draft:null].filter(Boolean)){if(value)entry.replyNote=value;else delete entry.replyNote;}},false,false));
      input.className='group-member-reply';list.append(card);
    }
    reader.append(heading,common,list);
    reader.querySelectorAll('textarea').forEach(resize);
  }else{
    const common=$('group-common-reply');if(document.activeElement!==common&&common.value!==(group.replyNote||'')){common.value=group.replyNote||'';resize(common);}
    items.forEach((item,i)=>{const input=$('group-member-reply-'+i);if(input&&document.activeElement!==input&&input.value!==(item.replyNote||'')){input.value=item.replyNote||'';resize(input);}});
  }
}

function renderGroups(){
  if(!state)return;
  const groups=state.groups || [], current=groups.find(g=>g.id===state.draft.groupId);
  const q=$('queue-groups'); q.hidden=!groups.length;
  q.replaceChildren(...groups.map(g=>{
    const b=document.createElement('button');b.textContent='▦ '+groupLabel(g)+(g.members.every(m=>state.items.find(i=>i.id===m.id)?.done)?' ✓ 済':'');
    b.classList.toggle('selected',g.id===state.draft.groupId);b.addEventListener('click',()=>prepareGroup(g.id));return b;
  }));
  const p=$('group-preparation');p.hidden=!current;p.replaceChildren();
  renderGroupReader(current);
  if(current){
    const label=document.createElement('strong');label.textContent=groupLabel(current);
    const layout=document.createElement('select');layout.setAttribute('aria-label','グループの配置');
    for(const [v,t] of [['grid','自動グリッド'],['vertical','縦並び'],['horizontal','横並び']]){const o=document.createElement('option');o.value=v;o.textContent=t;layout.append(o);}
    layout.value=current.layout;layout.addEventListener('change',()=>{previewPage=0;mutate(s=>{s.groups.find(g=>g.id===current.id).layout=layout.value;},true);});
    const single=document.createElement('button');single.textContent='個別表示に戻す';single.addEventListener('click',()=>{previewPage=0;mutate(s=>{delete s.draft.groupId;});});
    const info=document.createElement('span');info.textContent='ページ送り・固定高さ／本文と返答用メモは下に全件表示';
    p.append(label,layout,single,info);
  }
  const m=$('manager-groups');m.hidden=!groups.length;
  if(!$('manager-dialog').open)return;
  m.replaceChildren(...groups.map(g=>{
    const row=document.createElement('div');row.className='manager-group-row';row.dataset.groupId=g.id;
    const label=document.createElement('strong');label.textContent='▦ '+groupLabel(g)+' / '+g.members.map(m=>Core.label(state.items.find(i=>i.id===m.id))).join(' → ');
    const button=(name,fn)=>{const b=document.createElement('button');b.textContent=name;b.addEventListener('click',fn);return b;};
    row.append(label,button('配信の準備',()=>prepareGroup(g.id)),button('順番・配置',()=>openGroup(g.id)),button('グループ解除',()=>{if(confirm('グループを解除します。元のお便りは残ります。')){mutate(s=>{s.groups=s.groups.filter(x=>x.id!==g.id);if(s.draft.groupId===g.id)delete s.draft.groupId;},true);toast('グループを解除しました。');}}));return row;
  }));
}
function openGroup(id=null){
  if(!state||blocked)return;
  const g=id?state.groups?.find(x=>x.id===id):null;
  const members=g?g.members.map(m=>m.id):state.items.filter(i=>managerSelection.has(i.id)).map(i=>i.id);
  if(members.length<2||members.length>Core.MAX_GROUP_MEMBERS)return;
  groupEdit={id,source:sourceId,members,original:g?JSON.stringify(g):null};
  $('group-title').value=g?.title || '';$('group-layout').value=g?.layout || 'grid';$('group-error').textContent='';
  $('group-dialog').showModal();renderGroupEditor();
}
function renderGroupEditor(){
  if(!groupEdit||!state)return;
  const members=groupEdit.members,layout=$('group-layout').value;
  const preview=$('group-layout-preview');preview.style.gridTemplateColumns='repeat('+(Core.groupColumns(layout,members.length))+',1fr)';
  preview.replaceChildren(...members.map((_,i)=>{const e=document.createElement('span');e.textContent=i+1;return e;}));
  $('group-members').replaceChildren(...members.map((id,i)=>{
    const li=document.createElement('li'),label=document.createElement('span'),item=state.items.find(x=>x.id===id);
    label.textContent=(i+1)+'. '+(item?Core.label(item):'削除済み');li.append(label);
    for(const [name,delta] of [['↑',-1],['↓',1]]){const b=document.createElement('button');b.type='button';b.textContent=name;b.disabled=i+delta<0||i+delta>=members.length;b.addEventListener('click',()=>{[members[i],members[i+delta]]=[members[i+delta],members[i]];renderGroupEditor();});li.append(b);}
    const remove=document.createElement('button');remove.type='button';remove.textContent='外す';remove.disabled=members.length<=2;remove.addEventListener('click',()=>{members.splice(i,1);renderGroupEditor();});li.append(remove);return li;
  }));
}
$('manager-group-create').addEventListener('click',()=>openGroup());
$('group-layout').addEventListener('change',renderGroupEditor);
for(const id of ['group-close','group-cancel'])$(id).addEventListener('click',()=>$('group-dialog').close());
$('group-dialog').addEventListener('close',()=>{groupEdit=null;});
$('group-form').addEventListener('submit',event=>{
  event.preventDefault();if(!groupEdit||blocked||groupEdit.source!==sourceId)return;
  const {id,members,original}=groupEdit;
  if(members.some(id=>!state.items.some(i=>i.id===id)) || (state.groups||[]).some(g=>g.id!==id&&g.members.some(m=>members.includes(m.id))) || (id && JSON.stringify(state.groups?.find(g=>g.id===id))!==original)){
    $('group-error').textContent='一覧が変わりました。閉じて開き直してください。';return;
  }
  const existing=state.groups?.find(g=>g.id===id);
  const g={...existing,id:id||Core.uid(),number:existing?.number || Math.max(0,...(state.groups||[]).map(g=>g.number))+1,title:$('group-title').value,layout:$('group-layout').value,members:members.map(id=>({id}))};
  if(mutate(s=>{s.groups=s.groups||[];const index=s.groups.findIndex(x=>x.id===g.id);if(index<0)s.groups.push(g);else s.groups[index]=g;if(s.draft.groupId===g.id)Core.selectGroup(s,g.id);},true)){
    $('group-dialog').close();toast('グループを保存しました。');flush().catch(()=>{});
  }
});

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
for (const key of ['fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor', 'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background', 'frameBackground', 'readingMode']) {
  $(key).addEventListener('change', () => {
    const value = ['align', 'verticalAlign', 'textColor', 'outlineColor', 'background', 'frameBackground', 'readingMode'].includes(key) ? $(key).value : Number($(key).value);
    previewPage = 0; previewScroll = 0; mutate(s => { s.style[key] = value; });
  });
}
for (const side of ['top', 'right', 'bottom', 'left']) $(`padding-${side}`).addEventListener('change', () => {
  const value = Number($(`padding-${side}`).value); previewPage = 0; mutate(s => { s.style.padding[side] = value; });
});
$('backgroundOpacity').addEventListener('input', () => { const value = Number($('backgroundOpacity').value) / 100; mutate(s => { s.style.backgroundOpacity = value; }); });
$('frameBackgroundOpacity').addEventListener('input', () => { const value = Number($('frameBackgroundOpacity').value) / 100; mutate(s => { s.style.frameBackgroundOpacity = value; }); });
for (const key of ['showTitle', 'showPageNumber', 'showIcon', 'showServiceLabel']) $(key).addEventListener('change', () => { const checked = $(key).checked; previewPage = 0; mutate(s => { s.style[key] = checked; }); });
$('serviceLabel').addEventListener('input', () => {
  const value = $('serviceLabel').value;
  mutate(s => { s.style.serviceLabel = value; });
});
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
  previewPage = 0; previewScroll = 0; mutate(s => Core.applyDisplayPreset(s.style, button.dataset.theme));
}));
$('icon-open').addEventListener('click', () => $('icon-file').click());
$('icon-file').addEventListener('change', async () => {
  const file = $('icon-file').files[0];
  if (!file) return;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('PNG・JPEG・WebP・GIFの画像を選んでください。');
    if (file.size > 128 * 1024) throw new Error('アイコン画像は128KB以内にしてください。');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.addEventListener('load', () => resolve(reader.result), {once: true});
      reader.addEventListener('error', () => reject(new Error('画像を読み込めませんでした。')), {once: true}); reader.readAsDataURL(file);
    });
    if (typeof data !== 'string' || data.length > Core.MAX_ICON_DATA_URL) throw new Error('アイコン画像が大きすぎます。別の画像を選んでください。');
    if (mutate(s => { s.style.iconData = data; s.style.iconName = file.name; s.style.showIcon = true; })) toast('アイコン画像を設定しました。配信への表示はまだ変わりません。');
  } catch (error) { toast(error.message); }
  finally { $('icon-file').value = ''; }
});
$('icon-remove').addEventListener('click', () => {
  if (mutate(s => { s.style.iconData = ''; s.style.iconName = ''; s.style.showIcon = false; })) toast('アイコン画像を外しました。配信への表示はまだ変わりません。');
});
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
for (const id of ['auto-height','quick-auto-height']) $(id).addEventListener('click', () => { previewPage = 0; previewScroll = 0; mutate(s => { s.style.autoHeight = !s.style.autoHeight; }); });
for (const key of ['width','height']) $(`quick-${key}`).addEventListener('change', () => { const value = Number($(`quick-${key}`).value); previewPage = 0; previewScroll = 0; mutate(s => { s.style[key] = value; }); });

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
  const now = new Date(), pad = value => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const link = document.createElement('a'); link.href = url; link.download = `お便りバックアップ-${date}-${time}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('ファイルのダウンロードを開始しました。入力中の下書きも含めています。保存先はブラウザの設定によります。');
});
$('restore-open').addEventListener('click', () => $('restore-file').click());
$('restore-file').addEventListener('change', async () => {
  const file = $('restore-file').files[0]; if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('1MB以内のファイルを選んでください。');
    const parsed = JSON.parse(await file.text()); if (parsed.version !== 1) throw new Error('お便りテキストのバックアップを選んでください。');
    const restored = Core.normalizeState(parsed);
    if (!confirm('現在のお便り・下書き・表示設定・画面の配色を、選んだファイルの内容に置き換えます。配信への表示は非表示になります。読み込みますか？')) return;
    restored.live.visible = false;
    if (blocked) throw new Error('「ファイルに保存」で入力を保管してから、操作画面を開き直してください。');
    previewPage = 0; previewScroll = 0;
    if (!mutate(s => Object.assign(s, restored), true)) return;
    await flush(); toast('ファイルから読み込み、OBSに保存しました。配信に表示する前にプレビューを確認してください。');
  } catch (error) { toast(error.message); } finally { $('restore-file').value = ''; }
});
document.addEventListener('keydown', event => {
  if ($('group-dialog').open || $('manager-edit-dialog').open || $('manager-dialog').open || $('bulk-dialog').open || $('ui-theme-dialog').open || $('delete-dialog').open || !state) return;
  if (event.altKey && event.key === 'Enter') { event.preventDefault(); show(); }
  else if (event.key === 'Escape' && state.live.visible) { event.preventDefault(); $('hide-live').click(); }
  else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && state.live.visible) { event.preventDefault(); changeLivePage(event.key === 'ArrowRight' ? 1 : -1); }
});
new ResizeObserver(scalePreview).observe($('preview-viewport'));
new ResizeObserver(() => { document.documentElement.style.setProperty('--dock-height', `${$('live-panel').offsetHeight}px`); }).observe($('live-panel'));
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