// Hands browser downloads over to the Drift app through its local bridge on 127.0.0.1.
const API = 'http://127.0.0.1:47821';
const handedBack = new Set();

async function isEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  return enabled;
}

async function appAvailable() {
  try {
    const res = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(800) });
    const json = await res.json();
    return json.enabled === true;
  } catch {
    return false;
  }
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

// Whether Drift is running with browser downloads on. Cached so new downloads can be cancelled at once,
// before the browser shows them; kept in session storage because the service worker can be restarted.
let ready;

async function isReady() {
  if (ready === undefined) ({ driftReady: ready = false } = await chrome.storage.session.get('driftReady'));
  return ready;
}

// While Drift takes over downloads, hide the browser's own download bubble (like FDM does).
async function setReady(value) {
  ready = value;
  await chrome.storage.session.set({ driftReady: value });
  try {
    await chrome.downloads.setUiOptions({ enabled: !value });
  } catch {}
}

async function refresh() {
  await setReady((await isEnabled()) && (await appAvailable()));
}

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return; // blob: and data: URLs only exist inside the browser
  if (handedBack.delete(url)) return;
  if (!(await isReady())) {
    refresh();
    return;
  }

  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch {}

  const name = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
  if (!(await sendToDrift(url, name, item.referrer))) {
    // Drift went away: show the browser's UI again and let the browser download it.
    await setReady(false);
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
  if (url) await sendToDrift(url, undefined, tab?.url);
});
