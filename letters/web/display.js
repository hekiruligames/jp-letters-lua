// SPDX-License-Identifier: GPL-2.0-or-later
import {normalizeState, renderLetter, setScroll, deadlineSignal} from './core.js';
const host = document.getElementById('display-host'), params = new URLSearchParams(location.search);
const token = params.get('token') || '', source = params.get('source') || '';
let renderedKey = '', reportedRevision = -1;
const headers = {'X-OBS-Letters-Token': token};
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function poll() {
  try {
    const response = await fetch(`/api/state/${source}`, {headers, cache: 'no-store', signal: deadlineSignal(2500)});
    if (!response.ok) throw new Error('offline');
    const envelope = await response.json(), state = normalizeState(envelope.state), live = state.live;
    const key = JSON.stringify({...live, scroll: 0});
    let count = Number(host.dataset.pageCount) || 1;
    if (key !== renderedKey) {
      host.style.visibility = 'hidden';
      if (live.visible) {
        const result = await renderLetter(host, live, live.style || state.style, live.page, {prepared: true});
        count = result.pages.length;
        host.dataset.scrollMax = String(result.scrollMax); host.dataset.viewportHeight = String(result.viewportHeight);
      } else { host.replaceChildren(); count = 1; }
      host.dataset.pageCount = String(count); renderedKey = key;
    }
    if (live.visible && live.style?.readingMode === 'scroll') setScroll(host.querySelector('.letter-frame'), live.scroll);
    host.style.visibility = 'visible';
    if (reportedRevision !== envelope.liveRevision || envelope.renderedLiveRevision !== envelope.liveRevision) {
      // Allow the new page to be painted before the Lua source makes it visible.
      await nextFrame(); await nextFrame();
      const report = await fetch(`/api/report/${source}`, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
        body: JSON.stringify({liveRevision: envelope.liveRevision, pageCount: count,
          scrollMax: Number(host.dataset.scrollMax) || 0, viewportHeight: Number(host.dataset.viewportHeight) || 0}), signal: deadlineSignal(2500)});
      if (report.ok) reportedRevision = envelope.liveRevision;
    }
  } catch {
    // Connection/layout errors stay out of the broadcast. The operation panel explains them.
    host.style.visibility = 'hidden'; renderedKey = ''; reportedRevision = -1;
  } finally { setTimeout(poll, 160); }
}
poll();
