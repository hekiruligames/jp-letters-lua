// SPDX-License-Identifier: GPL-2.0-or-later
import * as Core from './core.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), token = params.get('token') || '';
let sourceId = params.get('source') || '', state = null, revision = -1, metadata = {};
let persistedStateKey = '';
let generation = 0, savedGeneration = 0, writing = null, saveTimer, blocked = false;
let previewPage = 0, previewCount = 1, previewError = '', previewSerial = 0, liveCount = 1;
let previewController;
let filter = 'all', dragId = null, undoStack = [], toastTimer, liveLayoutKey = '', sourceRefreshAt = 0;

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
function mutate(operation, remember = false) {
  if (!state || blocked) return false;
  try {
    const previous = Core.clone(state), next = Core.clone(state);
    operation(next);
    state = Core.normalizeState(next);
    if (remember) { undoStack.push(previous); if (undoStack.length > 15) undoStack.shift(); }
    generation++; saveStatus(); render(); scheduleSave(); return true;
  } catch (error) { toast(error.message); return false; }
}
function setInput(id, value) { if (document.activeElement !== $(id)) $(id).value = value; }
function renderInputs() {
  setInput('draft-title', state.draft.title); setInput('draft-text', state.draft.text);
  $('character-count').textContent = `${Array.from(state.draft.text).length.toLocaleString('ja-JP')}文字`;
  for (const key of ['font', 'fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor',
    'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background']) setInput(key, state.style[key]);
  for (const side of ['top', 'right', 'bottom', 'left']) setInput(`padding-${side}`, state.style.padding[side]);
  setInput('backgroundOpacity', Math.round(state.style.backgroundOpacity * 100));
  $('opacity-value').textContent = `${Math.round(state.style.backgroundOpacity * 100)}%`;
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
    button.append(heading, snippet); button.addEventListener('click', () => { previewPage = 0; mutate(s => Core.selectItem(s, item.id)); });
    li.append(handle, button); return li;
  });
  $('queue-list').replaceChildren(...nodes);
  const index = state.items.findIndex(item => item.id === state.selectedId);
  $('move-up').disabled = index <= 0; $('move-down').disabled = index < 0 || index >= state.items.length - 1;
  $('delete-letter').disabled = index < 0; $('toggle-done').disabled = index < 0;
  $('toggle-done').textContent = index >= 0 && state.items[index].done ? '未紹介に戻す' : '紹介済み';
}
function scalePreview() {
  if (!state) return;
  const box = $('preview-viewport');
  const scale = Math.min((box.clientWidth - 24) / state.style.width, (box.clientHeight - 20) / state.style.height, 1);
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
    $('preview-page').textContent = '—'; $('preview-prev').disabled = true; $('preview-next').disabled = true;
    $('show-letter').disabled = true;
    $('preview-info').textContent = '長文は読みやすい文字サイズのままページに分けます。'; $('preview-info').classList.remove('error');
    return;
  }
  try {
    const scratch = document.createElement('div');
    const result = await Core.renderLetter(scratch, draft, style, previewPage, {signal: previewController.signal});
    if (serial !== previewSerial) return;
    $('preview-host').replaceChildren(result.frame); previewCount = result.pages.length; previewPage = result.page;
    previewError = ''; scalePreview();
    $('preview-page').textContent = `${previewPage + 1} / ${previewCount}`;
    $('preview-info').textContent = previewCount > 1 ? `全${previewCount}ページ。配信中も上の矢印で切り替えられます。` : 'この内容は1ページに収まります。';
    $('preview-info').classList.remove('error'); $('show-letter').disabled = false;
  } catch (error) {
    if (serial !== previewSerial) return;
    previewError = error.message; $('preview-host').replaceChildren();
    $('preview-info').textContent = previewError; $('preview-info').classList.add('error');
    $('show-letter').disabled = true; previewCount = 1; $('preview-page').textContent = '—';
  }
  $('preview-prev').disabled = previewPage <= 0; $('preview-next').disabled = previewPage >= previewCount - 1;
}
function updateLive() {
  if (!state) return;
  const live = state.live, onAir = live.visible;
  $('live-status').textContent = onAir ? '表示中' : '非表示'; $('live-status').classList.toggle('on-air', onAir);
  $('live-title').textContent = onAir ? Core.label(live) : '配信には表示していません';
  const ready = metadata.renderedLiveRevision === metadata.liveRevision;
  if (ready && metadata.pageCount) liveCount = metadata.pageCount;
  $('live-detail').textContent = onAir ? (ready ? '準備中の編集は、表示中のお便りに反映されません。' : '表示を更新しています…') : '準備中のお便りは、表示ボタンを押すまで配信には出ません。';
  $('live-page').textContent = onAir ? `${Math.min(live.page + 1, liveCount)} / ${liveCount}` : '—';
  $('live-prev').disabled = !onAir || live.page <= 0;
  $('live-next').disabled = !onAir || live.page >= liveCount - 1;
  $('hide-live').disabled = !onAir; $('finish-live').disabled = !onAir;
  const key = JSON.stringify([live.text, live.style]);
  if (onAir && key !== liveLayoutKey) {
    liveLayoutKey = key;
    Core.paginate(live.text, live.style || state.style).then(pages => {
      if (key !== liveLayoutKey) return;
      if (metadata.renderedLiveRevision !== metadata.liveRevision) liveCount = pages.length;
      $('live-page').textContent = `${Math.min(state.live.page + 1, liveCount)} / ${liveCount}`;
      $('live-next').disabled = !state.live.visible || state.live.page >= liveCount - 1;
    }).catch(() => {});
  }
}
function render() { if (state) { renderInputs(); renderQueue(); updateLive(); updatePreview(); } }

async function loadSource(id) {
  if (state && generation > savedGeneration) await flush();
  const result = await request(`/api/state/${id}`);
  sourceId = id; state = Core.normalizeState(result.state); revision = result.revision; metadata = result;
  persistedStateKey = stateKey(result.state);
  generation = savedGeneration = 0; blocked = false; undoStack = []; previewPage = 0; liveLayoutKey = '';
  const url = new URL(location.href); url.searchParams.set('source', id); history.replaceState(null, '', url);
  $('source-picker').value = id; $('app').hidden = false; $('empty-setup').hidden = true;
  connection(true); notice(result.error || ''); saveStatus(); render();
}
async function refreshSources() {
  const result = await request('/api/sources'), sources = result.sources.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const old = $('source-picker').value;
  $('source-picker').replaceChildren(...sources.map(source => { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; return option; }));
  if (!sources.length) { state = null; sourceId = ''; $('app').hidden = true; $('empty-setup').hidden = false; return; }
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
$('new-letter').addEventListener('click', () => { previewPage = 0; mutate(Core.newDraft); $('draft-text').focus(); });
for (const [id, key] of [['draft-title', 'title'], ['draft-text', 'text']]) $(id).addEventListener('input', () => {
  const value = $(id).value; previewPage = 0; mutate(s => { s.draft[key] = value; });
});
$('save-draft').addEventListener('click', () => { if (mutate(Core.saveDraft, true)) toast('一覧に保存しました。配信への表示は変わりません。'); });
async function show() {
  if (!state || !state.draft.text.trim()) return;
  try {
    const expected = generation;
    await Core.paginate(state.draft.text, state.style);
    if (expected !== generation) return show();
    if (!mutate(Core.showDraft)) return;
    await flush(); toast('このお便りを配信に表示します。');
  } catch (error) { toast(error.message || previewError); }
}
$('show-letter').addEventListener('click', show);
function changeLivePage(delta) { mutate(s => { s.live.page = Math.max(0, Math.min(liveCount - 1, s.live.page + delta)); }); flush().catch(() => {}); }
$('live-prev').addEventListener('click', () => changeLivePage(-1)); $('live-next').addEventListener('click', () => changeLivePage(1));
$('preview-prev').addEventListener('click', () => { previewPage = Math.max(0, previewPage - 1); updatePreview(); });
$('preview-next').addEventListener('click', () => { previewPage = Math.min(previewCount - 1, previewPage + 1); updatePreview(); });
$('hide-live').addEventListener('click', () => { mutate(s => { s.live.visible = false; }); flush().catch(() => {}); });
$('finish-live').addEventListener('click', () => { previewPage = 0; mutate(Core.finishLive, true); flush().catch(() => {}); });
for (const [id, delta] of [['move-up', -1], ['move-down', 1]]) $(id).addEventListener('click', () => {
  mutate(s => Core.moveItem(s, s.selectedId, s.items.findIndex(item => item.id === s.selectedId) + delta), true);
});
$('toggle-done').addEventListener('click', () => mutate(s => { const item = s.items.find(item => item.id === s.selectedId); if (item) item.done = !item.done; }, true));
$('delete-letter').addEventListener('click', () => { mutate(s => Core.removeItem(s, s.selectedId), true); toast('一覧から削除しました。「一覧の操作を戻す」で復元できます。'); });
$('undo').addEventListener('click', () => { const previous = undoStack.pop(); if (previous) mutate(s => { const live = s.live; Object.assign(s, Core.clone(previous)); s.live = live; }); });
for (const key of ['font', 'fontSize', 'lineHeight', 'align', 'verticalAlign', 'textColor', 'outlineColor', 'outlineWidth', 'width', 'height', 'radius', 'innerPadding', 'background']) {
  $(key).addEventListener('change', () => {
    const value = ['font', 'align', 'verticalAlign', 'textColor', 'outlineColor', 'background'].includes(key) ? $(key).value : Number($(key).value);
    previewPage = 0; mutate(s => { s.style[key] = value; });
  });
}
for (const side of ['top', 'right', 'bottom', 'left']) $(`padding-${side}`).addEventListener('change', () => {
  const value = Number($(`padding-${side}`).value); previewPage = 0; mutate(s => { s.style.padding[side] = value; });
});
$('backgroundOpacity').addEventListener('input', () => { const value = Number($('backgroundOpacity').value) / 100; mutate(s => { s.style.backgroundOpacity = value; }); });
for (const key of ['showTitle', 'showPageNumber']) $(key).addEventListener('change', () => { const checked = $(key).checked; previewPage = 0; mutate(s => { s.style[key] = checked; }); });
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => mutate(s => {
  const name = button.dataset.theme;
  Object.assign(s.style, name === 'clear' ? {backgroundOpacity: 0, innerPadding: 0, outlineWidth: 2, textColor: '#ffffff'} :
    name === 'soft' ? {background: '#fff4e6', backgroundOpacity: .97, textColor: '#5b4637', outlineWidth: 0, innerPadding: 24, radius: 32} :
    {background: '#172437', backgroundOpacity: .94, textColor: '#ffffff', outlineWidth: 0, innerPadding: 24, radius: 24});
})));

function appendItems(items) {
  if (!items.length) throw new Error('追加するお便りが見つかりませんでした。');
  if (items.some(item => item.text.length > 12000)) throw new Error('1件のお便りは12,000文字以内にしてください。');
  if (state.items.length + items.length > 300) throw new Error('お便りは300件まで登録できます。');
  if (!mutate(s => { Core.saveDraft(s); s.items.push(...items); Core.selectItem(s, items[0].id); }, true)) {
    throw new Error('追加できませんでした。お便りの数と本文を確認してください。');
  }
  previewPage = 0; toast(`${items.length}件のお便りを追加しました。配信への表示は変わりません。`);
}
$('bulk-open').addEventListener('click', () => $('bulk-dialog').showModal());
$('bulk-add').addEventListener('click', () => { try { appendItems(Core.importText($('bulk-text').value)); $('bulk-dialog').close(); $('bulk-text').value = ''; } catch (error) { toast(error.message); } });
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
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('お便りと表示設定のバックアップを書き出しました。');
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
  if ($('bulk-dialog').open || !state) return;
  if (event.altKey && event.key === 'Enter') { event.preventDefault(); show(); }
  else if (event.key === 'Escape' && state.live.visible) { event.preventDefault(); $('hide-live').click(); }
  else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && state.live.visible) { event.preventDefault(); changeLivePage(event.key === 'ArrowRight' ? 1 : -1); }
});
new ResizeObserver(scalePreview).observe($('preview-viewport'));
window.addEventListener('beforeunload', event => { if (generation > savedGeneration) { event.preventDefault(); event.returnValue = ''; } });
poll();
