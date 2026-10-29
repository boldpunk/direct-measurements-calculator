// Live updates from colleagues (server/src/live.js). When someone else saves
// something, the state is re-read (main.js redraws on onStateReplaced) — but only once the user isn't typing or
// in a dialog, so nothing they're entering is wiped. Reconnects by itself
// (with a fresh token) after network drops or a token expiry.
import { eventsUrl, getToken, CLIENT_ID } from './api.js';
import { reloadState } from './store.js';
import { showToast } from './toast.js';

let source = null;
let retryTimer = null;
let pendingTimer = null;
let pendingNames = new Set();
let lastToastAt = 0;

function busy() {
  const a = document.activeElement;
  const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && a.id !== 'global-search';
  return typing || document.body.classList.contains('has-modal') || !!document.querySelector('.dialog-overlay')
    || document.visibilityState === 'hidden';
}

function scheduleReload(delay = 800) {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    if (busy()) { scheduleReload(1500); return; }
    const names = [...pendingNames];
    pendingNames = new Set();
    try {
      await reloadState();
      if (Date.now() - lastToastAt > 20000 && names.length) {
        lastToastAt = Date.now();
        showToast(`Обновлено: изменения от ${names.join(', ')}`);
      }
    } catch { /* offline — the next event or reconnect will try again */ }
  }, delay);
}

function connect() {
  if (!getToken() || typeof EventSource === 'undefined') return;
  source = new EventSource(eventsUrl());
  source.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.client && ev.client === CLIENT_ID) return;
    if (ev.name) pendingNames.add(ev.name);
    scheduleReload();
  };
  source.onerror = () => {
    // A 401 (expired token) closes the stream for good; network drops are
    // retried by the browser. Either way reconnect ourselves with a fresh token.
    if (source.readyState === EventSource.CLOSED) {
      source = null;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 5000);
    }
  };
}

export function startLive() {
  stopLive();
  connect();
  // Coming back to the tab after a while: catch up on whatever happened.
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible' && pendingNames.size) scheduleReload(200);
}

export function stopLive() {
  clearTimeout(retryTimer);
  clearTimeout(pendingTimer);
  source?.close();
  source = null;
  document.removeEventListener('visibilitychange', onVisible);
}
