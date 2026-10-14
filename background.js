// Hands browser downloads over to the Anchor app through its local bridge on 127.0.0.1.
const API = 'http://127.0.0.1:47821';
const HOST = 'dev.mansoor.anchor'; // native messaging host that Anchor registers, used to launch it
const handedBack = new Set();

async function isEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  return enabled;
}

// Anchor's browser downloads setting as of the last ping, or null when Anchor isn't running.
async function appState() {
  try {
    const res = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(800) });
    const { enabled } = await res.json();
    await chrome.storage.local.set({ anchorEnabled: enabled === true });
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

// The toolbar icon's dot: green while Anchor is running, grey when it isn't. Only changed when it differs.
let shownRunning;

async function showRunning(running) {
  if (shownRunning === running) return;
  shownRunning = running;
  const state = running ? 'running' : 'stopped';
  try {
    await chrome.action.setIcon({ path: { 16: `icon16-${state}.png`, 32: `icon32-${state}.png` } });
  } catch {}
}

// Starts Anchor through the native host and waits for its bridge. True once Anchor takes browser downloads.
async function launchAnchor() {
  const reply = await nativeMessage({ type: 'launch' });
  if (reply?.ok) {
    await chrome.storage.local.set({ anchorEnabled: reply.enabled === true });
    await showRunning(true);
  }
  return reply?.ok === true && reply.enabled === true;
}

async function sendToAnchor(url, filename, referrer) {
  let cookies = '';
  let cookieJar = [];
  try {
    const all = await chrome.cookies.getAll({ url });
    cookies = all.map((c) => `${c.name}=${c.value}`).join('; ');
    // The same cookies with their domains and paths: video sites (YouTube's bot check) need them for yt-dlp.
    cookieJar = all.map((c) => ({
      domain: c.domain, path: c.path, secure: c.secure, hostOnly: c.hostOnly,
      expires: c.session ? undefined : c.expirationDate, name: c.name, value: c.value,
    }));
  } catch {}
  try {
    const res = await fetch(`${API}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename, referrer, cookies, cookieJar, userAgent: navigator.userAgent }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// What happens to a new download: 'ready' when Anchor is running with browser downloads on, 'launch' when
// Anchor isn't running but can be started through the native host (and had browser downloads on last time),
// 'off' otherwise. Cached so new downloads can be cancelled at once, before the browser shows them; kept in
// session storage because the service worker can be restarted.
let mode;

async function getMode() {
  if (mode === undefined) ({ anchorMode: mode = 'off' } = await chrome.storage.session.get('anchorMode'));
  return mode;
}

// While Anchor takes over downloads, hide the browser's own download bubble.
async function setMode(value) {
  mode = value;
  await chrome.storage.session.set({ anchorMode: value });
  try {
    await chrome.downloads.setUiOptions({ enabled: value === 'off' });
  } catch {}
}

async function refresh() {
  const state = await appState();
  await showRunning(state !== null);
  if (!(await isEnabled())) return setMode('off');
  if (state !== null) return setMode(state ? 'ready' : 'off');
  const { anchorEnabled = true } = await chrome.storage.local.get('anchorEnabled');
  const hostInstalled = anchorEnabled && ((await getMode()) === 'launch' || (await nativeMessage({ type: 'ping' }))?.ok === true);
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
  let sent = current === 'ready' && (await sendToAnchor(url, name, item.referrer));
  if (!sent && (await launchAnchor())) {
    await setMode('ready');
    sent = await sendToAnchor(url, name, item.referrer);
  }
  if (!sent) {
    // Anchor didn't start or browser downloads are off: show the browser's UI again and let it download.
    await setMode('off');
    refresh();
    handedBack.add(url);
    chrome.downloads.download({ url });
  }
});

chrome.alarms.create('anchor-ping', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'anchor-ping') refresh(); });
chrome.runtime.onStartup.addListener(refresh);
// Check again when the browser comes back to the front (say after starting or quitting Anchor) and when the
// popup opens, so the dot doesn't wait for the 30-second check.
chrome.windows.onFocusChanged.addListener((id) => { if (id !== chrome.windows.WINDOW_ID_NONE) refresh(); });
chrome.runtime.onMessage.addListener((message) => { if (message === 'refresh') refresh(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'enabled' in changes) refresh(); });
refresh();

// Sites Anchor downloads videos from (its MediaLinkDetector list), for the page's own menu item.
const VIDEO_SITES = [
  'youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'pinterest.com', 'pin.it', 'x.com', 'twitter.com',
  'vimeo.com', 'facebook.com', 'fb.watch', 'reddit.com', 'twitch.tv', 'dailymotion.com', 'soundcloud.com', 'bilibili.com',
];

chrome.runtime.onInstalled.addListener(() => {
  refresh();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'anchor-download',
      title: 'Download with Anchor',
      contexts: ['link', 'video', 'audio', 'image'],
    });
    chrome.contextMenus.create({
      id: 'anchor-download-page',
      title: 'Download This Video with Anchor',
      contexts: ['page'],
      documentUrlPatterns: VIDEO_SITES.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]),
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url = info.linkUrl || info.srcUrl;
  // The page itself, or a player whose source is a blob: only the page's address means anything to Anchor.
  if (info.menuItemId === 'anchor-download-page' || !url || !/^https?:/i.test(url)) url = info.pageUrl || tab?.url;
  if (!url) return;
  if (!(await sendToAnchor(url, undefined, tab?.url)) && (await launchAnchor())) {
    await setMode('ready');
    await sendToAnchor(url, undefined, tab?.url);
  }
});
