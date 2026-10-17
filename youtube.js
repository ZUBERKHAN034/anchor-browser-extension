// Adds an Anchor button to YouTube. On a watch page it downloads the video; when the video plays from a playlist it
// asks whether to take the video or the whole playlist. On a playlist page it downloads the playlist. Anchor then
// opens its New Download window to pick a quality (or, for a playlist, the videos).
(() => {
  const ROOT_ID = 'anchor-yt';
  // The app icon, as on the Dock.
  const ICON = `<img class="anchor-yt-icon" src="${chrome.runtime.getURL('icon128.png')}" alt="">`;
  const CHEVRON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // The video on a watch page, as a plain link (without the playlist or the time).
  function videoLink() {
    if (location.pathname !== '/watch') return null;
    const id = new URL(location.href).searchParams.get('v');
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  }

  // The playlist being watched or browsed. Mixes (RD…) are endless, auto-generated lists: left out.
  function playlistLink() {
    const list = new URL(location.href).searchParams.get('list');
    if (!list || list.startsWith('RD')) return null;
    return `https://www.youtube.com/playlist?list=${list}`;
  }

  // Hands a link to Anchor, showing how it went on the button for a moment.
  function send(url, button, label) {
    const text = button.querySelector('span');
    text.textContent = 'Sending…';
    chrome.runtime.sendMessage({ type: 'anchor-download', url, referrer: location.href }, (reply) => {
      const ok = !chrome.runtime.lastError && reply?.ok;
      text.textContent = ok ? 'Sent to Anchor' : 'Anchor isn’t running';
      button.classList.toggle('anchor-yt-failed', !ok);
      setTimeout(() => {
        text.textContent = label;
        button.classList.remove('anchor-yt-failed');
      }, 2500);
    });
  }

  function makeButton(label, title, withMenu) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'anchor-yt-button';
    el.title = title;
    el.innerHTML = `${ICON}<span>${label}</span>${withMenu ? CHEVRON : ''}`;
    if (withMenu) el.setAttribute('aria-haspopup', 'menu');
    return el;
  }

  // "This video" or "Whole playlist", under the button. It lives on the page body at a fixed position, since
  // YouTube's action row clips anything that sticks out of it.
  function attachMenu(root, button, label, choices) {
    document.querySelectorAll('.anchor-yt-menu').forEach((old) => old.remove());
    const menu = document.createElement('div');
    menu.className = 'anchor-yt-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      const rect = button.getBoundingClientRect();
      menu.style.left = `${Math.round(rect.left)}px`;
      menu.style.top = `${Math.round(rect.bottom + 6)}px`;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    };
    for (const [title, url] of choices) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = title;
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        send(url, button, label);
      });
      menu.append(item);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', (event) => {
      if (!root.contains(event.target) && !menu.contains(event.target)) close();
    }, true);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    // Gone with the button when YouTube moves to another page.
    new MutationObserver(() => { if (!root.isConnected) menu.remove(); }).observe(document.body, { childList: true, subtree: true });
    document.body.append(menu);
  }

  // What this page gets: a key (to skip rebuilding an unchanged button) and a builder.
  function plan() {
    const video = videoLink();
    const list = playlistLink();
    if (video && list) {
      return [`both ${video} ${list}`, (root) => {
        const button = makeButton('Anchor', 'Download with Anchor', true);
        root.append(button);
        attachMenu(root, button, 'Anchor', [['This video', video], ['Whole playlist', list]]);
      }];
    }
    if (video) {
      return [`video ${video}`, (root) => {
        const button = makeButton('Anchor', 'Download this video with Anchor', false);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          send(video, button, 'Anchor');
        });
        root.append(button);
      }];
    }
    if (list && location.pathname === '/playlist') {
      return [`list ${list}`, (root) => {
        const button = makeButton('Download playlist', 'Download videos from this playlist with Anchor', false);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          send(list, button, 'Download playlist');
        });
        root.append(button);
      }];
    }
    return null;
  }

  // The first element matching any of the selectors that is actually showing: YouTube keeps hidden copies of
  // headers around for other layouts.
  function firstVisible(selectors) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (el.offsetWidth > 0 && el.offsetHeight > 0) return el;
      }
    }
    return null;
  }

  // Where the button goes: in the row with Like and Share on a watch page; in the header actions on a playlist page.
  function anchorPoint() {
    if (location.pathname === '/watch') {
      return firstVisible(['ytd-watch-metadata #top-level-buttons-computed', 'ytd-watch-metadata #actions-inner']);
    }
    if (location.pathname === '/playlist') {
      return firstVisible([
        'ytd-browse[page-subtype="playlist"] yt-flexible-actions-view-model',
        'ytd-browse[page-subtype="playlist"] ytd-playlist-header-renderer #top-level-buttons-computed',
      ]);
    }
    return null;
  }

  // When the page last changed. Its layout takes a moment to arrive; after that, the button floats instead.
  let navigatedAt = Date.now();
  const LAYOUT_WAIT = 3000;

  function sync() {
    const wanted = plan();
    let root = document.getElementById(ROOT_ID);
    if (!wanted) {
      root?.remove();
      document.querySelectorAll('.anchor-yt-menu').forEach((menu) => menu.remove());
      return;
    }
    const [key, build] = wanted;
    const target = anchorPoint();
    const floating = !target;
    if (root && root.dataset.key === key && root.classList.contains('anchor-yt-floating') === floating
        && (floating || root.parentElement === target)) return;
    if (floating && Date.now() - navigatedAt < LAYOUT_WAIT) {
      // Give the page's own layout a moment to arrive; float only if it doesn't (YouTube changed its markup).
      setTimeout(schedule, LAYOUT_WAIT);
      return;
    }
    root?.remove();
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.key = key;
    root.className = floating ? 'anchor-yt-floating' : 'anchor-yt-inline';
    // A playlist's header sits on a dark backdrop in both themes, like the buttons YouTube puts there.
    if (!floating && location.pathname === '/playlist') root.classList.add('anchor-yt-overlay');
    build(root);
    if (floating) document.body.append(root);
    else target.prepend(root);
  }

  // YouTube swaps pages without reloading and redraws parts of them: check again after each change, at most once
  // per frame.
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }
  document.addEventListener('yt-navigate-finish', () => {
    navigatedAt = Date.now();
    schedule();
  });
  window.addEventListener('popstate', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
