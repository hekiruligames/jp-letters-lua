// SPDX-License-Identifier: GPL-2.0-or-later
export const UI_THEMES = Object.freeze({
  blue: {name: 'ブルー（いまの配色）', background: '#f3f6fa', panel: '#ffffff', accent: '#3468d4', text: '#263349'},
  sakura: {name: 'サクラ', background: '#fff1f6', panel: '#fffafb', accent: '#b33d68', text: '#49303e'},
  lavender: {name: 'ラベンダー', background: '#f4efff', panel: '#fdfbff', accent: '#7150ae', text: '#39304f'},
  mint: {name: 'ミント', background: '#edf9f5', panel: '#fbfffd', accent: '#237767', text: '#29453e'},
  peach: {name: 'ピーチ', background: '#fff4e9', panel: '#fffdf8', accent: '#a24c32', text: '#4d3830'},
});
const keys = ['background', 'panel', 'accent', 'text'];
const valid = value => /^#[\da-f]{6}$/i.test(value || '');
export function normalizeUI(value = {}) {
  return {preset: value && (value.preset === 'custom' || UI_THEMES[value.preset]) ? value.preset : 'blue',
    custom: Object.fromEntries(keys.map(key => [key, valid(value?.custom?.[key]) ? value.custom[key] : UI_THEMES.blue[key]]))};
}
export function uiColours(ui) { const value = normalizeUI(ui); return value.preset === 'custom' ? value.custom : UI_THEMES[value.preset]; }
function channels(hex) { return [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)); }
export function mix(a, b, amount) {
  const x = channels(a), y = channels(b);
  return '#' + x.map((part, index) => Math.round(part * (1 - amount) + y[index] * amount).toString(16).padStart(2, '0')).join('');
}
function luminance(hex) { return channels(hex).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, part, i) => sum + part * [.2126, .7152, .0722][i], 0); }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function applyUI(ui, root = document.documentElement) {
  const c = uiColours(ui), onAccent = contrast(c.accent, '#ffffff') >= contrast(c.accent, '#101010') ? '#ffffff' : '#101010';
  let muted = c.text;
  for (let amount = .34; amount >= 0; amount -= .02) {
    const candidate = mix(c.text, c.panel, amount);
    if (contrast(candidate, c.panel) >= 4.5) { muted = candidate; break; }
  }
  const vars = {ink: c.text, muted, line: mix(c.text, c.panel, .87), accent: c.accent,
    soft: mix(c.accent, c.panel, .91), panel: c.panel, page: c.background, hover: mix(c.accent, c.panel, .955),
    focus: mix(c.accent, c.panel, .5), 'accent-hover': mix(c.accent, c.text, .15), 'on-accent': onAccent};
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(`--${key}`, value);
  return Math.min(contrast(c.text, c.panel), contrast(c.text, c.background));
}
