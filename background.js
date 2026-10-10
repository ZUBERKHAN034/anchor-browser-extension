// Hands browser downloads over to the Drift app through its local bridge on 127.0.0.1.
const API = 'http://127.0.0.1:47821';
const HOST = 'dev.mansoor.drift'; // native messaging host that Drift registers, used to launch it
const handedBack = new Set();

async function isEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  return enabled;
}

// Drift's browser downloads setting as of the last ping, or null when Drift isn't running.
async function appState() {
  try {
    const res = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(800) });
    const { enabled } = await res.json();
    await chrome.storage.local.set({ driftEnabled: enabled === true });
    return enabled === true;
  } catch {
    return null;
  }
}

function nativeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST, message, (reply) => {
      resolve(chrome.runtime.lastError ? null : reply);
    });
  });
}

// Starts Drift through the native host and waits for its bridge. True once Drift takes browser downloads.
async function launchDrift() {
  const reply = await nativeMessage({ type: 'launch' });
  if (reply?.ok) await chrome.storage.local.set({ driftEnabled: reply.enabled === true });
  return reply?.ok === true && reply.enabled === true;
}

async function sendToDrift(url, filename, referrer) {
  let cookies = '';
  try {
    cookies = (await chrome.cookies.getAll({ url })).map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {}
  try {
    const res = await fetch(`${API}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename, referrer, cookies, userAgent: navigator.userAgent }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// What happens to a new download: 'ready' when Drift is running with browser downloads on, 'launch' when
// Drift isn't running but can be started through the native host (and had browser downloads on last time),
// 'off' otherwise. Cached so new downloads can be cancelled at once, before the browser shows them; kept in
// session storage because the service worker can be restarted.
let mode;

async function getMode() {
  if (mode === undefined) ({ driftMode: mode = 'off' } = await chrome.storage.session.get('driftMode'));
  return mode;
}

// While Drift takes over downloads, hide the browser's own download bubble.
async function setMode(value) {
  mode = value;
  await chrome.storage.session.set({ driftMode: value });
  try {
    await chrome.downloads.setUiOptions({ enabled: value === 'off' });
  } catch {}
}

async function refresh() {
  if (!(await isEnabled())) return setMode('off');
  const state = await appState();
  if (state !== null) return setMode(state ? 'ready' : 'off');
  const { driftEnabled = true } = await chrome.storage.local.get('driftEnabled');
  const hostInstalled = driftEnabled && ((await getMode()) === 'launch' || (await nativeMessage({ type: 'ping' }))?.ok === true);
  await setMode(hostInstalled ? 'launch' : 'off');
}

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return; // blob: and data: URLs only exist inside the browser
  if (handedBack.delete(url)) return;
  const current = await getMode();
  if (current === 'off') {
    refresh();
    return;
  }

  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch {}

  const name = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
  let sent = current === 'ready' && (await sendToDrift(url, name, item.referrer));
  if (!sent && (await launchDrift())) {
    await setMode('ready');
    sent = await sendToDrift(url, name, item.referrer);
  }
  if (!sent) {
    // Drift didn't start or browser downloads are off: show the browser's UI again and let it download.
    await setMode('off');
    refresh();
    handedBack.add(url);
    chrome.downloads.download({ url });
  }
});

chrome.alarms.create('drift-ping', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'drift-ping') refresh(); });
chrome.runtime.onStartup.addListener(refresh);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'enabled' in changes) refresh(); });
refresh();

chrome.runtime.onInstalled.addListener(() => {
  refresh();
  chrome.contextMenus.create({
    id: 'drift-download',
    title: 'Download with Drift',
    contexts: ['link', 'video', 'audio', 'image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;
  if (!(await sendToDrift(url, undefined, tab?.url)) && (await launchDrift())) {
    await setMode('ready');
    await sendToDrift(url, undefined, tab?.url);
  }
});
