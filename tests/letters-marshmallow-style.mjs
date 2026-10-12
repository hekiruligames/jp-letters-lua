// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {applyDisplayPreset, MAX_ICON_DATA_URL, normalizeStyle} from '../letters/web/core.js';

const standard = normalizeStyle({});
assert.equal(standard.design, 'standard');
assert.equal(standard.frameBackgroundOpacity, 0);
assert.equal(standard.showIcon, false);

applyDisplayPreset(standard, 'marshmallow');
const marshmallow = normalizeStyle(standard);
assert.equal(marshmallow.design, 'marshmallow');
assert.equal(marshmallow.frameBackground, '#f3969a');
assert.equal(marshmallow.frameBackgroundOpacity, 1);
assert.equal(marshmallow.background, '#ffffff');
assert.equal(marshmallow.backgroundOpacity, 1);
assert.equal(marshmallow.align, 'center');
assert.equal(marshmallow.verticalAlign, 'center');
assert.equal(marshmallow.showTitle, false);
assert.equal(marshmallow.showPageNumber, false);
assert(marshmallow.padding.bottom > marshmallow.padding.top);

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

applyDisplayPreset(marshmallow, 'default');
const reset = normalizeStyle(marshmallow);
assert.equal(reset.design, 'standard');
assert.equal(reset.frameBackgroundOpacity, 0);
assert.equal(reset.background, '#ffffff');
assert.equal(reset.align, 'left');

console.log('PASS: marshmallow display preset and user icon state are normalized safely');
