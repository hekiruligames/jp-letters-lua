// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {applyDisplayPreset, MAX_ICON_DATA_URL, normalizeStyle} from '../letters/web/core.js';

const standard = normalizeStyle({});
assert.equal(standard.design, 'standard');
assert.equal(standard.fontSize, 32);
assert.deepEqual(standard.padding, {top: 16, right: 16, bottom: 16, left: 16});
assert.equal(standard.align, 'left');
assert.equal(standard.verticalAlign, 'top');
assert.equal(standard.frameBackgroundOpacity, 0);
assert.equal(standard.showIcon, false);
assert.equal(standard.showServiceLabel, true);

const customised = normalizeStyle({...standard,
  fontSize: 57, lineHeight: 1.8, align: 'right', verticalAlign: 'bottom', radius: 31, innerPadding: 41,
  showTitle: true, showPageNumber: true, readingMode: 'scroll'});
applyDisplayPreset(customised, 'marshmallow');
const marshmallow = normalizeStyle(customised);
assert.equal(marshmallow.design, 'marshmallow');
assert.equal(marshmallow.frameBackground, '#f3969a');
assert.equal(marshmallow.frameBackgroundOpacity, 1);
assert.equal(marshmallow.background, '#ffffff');
assert.equal(marshmallow.backgroundOpacity, 1);
assert.equal(marshmallow.textColor, '#000000');
assert.equal(marshmallow.outlineWidth, 0);
assert.deepEqual(marshmallow.padding, {top: 16, right: 16, bottom: 64, left: 16});
assert.equal(marshmallow.showServiceLabel, true);
for (const [key, expected] of Object.entries({fontSize: 57, lineHeight: 1.8, align: 'right', verticalAlign: 'bottom',
  radius: 31, innerPadding: 41, showTitle: true, showPageNumber: true, readingMode: 'scroll'})) {
  assert.equal(marshmallow[key], expected, `${key} should survive the Marshmallow preset`);
}

const withoutServiceLabel = normalizeStyle({...marshmallow, showServiceLabel: false});
assert.equal(withoutServiceLabel.showServiceLabel, false);

const image = 'data:image/png;base64,iVBORw0KGgo=';
const withIcon = normalizeStyle({...marshmallow, iconData: image, iconName: 'sample.png', showIcon: true});
assert.equal(withIcon.iconData, image);
assert.equal(withIcon.iconName, 'sample.png');
assert.equal(withIcon.showIcon, true);

const remote = normalizeStyle({...marshmallow, iconData: 'https://example.com/logo.png', showIcon: true});
assert.equal(remote.iconData, '');
assert.equal(remote.showIcon, false);

const tooLarge = normalizeStyle({...marshmallow, iconData: `data:image/png;base64,${'A'.repeat(MAX_ICON_DATA_URL)}`, showIcon: true});
assert.equal(tooLarge.iconData, '');
assert.equal(tooLarge.showIcon, false);

const beforeDefault = normalizeStyle({...marshmallow, fontSize: 61, align: 'center', verticalAlign: 'bottom',
  radius: 19, innerPadding: 33, padding: {top: 7, right: 8, bottom: 9, left: 10}, showPageNumber: false});
applyDisplayPreset(beforeDefault, 'default');
const defaultPreset = normalizeStyle(beforeDefault);
assert.equal(defaultPreset.design, 'standard');
assert.equal(defaultPreset.frameBackgroundOpacity, 0);
assert.equal(defaultPreset.background, '#ffffff');
assert.equal(defaultPreset.backgroundOpacity, 1);
assert.equal(defaultPreset.textColor, '#222222');
assert.equal(defaultPreset.outlineWidth, 0);
assert.equal(defaultPreset.fontSize, 61);
assert.equal(defaultPreset.align, 'center');
assert.equal(defaultPreset.verticalAlign, 'bottom');
assert.equal(defaultPreset.radius, 19);
assert.equal(defaultPreset.innerPadding, 33);
assert.deepEqual(defaultPreset.padding, {top: 7, right: 8, bottom: 9, left: 10});
assert.equal(defaultPreset.showPageNumber, false);

const clear = normalizeStyle({...marshmallow});
applyDisplayPreset(clear, 'clear');
assert.equal(clear.design, 'standard');
assert.equal(clear.frameBackgroundOpacity, 0);
assert.equal(clear.backgroundOpacity, 0);
assert.equal(clear.outlineWidth, 8);

console.log('PASS: display presets change only their intended settings and user icon state is normalized safely');
