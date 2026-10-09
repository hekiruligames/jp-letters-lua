// SPDX-License-Identifier: GPL-2.0-or-later
// Shared state operations and layout for both the operator preview and OBS.
export const DEFAULT_STYLE = Object.freeze({
  width: 960, height: 540, font: 'Yu Gothic', fontSize: 48, lineHeight: 1.5,
  padding: { top: 40, right: 40, bottom: 40, left: 40 }, innerPadding: 24,
  textColor: '#ffffff', outlineColor: '#101827', outlineWidth: 0,
  background: '#172437', backgroundOpacity: .94, radius: 24,
  align: 'left', verticalAlign: 'center', showTitle: false, showPageNumber: true,
});
export const clone = value => JSON.parse(JSON.stringify(value));
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;
const colour = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : fallback;
const text = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\0/g, '') : '';
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function deadlineSignal(milliseconds) {
  if (globalThis.AbortSignal?.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal;
}

export function normalizeStyle(input = {}) {
  const s = input || {}, d = DEFAULT_STYLE;
  const padding = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side =>
    [side, Math.round(bounded(s.padding?.[side], 40, 0, 4096))]));
  return {
    width: Math.round(bounded(s.width, d.width, 320, 3840)),
    height: Math.round(bounded(s.height, d.height, 180, 2160)),
    font: text(s.font || d.font).slice(0, 120),
    fontSize: Math.round(bounded(s.fontSize, d.fontSize, 16, 128)),
    lineHeight: bounded(s.lineHeight, d.lineHeight, 1.1, 2.4), padding,
    innerPadding: Math.round(bounded(s.innerPadding, d.innerPadding, 0, 128)),
    textColor: colour(s.textColor, d.textColor), outlineColor: colour(s.outlineColor, d.outlineColor),
    outlineWidth: bounded(s.outlineWidth, d.outlineWidth, 0, 8),
    background: colour(s.background, d.background),
    backgroundOpacity: bounded(s.backgroundOpacity, d.backgroundOpacity, 0, 1),
    radius: Math.round(bounded(s.radius, d.radius, 0, 120)),
    align: ['left', 'center', 'right'].includes(s.align) ? s.align : d.align,
    verticalAlign: ['top', 'center', 'bottom'].includes(s.verticalAlign) ? s.verticalAlign : d.verticalAlign,
    showTitle: !!s.showTitle, showPageNumber: s.showPageNumber !== false,
  };
}

export function normalizeState(input = {}) {
  const items = [], ids = new Set();
  for (const item of input.items || []) {
    const content = text(item.text);
    if (content.length > 12000) throw new Error('1件のお便りは12,000文字以内にしてください。');
    if (!content.trim()) continue;
    let id = typeof item.id === 'string' && /^[\w-]{1,120}$/.test(item.id) ? item.id : uid();
    if (ids.has(id)) id = uid();
    ids.add(id);
    items.push({ id, title: text(item.title).slice(0, 100), text: content, done: !!item.done });
  }
  if (items.length > 300) throw new Error('お便りは300件まで登録できます。');
  const style = normalizeStyle(input.style), rawDraft = input.draft || {}, rawLive = input.live || {};
  if (text(rawDraft.text).length > 12000 || text(rawLive.text).length > 12000) {
    throw new Error('1件のお便りは12,000文字以内にしてください。');
  }
  const result = {version: 1, items, selectedId: ids.has(input.selectedId) ? input.selectedId : null,
    draft: {id: ids.has(rawDraft.id) ? rawDraft.id : null, title: text(rawDraft.title).slice(0, 100), text: text(rawDraft.text)},
    style, live: {visible: !!rawLive.visible && !!text(rawLive.text).trim(), id: rawLive.id || null,
      title: text(rawLive.title).slice(0, 100), text: text(rawLive.text),
      page: Math.round(bounded(rawLive.page, 0, 0, 9999)), style: rawLive.style ? normalizeStyle(rawLive.style) : null}};
  if (new TextEncoder().encode(JSON.stringify(result)).length > 800000) {
    throw new Error('一覧のデータが大きくなっています。バックアップを書き出し、お便りを配信ごとに分けてください。');
  }
  return result;
}

export function saveDraft(state) {
  if (!state.draft.text.trim()) return state;
  if (/^https?:\/\/(?:www\.)?marshmallow-qa\.com\/\S+\s*$/.test(state.draft.text)) {
    throw new Error('URLからの取得には未対応です。マシュマロの本文を貼り付けてください。');
  }
  const existing = state.items.find(item => item.id === state.draft.id);
  if (existing) { existing.text = state.draft.text; existing.title = state.draft.title; }
  else {
    if (state.items.length >= 300) throw new Error('お便りは300件まで登録できます。');
    const item = {id: uid(), title: state.draft.title, text: state.draft.text, done: false};
    state.items.push(item); state.draft.id = item.id;
  }
  state.selectedId = state.draft.id;
  return state;
}
export function selectItem(state, id) {
  saveDraft(state);
  const item = state.items.find(item => item.id === id);
  if (!item) return state;
  state.selectedId = id;
  state.draft = {id, text: item.text, title: item.title};
  return state;
}
export function newDraft(state) {
  saveDraft(state); state.selectedId = null; state.draft = {id: null, title: '', text: ''}; return state;
}
export function showDraft(state) {
  if (!state.draft.text.trim()) throw new Error('表示するお便りの本文を入力してください。');
  saveDraft(state);
  state.live = {visible: true, id: state.draft.id, text: state.draft.text, title: state.draft.title,
    page: 0, style: clone(state.style)};
  return state;
}
export function finishLive(state) {
  const item = state.items.find(item => item.id === state.live.id);
  if (item) item.done = true;
  const index = state.items.findIndex(item => item.id === state.live.id);
  if (state.draft.id !== state.live.id && state.draft.text.trim()) { state.live.visible = false; return state; }
  const next = state.items.slice(index + 1).find(item => !item.done) || state.items.find(item => !item.done);
  state.live.visible = false;
  if (next) selectItem(state, next.id);
  return state;
}
export function moveItem(state, id, destination) {
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) return state;
  const [item] = state.items.splice(index, 1);
  state.items.splice(Math.max(0, Math.min(state.items.length, destination)), 0, item);
  return state;
}
export function removeItem(state, id) {
  state.items = state.items.filter(item => item.id !== id);
  if (state.draft.id === id) { state.draft = {id: null, title: '', text: ''}; state.selectedId = null; }
  // The aired text is an independent snapshot; deleting a queue item doesn't replace it.
  return state;
}
export const label = item => item.title || item.text.replace(/\s+/g, ' ').slice(0, 28) || '新しいお便り';

export function importText(input) {
  const value = text(input).replace(/^\uFEFF/, '');
  return value.split(/^[ \t]*(?:---|\/\/\/)[ \t]*$/m)
    .map(part => part.replace(/^\n+|\n+$/g, '')).filter(part => part.trim())
    .map(content => ({id: uid(), title: '', text: content, done: false}));
}
export function importJson(input) {
  const parsed = JSON.parse(input.replace(/^\uFEFF/, ''));
  const items = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(items)) throw new Error('お便りの一覧を含むJSONファイルを選んでください。');
  return normalizeState({items: items.map(item => ({...(typeof item === 'string' ? {text: item} : item), id: uid(), done: false}))}).items;
}

const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter('ja', {granularity: 'grapheme'}) : null;
function graphemes(value) {
  if (segmenter) return Array.from(segmenter.segment(value), entry => entry.segment);
  // Older engines: retain combining marks, variation selectors, emoji modifiers and ZWJ chains.
  const parts = [];
  for (const cp of Array.from(value)) {
    const previous = parts[parts.length - 1];
    if (previous && (/\p{Mark}|[\uFE0E\uFE0F\u200D]|[\u{1F3FB}-\u{1F3FF}]/u.test(cp) || previous.endsWith('\u200D'))) {
      parts[parts.length - 1] += cp;
    } else parts.push(cp);
  }
  return parts;
}
const noStart = /^[、。，．・：；？！ー〜～）〕］｝〉》」』】〙〗’”»ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/u;
const noEnd = /[（〔［｛〈《「『【〘〖‘“«]$/u;
const pageCache = new Map();

function fontStack(style) {
  return `"${style.font.replace(/["\\]/g, '')}", "Yu Gothic", YuGothic, "Noto Sans CJK JP", sans-serif`;
}
function rgba(hex, opacity) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${opacity})`;
}
function geometry(style) {
  const p = style.padding, inner = style.innerPadding;
  const cardWidth = style.width - p.left - p.right;
  const cardHeight = style.height - p.top - p.bottom;
  const header = style.showTitle ? Math.ceil(style.fontSize * .58) + 12 : 0;
  const footer = style.showPageNumber ? 28 : 0;
  return {cardWidth, cardHeight, header, footer,
    width: cardWidth - 2 * inner - 2 * style.outlineWidth,
    height: cardHeight - 2 * inner - header - footer - 2 * style.outlineWidth};
}
function styleText(node, style) {
  Object.assign(node.style, {fontFamily: fontStack(style), fontSize: `${style.fontSize}px`,
    lineHeight: String(style.lineHeight), textAlign: style.align, color: style.textColor,
    WebkitTextStroke: `${style.outlineWidth}px ${style.outlineColor}`, paintOrder: 'stroke fill'});
}

export async function paginate(content, rawStyle, {signal} = {}) {
  const style = normalizeStyle(rawStyle), key = JSON.stringify([content, style]);
  if (pageCache.has(key)) return pageCache.get(key);
  const g = geometry(style);
  if (g.width < style.fontSize || g.height < style.fontSize * style.lineHeight) {
    throw new Error('文字を置く領域が足りません。枠を広げるか、余白・文字サイズを小さくしてください。');
  }
  await document.fonts.load(`${style.fontSize}px ${fontStack(style)}`, content.slice(0, 100) || '日本語');
  const measure = document.createElement('div');
  measure.className = 'letter-text letter-measure';
  styleText(measure, style);
  measure.style.width = `${g.width}px`;
  document.body.append(measure);
  const pieces = graphemes(content), pages = [];
  const fits = (start, end) => {
    measure.textContent = pieces.slice(start, end).join('');
    return measure.getBoundingClientRect().height <= g.height + .01 && measure.scrollWidth <= Math.ceil(g.width);
  };
  try {
    let start = 0;
    while (start < pieces.length) {
      if (signal?.aborted) throw new DOMException('preview superseded', 'AbortError');
      // Bracket one page locally. Searching the whole remaining letter for
      // every page would become quadratic for small frames and long letters.
      const estimate = Math.max(1, Math.ceil(g.width / style.fontSize * g.height / (style.fontSize * style.lineHeight)));
      let lo = start + 1, hi = Math.min(pieces.length, start + estimate), end = start;
      while (fits(start, hi)) {
        end = hi;
        if (hi === pieces.length) break;
        lo = hi + 1; hi = Math.min(pieces.length, start + 2 * (hi - start));
      }
      if (end === pieces.length) lo = pieces.length + 1;
      while (lo <= hi) {
        const middle = Math.floor((lo + hi) / 2);
        if (fits(start, middle)) { end = middle; lo = middle + 1; }
        else hi = middle - 1;
      }
      if (end <= start) throw new Error('この文字が枠に収まりません。枠または文字サイズを調整してください。');
      if (end < pieces.length) {
        // Prefer a paragraph boundary near the bottom, without dropping explicit newlines.
        const minimum = start + Math.floor((end - start) * .7);
        for (let at = end - 1; at >= minimum; at--) {
          if (pieces[at] === '\n') { end = at + 1; break; }
        }
        // Basic page-boundary kinsoku, in addition to CSS strict Japanese line breaking.
        while (end > start + 1 && (noStart.test(pieces[end] || '') || noEnd.test(pieces[end - 1]))) end--;
        // Keep a Latin word on the following page where a recent space is available.
        if (/[\p{Letter}\p{Number}]/u.test(pieces[end - 1]) && /^[a-zA-Z0-9]/.test(pieces[end] || '')) {
          for (let at = end - 1; at >= minimum; at--) {
            if (/\s/.test(pieces[at])) { end = at + 1; break; }
          }
        }
      }
      pages.push(pieces.slice(start, end).join('')); start = end;
      if (pages.length % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { measure.remove(); }
  if (!pages.length) pages.push('');
  if (pageCache.size > 40) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(key, pages);
  return pages;
}

export async function renderLetter(host, value, rawStyle, page = 0, options = {}) {
  const style = normalizeStyle(rawStyle), content = text(value.text), pages = await paginate(content, style, options);
  const index = Math.min(pages.length - 1, Math.max(0, page)), g = geometry(style);
  const frame = document.createElement('div'); frame.className = 'letter-frame';
  frame.style.width = `${style.width}px`; frame.style.height = `${style.height}px`;
  const card = document.createElement('div'); card.className = 'letter-card';
  Object.assign(card.style, {left: `${style.padding.left}px`, top: `${style.padding.top}px`,
    width: `${g.cardWidth}px`, height: `${g.cardHeight}px`, padding: `${style.innerPadding}px`,
    borderRadius: `${style.radius}px`, background: rgba(style.background, style.backgroundOpacity),
    color: style.textColor, fontFamily: fontStack(style)});
  if (style.showTitle) {
    const title = document.createElement('div'); title.className = 'letter-title';
    title.textContent = value.title || 'お便り'; title.style.fontSize = `${Math.ceil(style.fontSize * .4)}px`;
    title.style.height = `${g.header}px`; card.append(title);
  }
  const viewport = document.createElement('div'); viewport.className = 'letter-viewport';
  viewport.style.height = `${g.height + 2 * style.outlineWidth}px`;
  viewport.style.justifyContent = {top: 'flex-start', center: 'center', bottom: 'flex-end'}[style.verticalAlign];
  const body = document.createElement('div'); body.className = 'letter-text'; styleText(body, style);
  body.style.margin = `${style.outlineWidth}px`; body.textContent = pages[index]; viewport.append(body); card.append(viewport);
  if (style.showPageNumber) {
    const footer = document.createElement('div'); footer.className = 'letter-footer';
    footer.textContent = pages.length > 1 ? `${index + 1} / ${pages.length}` : '';
    footer.style.height = `${g.footer}px`; card.append(footer);
  }
  frame.append(card); host.replaceChildren(frame);
  return {pages, page: index, frame};
}
