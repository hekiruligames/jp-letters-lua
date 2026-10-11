// SPDX-License-Identifier: GPL-2.0-or-later
import {importText} from './core.js';

const normalise = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/^\uFEFF/, '') : '';
export const MAX_IMPORT_CANDIDATES = 500;
export const importKey = value => normalise(value).trim();
export function importProblem(value) {
  const content = normalise(value);
  if (!content.trim()) return '本文が空です。';
  if (content.length > 12000) return '12,000文字以内に編集してください。';
  if (/^https?:\/\/(?:www\.)?marshmallow-qa\.com\/\S+\s*$/.test(content.trim())) return 'URLではなく、お便りの本文をコピーしてください。';
  return '';
}

// Clipboard markup stays in an inert template. It is never attached to the
// document, displayed as HTML, or used to fetch pages, images or credentials.
function cardText(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(node.tagName)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
  return [...node.childNodes].map(child => {
    const content = cardText(child);
    return ['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE'].includes(child.nodeName) ? `\n${content}\n` : content;
  }).join('');
}

function candidates(texts, method, note, select = true) {
  if (texts.length > MAX_IMPORT_CANDIDATES) throw new Error('一度に確認できるのは500件までです。コピーする範囲を分けてください。');
  return {texts, method, note, select};
}

// Native browser copies can discard classes and data-* attributes while keeping
// links. Match only individual question links, never image/action/answer URLs.
function questionLink(node) {
  try {
    const url = new URL(node.getAttribute('href'), 'https://marshmallow-qa.com');
    return url.origin === 'https://marshmallow-qa.com' && !url.username && !url.password &&
      /^\/messages\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(url.pathname);
  } catch { return false; }
}

// A conservative fallback for the Japanese unread inbox shown by the user.
// Ambiguous timestamp lines or an unfinished last letter keep the entire raw
// copy in manual review. Heuristic candidates always start unselected.
function inboxText(raw) {
  const footer = /^[ \t\u00a0]*画像ダウンロード[ \t\u00a0\n|]*確認済みにする[ \t\u00a0]*(?=\n|$)/gm;
  const timestamp = /^(?:たった今|(?:\d+|数)(?:秒|分|時間|日|週間|か月|ヶ月|ヵ月|月|年)(?:未満)?前)$/;
  const texts = []; let start = 0;
  for (const match of raw.matchAll(footer)) {
    const lines = raw.slice(start, match.index).split('\n');
    const dates = lines.map((line, index) => timestamp.test(line.trim()) ? index : -1).filter(index => index >= 0);
    if (dates.length !== 1) return null;
    const body = lines.slice(dates[0] + 1).join('\n').trim();
    if (!body) return null;
    texts.push(body); start = match.index + match[0].length;
    if (texts.length > MAX_IMPORT_CANDIDATES) throw new Error('一度に確認できるのは500件までです。コピーする範囲を分けてください。');
  }
  if (!texts.length || raw.slice(start).split('\n').some(line => timestamp.test(line.trim()))) return null;
  return candidates(texts, 'inbox-text', '日時と「画像ダウンロード／確認済みにする」を目印に候補を作りました。本文や件数を確認してから、取り込むものにチェックしてください。', false);
}

export function analysePaste({text, html = '', mode = 'inbox'}) {
  const raw = normalise(text);
  if (new TextEncoder().encode(raw).length > 1000000 || new TextEncoder().encode(html).length > 1000000) {
    throw new Error('一度に貼り付ける内容は1MB以内にしてください。受信箱の一部をコピーして試してください。');
  }
  if (mode === 'inbox') {
    const found = inboxText(raw); if (found) return found;
  }
  if (mode === 'inbox' && html) {
    const template = document.createElement('template'); template.innerHTML = html;
    const cards = [...template.content.querySelectorAll('.message-card__text')];
    if (cards.length) {
      // Empty/unsupported cards remain visible in review instead of disappearing.
      return candidates(cards.map(card => normalise(cardText(card)).trim()), 'cards',
        '個別カードの本文欄を見つけました。本文と改行を確認し、取り込むものを選んでください。');
    }
    const links = [...template.content.querySelectorAll('a[href]')].filter(questionLink);
    if (links.length) return candidates(links.map(link => normalise(cardText(link)).trim()), 'links',
      'メッセージへのリンクから本文候補を取り出しました。本文・改行・件数を確認し、取り込むものを選んでください。');
  }
  if (!raw.trim()) throw new Error('先にお便りを貼り付けてください。');
  if (mode === 'separated') {
    return candidates(importText(raw).map(item => item.text), 'separated',
      '区切りごとに候補を作りました。本文内の空行は段落として残しています。');
  }
  return candidates([raw], 'unrecognised',
    'お便りの区切りを判別できませんでした。原文を1件の候補として残しています。不要な部分を編集し、必要ならカーソル位置で分けてからチェックしてください。', false);
}
