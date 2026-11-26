// SPDX-License-Identifier: GPL-2.0-or-later
// Shared state operations and layout for both the operator preview and OBS.
import {normalizeUI} from './themes.js';
export const MAX_ICON_DATA_URL = 180000;
export const MAX_GROUP_MEMBERS = 16;
export const groupColumns = (layout,count) => layout==='horizontal'?count:layout==='vertical'?1:Math.ceil(Math.sqrt(count));
export const DEFAULT_STYLE = Object.freeze({
  width: 960, height: 540, font: 'Yu Gothic', fontSize: 32, lineHeight: 1.5,
  padding: { top: 16, right: 16, bottom: 16, left: 16 }, innerPadding: 24,
  textColor: '#222222', outlineColor: '#101827', outlineWidth: 0,
  background: '#ffffff', backgroundOpacity: 1, radius: 24,
  frameBackground: '#f3969a', frameBackgroundOpacity: 0, design: 'standard',
  iconData: '', iconName: '', showIcon: false, showServiceLabel: true, serviceLabel: 'マシュマロ',
  align: 'left', verticalAlign: 'top', showTitle: false, showPageNumber: true,
  readingMode: 'pages', autoHeight: false,
});
export const clone = value => JSON.parse(JSON.stringify(value));
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;
const colour = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : fallback;
const text = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\0/g, '') : '';
const iconData = value => typeof value === 'string' && value.length <= MAX_ICON_DATA_URL &&
  /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value) ? value : '';
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function deadlineSignal(milliseconds) {
  if (globalThis.AbortSignal?.timeout) return AbortSignal.timeout(milliseconds);
  const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal;
}

export function normalizeStyle(input = {}) {
  const s = input || {}, d = DEFAULT_STYLE;
  const padding = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side =>
    [side, Math.round(bounded(s.padding?.[side], d.padding[side], 0, 4096))]));
  const image = iconData(s.iconData);
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
    frameBackground: colour(s.frameBackground, d.frameBackground),
    frameBackgroundOpacity: bounded(s.frameBackgroundOpacity, d.frameBackgroundOpacity, 0, 1),
    design: s.design === 'marshmallow' ? 'marshmallow' : 'standard',
    iconData: image, iconName: text(s.iconName).replace(/\n/g, ' ').slice(0, 160), showIcon: !!s.showIcon && !!image,
    showServiceLabel: s.showServiceLabel !== false,
    serviceLabel: typeof s.serviceLabel === 'string'
      ? Array.from(text(s.serviceLabel).replace(/\s+/g, ' ').trim()).slice(0, 40).join('')
      : d.serviceLabel,
    align: ['left', 'center', 'right'].includes(s.align) ? s.align : d.align,
    verticalAlign: ['top', 'center', 'bottom'].includes(s.verticalAlign) ? s.verticalAlign : d.verticalAlign,
    showTitle: !!s.showTitle, showPageNumber: s.showPageNumber !== false,
    readingMode: s.readingMode === 'scroll' ? 'scroll' : 'pages', autoHeight: !!s.autoHeight,
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
    const replyNote = text(item.replyNote).slice(0, 4000);
    items.push({ id, title: text(item.title).slice(0, 100), text: content, done: !!item.done, ...(replyNote ? {replyNote} : {}) });
  }
  if (items.length > 300) throw new Error('お便りは300件まで登録できます。');
  const groups = [], grouped = new Set(), groupIds = new Set(), groupNumbers = new Set();
  const rawGroups = Array.isArray(input.groups) ? input.groups : [];
  const reservedNumbers = new Set(rawGroups.map(g=>g?.number).filter(n=>Number.isInteger(n)&&n>0&&n<=999999));
  for (const raw of rawGroups) {
    if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(raw.id) || groupIds.has(raw.id)) continue;
    const members = [...new Set(Array.isArray(raw.members) ? raw.members.map(m=>m?.id) : [])].filter(id => ids.has(id) && !grouped.has(id)).slice(0,MAX_GROUP_MEMBERS);
    if (members.length < 2) continue;
    groupIds.add(raw.id); members.forEach(id => grouped.add(id));
    let number=raw.number;
    if(!Number.isInteger(number)||number<1||number>999999||groupNumbers.has(number)){
      number=1;while(groupNumbers.has(number)||reservedNumbers.has(number))number++;
    }
    groupNumbers.add(number);
    const replyNote=text(raw.replyNote).slice(0,4000);
    groups.push({id:raw.id,number,title:text(raw.title).slice(0,100),members:members.map(id=>({id})),layout:['vertical','horizontal','grid'].includes(raw.layout) ? raw.layout : 'grid',...(replyNote?{replyNote}:{})});
  }
  const style = normalizeStyle(input.style), rawDraft = input.draft || {}, rawLive = input.live || {};
  if (text(rawDraft.text).length > 12000 || text(rawLive.text).length > 12000) {
    throw new Error('1件のお便りは12,000文字以内にしてください。');
  }
  const result = {version: 1, items, selectedId: ids.has(input.selectedId) ? input.selectedId : null,
    draft: {id: ids.has(rawDraft.id) ? rawDraft.id : null, title: text(rawDraft.title).slice(0, 100), text: text(rawDraft.text), ...(text(rawDraft.replyNote) ? {replyNote: text(rawDraft.replyNote).slice(0,4000)} : {})},
    style, ui: normalizeUI(input.ui), live: {visible: !!rawLive.visible && !!text(rawLive.text).trim(), id: rawLive.id || null,
      title: text(rawLive.title).slice(0, 100), text: text(rawLive.text),
      page: Math.round(bounded(rawLive.page, 0, 0, 9999)), scroll: bounded(rawLive.scroll, 0, 0, 1),
      style: rawLive.style ? normalizeStyle(rawLive.style) : null}};
  if (groups.length) result.groups = groups;
  const group = groups.find(g=>g.id===rawDraft.groupId && g.members.some(m=>m.id===result.draft.id));
  if (group) result.draft.groupId = group.id;
  const cards = Array.isArray(rawLive.groupCards) ? rawLive.groupCards.slice(0,MAX_GROUP_MEMBERS).filter(c=>c && typeof c.id==='string' && text(c.text).trim() && text(c.text).length<=12000).map(c=>({id:c.id,title:text(c.title).slice(0,100),text:text(c.text)})) : [];
  if (cards.length>=2 && typeof rawLive.groupId==='string') {
    result.live.groupId=rawLive.groupId; result.live.groupCards=cards;
    result.live.groupTitle=text(rawLive.groupTitle).slice(0,100);
    if(Number.isInteger(rawLive.groupNumber)&&rawLive.groupNumber>0)result.live.groupNumber=rawLive.groupNumber;
    result.live.groupLayout=['vertical','horizontal','grid'].includes(rawLive.groupLayout)?rawLive.groupLayout:'grid';
    if (result.live.style) {result.live.style.readingMode='pages';result.live.style.autoHeight=false;}
  }
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
  if (existing) { existing.text = state.draft.text; existing.title = state.draft.title; if (state.draft.replyNote) existing.replyNote = state.draft.replyNote; else delete existing.replyNote; }
  else {
    if (state.items.length >= 300) throw new Error('お便りは300件まで登録できます。');
    const item = {id: uid(), title: state.draft.title, text: state.draft.text, done: false, ...(state.draft.replyNote ? {replyNote:state.draft.replyNote} : {})};
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
  state.draft = {id, text: item.text, title: item.title, ...(item.replyNote ? {replyNote:item.replyNote} : {})};
  return state;
}
export function newDraft(state) {
  saveDraft(state); state.selectedId = null; state.draft = {id: null, title: '', text: ''}; return state;
}
export function selectGroup(state, groupId) {
  const group = state.groups?.find(g=>g.id===groupId);
  if (!group) return state;
  selectItem(state,group.members[0].id); state.draft.groupId=group.id;
  return state;
}
export function preparedValue(state) {
  const group = state.groups?.find(g=>g.id===state.draft.groupId);
  if (!group) return state.draft;
  const groupCards=group.members.map(m=>state.items.find(i=>i.id===m.id)).filter(Boolean)
    .map(i=>({id:i.id,title:i.id===state.draft.id?state.draft.title:i.title,text:i.id===state.draft.id?state.draft.text:i.text}));
  if(groupCards.length<2)return state.draft;
  return {...state.draft,groupId:group.id,groupNumber:group.number,groupTitle:group.title,groupLayout:group.layout,groupCards};
}
export const presentationId = value => value.groupId ? 'group:'+value.groupId : value.id;
export function showDraft(state, liveStyle = state.style) {
  if (!state.draft.text.trim()) throw new Error('表示するお便りの本文を入力してください。');
  saveDraft(state);
  state.live = {visible: true, id: state.draft.id, text: state.draft.text, title: state.draft.title,
    page: 0, scroll: 0, style: clone(liveStyle)};
  const prepared = preparedValue(state);
  if (prepared.groupCards) Object.assign(state.live,{groupId:prepared.groupId,groupNumber:prepared.groupNumber,groupTitle:prepared.groupTitle,groupLayout:prepared.groupLayout,groupCards:clone(prepared.groupCards)});
  return state;
}
export function finishLive(state) {
  const aired = new Set(state.live.groupCards?.map(c=>c.id) || [state.live.id]);
  for(const item of state.items) if(aired.has(item.id)) item.done=true;
  const index=state.items.findIndex(item=>item.id===state.live.id);
  const prepared=preparedValue(state);
  if (presentationId(prepared)!==presentationId(state.live) && prepared.text.trim() && !aired.has(prepared.id)) {state.live.visible=false;return state;}
  const next = state.items.slice(index+1).find(item=>!item.done) || state.items.find(item=>!item.done);
  state.live.visible=false;
  if(next) {
    const group=state.groups?.find(g=>g.members.some(m=>m.id===next.id));
    if(group)selectGroup(state,group.id);else selectItem(state,next.id);
  }
  return state;
}
export function moveItem(state, id, destination) {
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) return state;
  const [item] = state.items.splice(index, 1);
  state.items.splice(Math.max(0, Math.min(state.items.length, destination)), 0, item);
  return state;
}
// Reorder only queue items; retain original relative order within the selected block.
export function moveItems(state, ids, mode, target = 0) {
  const selected = new Set(ids);
  const items = state.items;
  if (!items.some(item => selected.has(item.id))) return state;
  if (mode === 'up' || mode === 'down') {
    const step = mode === 'up' ? -1 : 1;
    for (let i = step < 0 ? 1 : items.length - 2; i >= 0 && i < items.length; i -= step) {
      const j = i + step;
      if (j >= 0 && j < items.length && selected.has(items[i].id) && !selected.has(items[j].id)) {
        [items[i], items[j]] = [items[j], items[i]];
      }
    }
  } else {
    const block = items.filter(item => selected.has(item.id));
    const rest = items.filter(item => !selected.has(item.id));
    const position = mode === 'first' ? 0 : mode === 'last' ? rest.length :
      mode === 'before' ? rest.findIndex(item => item.id === target) :
      mode === 'position' && Number.isInteger(target) ? target : -1;
    if (position < 0 || position > rest.length) return state;
    rest.splice(position, 0, ...block);
    state.items = rest;
  }
  return state;
}
export function removeItem(state, id) {
  return removeItems(state, [id]);
}
export function removeItems(state, ids) {
  const targets = new Set(ids);
  state.items = state.items.filter(item => !targets.has(item.id));
  if (targets.has(state.draft.id)) { state.draft = {id: null, title: '', text: ''}; state.selectedId = null; }
  // The aired text is an independent snapshot; deleting a queue item doesn't replace it.
  return state;
}
export const label = item => (item.groupId && item.groupCards ? (item.groupNumber ? '組'+item.groupNumber+' ' : '') + (item.groupTitle || 'まとめたお便り') + '（'+item.groupCards.length+'件）' : '') || item.title || item.text.replace(/\s+/g, ' ').slice(0, 28) || '新しいお便り';

export function applyDisplayPreset(style, name) {
  if (name === 'clear') {
    Object.assign(style, {design: 'standard', frameBackgroundOpacity: 0, backgroundOpacity: 0, outlineWidth: 8});
  } else if (name === 'marshmallow' || name === 'maro') {
    Object.assign(style, {design: 'marshmallow', frameBackground: '#f3969a', frameBackgroundOpacity: 1,
      background: '#ffffff', backgroundOpacity: 1, textColor: '#000000', outlineWidth: 0,
      showServiceLabel: true, padding: {top: 16, right: 16, bottom: 64, left: 16}});
  } else {
    Object.assign(style, {design: 'standard', frameBackgroundOpacity: 0, background: '#ffffff', backgroundOpacity: 1,
      textColor: '#222222', outlineWidth: 0});
  }
  return style;
}

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
const fontFaces = new Map();
let fontSequence = 0;

export function fontStatus(family) { return fontFaces.get(family)?.status || {loaded: false, pending: true}; }
async function ensureFont(family) {
  if (fontFaces.has(family)) return fontFaces.get(family).promise;
  const entry = {status: {loaded: false, pending: true}, face: null};
  fontFaces.set(family, entry);
  entry.promise = (async () => {
    try {
      const token = new URLSearchParams(location.search).get('token');
      const started = Date.now();
      let response;
      do {
        response = await fetch(`/api/font?name=${encodeURIComponent(family)}`, {
          headers: {'X-OBS-Letters-Token': token || ''}, cache: 'no-store', signal: deadlineSignal(15000)});
        if (response.status === 202) {
          if (Date.now() - started > 20000) throw new Error('フォントの読み込みに時間がかかっています。');
          await response.text(); await new Promise(resolve => setTimeout(resolve, 100));
        }
      } while (response.status === 202);
      if (!response.ok) throw new Error(await response.text());
      const alias = `jp-letters-font-${++fontSequence}`;
      const face = new FontFace(alias, await response.arrayBuffer(), {weight: '500'});
      await face.load(); document.fonts.add(face); entry.face = face;
      entry.status = {loaded: true, pending: false, alias};
    } catch (error) {
      entry.status = {loaded: false, pending: false, reason: error.message};
    }
    if (fontFaces.size > 8) {
      for (const [name, old] of fontFaces) {
        if (name !== family && !old.status.pending) {
          if (old.face) document.fonts.delete(old.face);
          fontFaces.delete(name);
          if (fontFaces.size <= 8) break;
        }
      }
    }
    return entry.status;
  })();
  return entry.promise;
}

function fontStack(style) {
  const alias = fontStatus(style.font).alias;
  return `${alias ? `"${alias}", ` : ''}"${style.font.replace(/[\x00-\x1f\x7f"\\]/g, '')}", "Yu Gothic", YuGothic, "Noto Sans CJK JP", sans-serif`;
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

const metricsCache = new Map();
async function measureText(content, style) {
  await ensureFont(style.font);
  const g = geometry(style), key = JSON.stringify([content, g.width, fontStack(style), style.fontSize, style.lineHeight, style.outlineWidth]);
  if (g.width < style.fontSize) throw new Error('文字を置く領域が足りません。枠を広げるか、余白・文字サイズを小さくしてください。');
  if (metricsCache.has(key)) return metricsCache.get(key);
  await document.fonts.load(`500 ${style.fontSize}px ${fontStack(style)}`, content.slice(0, 100) || '日本語');
  const measure = document.createElement('div'); measure.className = 'letter-text letter-measure';
  styleText(measure, style); measure.style.width = `${g.width}px`; measure.textContent = content;
  document.body.append(measure);
  const result = {height: measure.getBoundingClientRect().height, width: measure.scrollWidth}; measure.remove();
  if (metricsCache.size >= 40) metricsCache.delete(metricsCache.keys().next().value);
  metricsCache.set(key, result); return result;
}

export async function prepareStyle(content, rawStyle) {
  const style = normalizeStyle(rawStyle);
  await ensureFont(style.font);
  if (!style.autoHeight || !content.trim()) return style;
  const metrics = await measureText(content, style), g = geometry(style);
  const desired = Math.ceil(metrics.height + style.padding.top + style.padding.bottom + 2 * style.innerPadding +
    2 * style.outlineWidth + g.header + g.footer);
  style.height = Math.min(style.height, Math.max(180, desired));
  return style;
}

export async function paginate(content, rawStyle, {signal} = {}) {
  const style = normalizeStyle(rawStyle);
  await ensureFont(style.font);
  const key = JSON.stringify([content, style, fontStack(style)]);
  if (pageCache.has(key)) return pageCache.get(key);
  const g = geometry(style);
  if (g.width < style.fontSize || g.height < style.fontSize * style.lineHeight) {
    throw new Error('文字を置く領域が足りません。枠を広げるか、余白・文字サイズを小さくしてください。');
  }
  await document.fonts.load(`500 ${style.fontSize}px ${fontStack(style)}`, content.slice(0, 100) || '日本語');
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
  const content = text(value.text), style = options.prepared ? normalizeStyle(rawStyle) : await prepareStyle(content, rawStyle);
  await ensureFont(style.font);
  const pages = style.readingMode === 'scroll' ? [content] : await paginate(content, style, options);
  const index = Math.min(pages.length - 1, Math.max(0, page)), g = geometry(style);
  if (g.height < style.fontSize * style.lineHeight) throw new Error('文字を置く領域が足りません。枠を広げるか、余白・文字サイズを小さくしてください。');
  const metrics = style.readingMode === 'scroll' ? await measureText(content, style) : null;
  const scrollMax = metrics ? Math.max(0, metrics.height - g.height) : 0;
  const frame = document.createElement('div'); frame.className = 'letter-frame';
  frame.dataset.design = style.design;
  Object.assign(frame.style, {width: `${style.width}px`, height: `${style.height}px`,
    background: rgba(style.frameBackground, style.frameBackgroundOpacity)});
  frame.dataset.scrollMax = String(scrollMax);
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
  viewport.style.justifyContent = scrollMax > 0 ? 'flex-start' : {top: 'flex-start', center: 'center', bottom: 'flex-end'}[style.verticalAlign];
  if (style.readingMode === 'scroll') viewport.classList.add('scroll-mode');
  const body = document.createElement('div'); body.className = 'letter-text'; styleText(body, style);
  body.style.margin = `${style.outlineWidth}px`; body.textContent = pages[index]; viewport.append(body); card.append(viewport);
  if (style.showPageNumber) {
    const footer = document.createElement('div'); footer.className = 'letter-footer';
    footer.textContent = style.readingMode === 'scroll' && scrollMax > 0 ? `${Math.round((value.scroll || 0) * 100)}%` :
      pages.length > 1 ? `${index + 1} / ${pages.length}` : '';
    footer.style.height = `${g.footer}px`; card.append(footer);
  }
  if (style.design === 'marshmallow' && style.showServiceLabel && style.serviceLabel) {
    const service = document.createElement('div'); service.className = 'letter-service-label';
    service.textContent = style.serviceLabel; card.append(service);
  }
  frame.append(card);
  if (style.showIcon && style.iconData && style.padding.bottom > 0) {
    const slot = document.createElement('div'); slot.className = 'letter-icon-slot';
    slot.style.height = `${style.padding.bottom}px`;
    const image = document.createElement('img'); image.className = 'letter-icon'; image.alt = '';
    image.src = style.iconData; image.style.maxHeight = `${Math.max(0, style.padding.bottom - 16)}px`;
    image.style.maxWidth = `${Math.max(0, Math.min(g.cardWidth, style.padding.bottom * 1.7))}px`;
    image.addEventListener('error', () => slot.remove(), {once: true});
    slot.append(image); frame.append(slot);
  }
  host.replaceChildren(frame);
  if (style.readingMode === 'scroll') setScroll(frame, value.scroll || 0, false);
  return {pages, page: index, frame, style, scrollMax, viewportHeight: g.height};
}

export function setScroll(frame, position, smooth = true) {
  const body = frame.querySelector('.letter-text'), maximum = Number(frame.dataset.scrollMax) || 0;
  const fraction = bounded(position, 0, 0, 1);
  body.style.transition = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'transform 180ms ease-out' : 'none';
  body.style.transform = `translateY(${-maximum * fraction}px)`;
  const footer = frame.querySelector('.letter-footer');
  if (footer) footer.textContent = maximum > 0 ? `${Math.round(fraction * 100)}%` : '';
}
 
// Group canvas uses the same card renderer, with synchronized pagination.
export async function renderPresentation(host, value, rawStyle, page=0, options={}) {
  const cards=value.groupCards;
  if (!cards || cards.length<2) return renderLetter(host,value,rawStyle,page,options);
  if(cards.some(card=>!card.text.trim()))throw new Error('グループ内の本文が空です。');
  const style=normalizeStyle({...rawStyle,autoHeight:false,readingMode:'pages'});
  const layout=value.groupLayout, columns=groupColumns(layout,cards.length);
  const rows=Math.ceil(cards.length/columns), gap=Math.min(12,Math.max(2,Math.floor(Math.min(style.width/columns,style.height/rows)*.04)));
  const width=Math.floor((style.width-gap*(columns-1))/columns),height=Math.floor((style.height-gap*(rows-1))/rows);
  // Render at a safe logical size, then uniformly fit the card into its cell.
  // This allows crowd/overview shots without clipping the text or changing the source size.
  const logicalScale=Math.max(1,320/width,180/height);
  const logicalWidth=Math.min(3840,Math.ceil(width*logicalScale)), logicalHeight=Math.min(2160,Math.ceil(height*logicalScale));
  const fit=Math.min(width/logicalWidth,height/logicalHeight,1);
  const childStyle=normalizeStyle({...style,width:logicalWidth,height:logicalHeight,frameBackgroundOpacity:0,showIcon:false,
    padding:{top:8,right:8,bottom:8,left:8},innerPadding:Math.min(style.innerPadding,16)});
  const frame=document.createElement('div');frame.className='letter-frame letter-group-frame';
  Object.assign(frame.style,{width:style.width+'px',height:style.height+'px',background:rgba(style.frameBackground,style.frameBackgroundOpacity),
    display:'grid',gridTemplateColumns:'repeat('+columns+','+width+'px)',gridTemplateRows:'repeat('+rows+','+height+'px)',gap:gap+'px'});
  let count=1;
  for (const card of cards) {
    const cell=document.createElement('div');cell.className='letter-group-cell';
    Object.assign(cell.style,{width:width+'px',height:height+'px',position:'relative',overflow:'hidden'});
    const result=await renderLetter(cell,card,childStyle,page,{...options,prepared:true});
    Object.assign(result.frame.style,{position:'absolute',left:((width-logicalWidth*fit)/2)+'px',top:((height-logicalHeight*fit)/2)+'px',transformOrigin:'top left',transform:'scale('+fit+')'});
    count=Math.max(count,result.pages.length);frame.append(cell);
  }
  host.replaceChildren(frame);
  return {frame,style,pages:Array(count).fill(''),page:Math.max(0,Math.min(count-1,page)),scrollMax:0,viewportHeight:height};
}
