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

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return; // blob: and data: URLs only exist inside the browser
  if (handedBack.delete(url)) return;
  if (!(await isEnabled()) || !(await appAvailable())) return;

  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch {}

  const name = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
  if (!(await sendToDrift(url, name, item.referrer))) {
    handedBack.add(url);
    chrome.downloads.download({ url });
  }
});

chrome.runtime.onInstalled.addListener(() => {
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
