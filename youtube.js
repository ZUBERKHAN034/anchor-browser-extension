// Adds an Anchor button to YouTube. On a watch page it downloads the video; when the video plays from a playlist it
// asks whether to take the video or the whole playlist. On a playlist page it downloads the playlist. Hovering any
// video's thumbnail shows a small button that does the same, and stays in YouTube's hover preview: a playlist item
// offers "This video" or "Whole playlist". Anchor then opens its New Download window to pick a quality (or, for a
// playlist, the videos).
(() => {
  const ROOT_ID = 'anchor-yt';
  // The app icon, as on the Dock.
  const appIcon = () => `<span class="anchor-yt-mark"><img class="anchor-yt-icon" src="${ANCHOR_ICON}" alt=""><span class="anchor-yt-spinner" aria-hidden="true"></span></span>`;
  const CHEVRON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // The video on a watch page, as a plain link (without the playlist or the time).
  function videoLink() {
    const short = location.pathname.match(/^\/shorts\/([^/]+)/);
    if (short) return `https://www.youtube.com/watch?v=${short[1]}`;
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
  // A second click while a send is under way is ignored, so the same link isn't sent twice.
  function send(url, button) {
    if (button.getAttribute('aria-busy') === 'true') return;
    // Put back the label a previous send replaced, so "Sent to Anchor" isn't taken as the idle one.
    clearTimeout(button._anchorResetTimer);
    if (button._anchorIdleLabel) button.setAttribute('aria-label', button._anchorIdleLabel);
    const idleLabel = button.getAttribute('aria-label') || button.title;
    button._anchorIdleLabel = idleLabel;
    button.classList.add('anchor-yt-sending');
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'Sending to Anchor');
    const finish = (ok) => {
      button.classList.remove('anchor-yt-sending');
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', ok ? 'Sent to Anchor' : 'Anchor isn’t running');
      button.classList.toggle('anchor-yt-failed', !ok);
      button._anchorResetTimer = setTimeout(() => {
        button.setAttribute('aria-label', idleLabel);
        button.classList.remove('anchor-yt-failed');
        button._anchorIdleLabel = null;
      }, 2500);
    };
    try {
      chrome.runtime.sendMessage({ type: 'anchor-download', url, referrer: location.href }, (reply) => {
        finish(!chrome.runtime.lastError && reply?.ok);
      });
    } catch {
      // The extension was reloaded or updated since this page loaded; its old content script can't reach it.
      finish(false);
    }
  }

  function makeButton(label, title, withMenu) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'anchor-yt-button';
    el.title = title;
    el.setAttribute('aria-label', title);
    el.innerHTML = `${appIcon()}<span class="anchor-yt-label">${label}</span>${withMenu ? `<span class="anchor-yt-chevron">${CHEVRON}</span>` : ''}`;
    if (withMenu) el.setAttribute('aria-haspopup', 'menu');
    return el;
  }

  function previewVideoLink(preview) {
    const links = [
      preview.querySelector('.ytp-title-link')?.href,
      preview.querySelector('.ytdVideoPreviewMediaContainerLink[href]')?.href,
    ];
    for (const raw of links) {
      if (!raw) continue;
      try {
        const url = new URL(raw, location.origin);
        const id = url.searchParams.get('v') || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      } catch {}
    }
    return null;
  }

  // The video items that get Anchor's hover button, and the thumbnail link inside each.
  const ITEM = 'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, '
    + 'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model';
  const THUMB = 'a#thumbnail, a.ytLockupViewModelContentImage, a.shortsLockupViewModelHostEndpoint';

  // The item under the pointer. YouTube's hover preview is one shared element drawn over the thumbnail, outside the
  // item, so moving onto it (or onto Anchor's button) keeps the item it opened from.
  let hoveredItem = null;
  document.addEventListener('pointerover', (event) => {
    const path = event.composedPath();
    if (path.some((node) => node instanceof Element && node.matches('ytd-video-preview, .anchor-yt-preview-control'))) return;
    const item = path.find((node) => node instanceof Element && node.matches(ITEM)) || null;
    if (item === hoveredItem) return;
    hoveredItem = item;
    schedule();
  }, { capture: true, passive: true });

  // A thumbnail's video and playlist, as plain links. Mixes (RD…) are endless, auto-generated lists: left out.
  function thumbnailLinks(thumb) {
    try {
      const url = new URL(thumb.href, location.origin);
      const id = url.searchParams.get('v') || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      // A channel's playlist cards link to /show/VL<playlist id>.
      const list = url.searchParams.get('list') || url.pathname.match(/^\/show\/VL([\w-]+)/)?.[1];
      return {
        video: id ? `https://www.youtube.com/watch?v=${id}` : null,
        playlist: list && !list.startsWith('RD') ? `https://www.youtube.com/playlist?list=${list}` : null,
      };
    } catch {
      return {};
    }
  }

  // "This video" / "Whole playlist" inside the preview's own control. It must live in the preview (not on the page
  // body): leaving the preview would close it, and with it the menu. It has its own class, so the page-level
  // menu cleanup doesn't touch it.
  function togglePreviewMenu(control, button, video, list) {
    const existing = control.querySelector('.anchor-yt-preview-menu');
    if (existing) {
      existing.remove();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'anchor-yt-preview-menu';
    menu.setAttribute('role', 'menu');
    for (const [title, url] of [['This video', video], ['Whole playlist', list]]) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = title;
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.remove();
        send(url, button);
      });
      menu.append(item);
    }
    control.append(menu);
  }

  // Click anywhere else, or press Escape: close an open preview menu.
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.anchor-yt-preview-menu').forEach((menu) => {
      if (!menu.parentElement?.contains(event.target)) menu.remove();
    });
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('.anchor-yt-preview-menu').forEach((menu) => menu.remove());
  });

  function fadePreviewBackground(control) {
    control.classList.remove('anchor-yt-preview-background-faded');
    clearTimeout(control._anchorBackgroundTimer);
    // YouTube autohides preview controls shortly after pointer activity stops.
    control._anchorBackgroundTimer = setTimeout(() => {
      control.classList.add('anchor-yt-preview-background-faded');
    }, 2200);
  }

  function revealPreviewBackground(event) {
    const control = event.composedPath().find((node) =>
      node instanceof Element && node.matches('.anchor-yt-preview-control'));
    if (control) fadePreviewBackground(control);
  }

  // Reveal the background only when the pointer reaches the Anchor icon.
  document.addEventListener('pointerover', revealPreviewBackground, { capture: true, passive: true });

  function makeHoverControl() {
    const control = document.createElement('div');
    control.className = 'anchor-yt-preview-control';
    const icon = document.createElement('div');
    icon.className = 'anchor-yt-preview-icon';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anchor-yt-preview-button';
    button.innerHTML = appIcon();
    icon.append(button);
    control.append(icon);
    button.addEventListener('click', (event) => {
      // Keep the click from reaching the thumbnail link the button sits in.
      event.preventDefault();
      event.stopPropagation();
      // Read at click time: the pointer can move on to another video.
      const { url, playlist } = button.dataset;
      if (playlist) togglePreviewMenu(control, button, url, playlist);
      else send(url, button);
    });
    return control;
  }

  // Anchor's button on the hovered video's thumbnail, there as soon as the pointer is over the item. When YouTube's
  // hover preview opens over the thumbnail, the same button moves into the preview at the same spot, so it stays
  // visible and hovering it doesn't close the preview.
  function syncHoverButton() {
    let control = document.querySelector('.anchor-yt-preview-control');
    const thumb = hoveredItem?.isConnected ? hoveredItem.querySelector(THUMB) : null;
    const { video, playlist } = thumb ? thumbnailLinks(thumb) : {};
    if (!video && !playlist) {
      control?.remove();
      return;
    }
    // The preview element itself, not its player: the player fades in from transparent for most of a second and
    // would take the button with it, while the preview element is opaque from the moment it opens.
    const preview = document.querySelector('ytd-video-preview.ytdVideoPreviewActive');
    const previewLink = preview && previewVideoLink(preview);
    const host = preview && video && (!previewLink || previewLink === video) ? preview : thumb;
    control ??= makeHoverControl();
    if (control.parentElement !== host) {
      if (host === thumb && getComputedStyle(thumb).position === 'static') thumb.classList.add('anchor-yt-thumb-host');
      host.append(control);
    }
    // In the preview, which is drawn a little larger than the thumbnail, keep the button on the thumbnail's corner.
    const thumbRect = thumb.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    control.style.top = `${Math.round(thumbRect.top - hostRect.top) + 8}px`;
    control.style.left = `${Math.round(thumbRect.left - hostRect.left) + 8}px`;
    const button = control.querySelector('.anchor-yt-preview-button');
    const url = video || playlist;
    if (button.dataset.url !== url) {
      control.querySelector('.anchor-yt-preview-menu')?.remove();
      fadePreviewBackground(control);
    }
    button.dataset.url = url;
    // A video from a playlist offers both; a playlist's own thumbnail downloads the playlist.
    button.dataset.playlist = video ? playlist || '' : '';
    button.setAttribute('aria-label', button.dataset.playlist
      ? 'Download with Anchor: this video or the whole playlist'
      : video ? 'Download this video with Anchor' : 'Download this playlist with Anchor');
    button.setAttribute('aria-haspopup', button.dataset.playlist ? 'menu' : 'false');
  }

  // "This video" or "Whole playlist", under the button. It lives on the page body at a fixed position, since
  // YouTube's action row clips anything that sticks out of it.
  function attachMenu(root, button, choices) {
    document.querySelectorAll('.anchor-yt-menu').forEach((old) => old.remove());
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
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
        send(url, button);
      });
      menu.append(item);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    const onDocumentClick = (event) => {
      if (!root.contains(event.target) && !menu.contains(event.target)) close();
    };
    const onDocumentKeyDown = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeyDown);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    // Gone with the button when YouTube moves to another page.
    const observer = new MutationObserver(() => {
      if (root.isConnected) return;
      menu.remove();
      observer.disconnect();
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeyDown);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
        attachMenu(root, button, [['This video', video], ['Whole playlist', list]]);
      }];
    }
    if (video) {
      return [`video ${video}`, (root) => {
        const button = makeButton('Anchor', 'Download this video with Anchor', false);
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          send(video, button);
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
          send(list, button);
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
    if (location.pathname.startsWith('/shorts/')) {
      return firstVisible(['reel-action-bar-view-model']);
    }
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

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement
      || document.querySelector('#movie_player.ytp-fullscreen, ytd-watch-flexy[fullscreen], ytd-player[fullscreen]'));
  }

  function positionFullscreenButton(root, actions, refreshFadeWatch = true) {
    const player = document.querySelector('#movie_player');
    const playerRect = player?.getBoundingClientRect();
    if (!playerRect) return;

    // Fullscreen has its own quick-action bar, separate from the hidden metadata action row.
    const fullscreenLikeButton = player.querySelector('yt-player-quick-action-buttons button');
    const fullscreenActions = fullscreenLikeButton?.closest('.ytp-fullscreen-quick-actions');
    const likeControl = fullscreenLikeButton || actions?.querySelector(
      'segmented-like-dislike-button-view-model, like-button-view-model, ytd-segmented-like-dislike-button-renderer',
    ) || actions?.firstElementChild;
    const actionRect = likeControl?.getBoundingClientRect() || actions?.getBoundingClientRect();
    const actionVisible = actionRect?.width > 0 && actionRect?.height > 0
      && actionRect.bottom > 0 && actionRect.top < window.innerHeight
      && actionRect.right > 0 && actionRect.left < window.innerWidth
      && actionRect.top >= playerRect.top && actionRect.bottom <= playerRect.bottom;
    const rootWidth = root.getBoundingClientRect().width || 40;
    const rootHeight = root.getBoundingClientRect().height || 40;
    const left = actionVisible
      ? actionRect.left - rootWidth - 8
      : playerRect.right - Math.min(440, playerRect.width * 0.3);
    const top = actionVisible
      ? actionRect.top + (actionRect.height - rootHeight) / 2
      : playerRect.bottom - 100;
    root.style.left = `${Math.max(8, left)}px`;
    root.style.top = `${Math.max(8, top)}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';

    if (fullscreenActions) {
      if (refreshFadeWatch) root._anchorFadeWatchUntil = performance.now() + 350;
      const nativeStyle = getComputedStyle(fullscreenActions);
      const opacity = !fullscreenLikeButton || nativeStyle.display === 'none'
        || nativeStyle.visibility === 'hidden'
        ? 0
        : Math.max(0, Math.min(1, Number.parseFloat(nativeStyle.opacity) || 0));
      root.style.opacity = String(opacity);
      root.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none';
      const stillWatching = performance.now() < (root._anchorFadeWatchUntil || 0);
      const midFade = opacity > 0.01 && opacity < 0.99;
      if ((stillWatching || midFade) && !root._anchorFullscreenFadeFrame) {
        root._anchorFullscreenFadeFrame = requestAnimationFrame(() => {
          root._anchorFullscreenFadeFrame = 0;
          if (root.isConnected) positionFullscreenButton(root, actions, false);
        });
      }
    }
  }

  function fullscreenHost() {
    const element = document.fullscreenElement || document.webkitFullscreenElement;
    return element instanceof HTMLElement && element.tagName !== 'VIDEO' ? element : document.body;
  }

  // When the page last changed. Its layout takes a moment to arrive; after that, the button floats instead.
  let navigatedAt = Date.now();
  const LAYOUT_WAIT = 3000;

  function sync() {
    syncHoverButton();
    const wanted = plan();
    let root = document.getElementById(ROOT_ID);
    if (!wanted) {
      root?.remove();
      document.querySelectorAll('.anchor-yt-menu').forEach((menu) => menu.remove());
      return;
    }
    const [key, build] = wanted;
    const target = anchorPoint();
    const fullscreen = isFullscreen();
    const shorts = location.pathname.startsWith('/shorts/');
    // Shorts has a dedicated action rail; never place a floating fallback over its video.
    if (!fullscreen && shorts && !target) {
      root?.remove();
      return;
    }
    const before = shorts && target ? target.querySelector('like-button-view-model') : null;
    if (!fullscreen && shorts && !before) {
      root?.remove();
      return;
    }
    const floating = !fullscreen && !target;
    if (fullscreen && root?.classList.contains('anchor-yt-fullscreen')) {
      positionFullscreenButton(root, target);
    }
    if (root && root.dataset.key === key && root.classList.contains('anchor-yt-floating') === floating
        && root.classList.contains('anchor-yt-fullscreen') === fullscreen
        && root.classList.contains('anchor-yt-short') === shorts
        && (floating || fullscreen || (root.parentElement === target && (shorts ? root.nextElementSibling === before : true)))) return;
    if (floating && Date.now() - navigatedAt < LAYOUT_WAIT) {
      // Give the page's own layout a moment to arrive; float only if it doesn't (YouTube changed its markup).
      setTimeout(schedule, LAYOUT_WAIT);
      return;
    }
    root?.remove();
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.key = key;
    root.className = `${fullscreen ? 'anchor-yt-fullscreen' : floating ? 'anchor-yt-floating' : 'anchor-yt-inline'}${shorts ? ' anchor-yt-short' : ''}`;
    // A playlist's header sits on a dark backdrop in both themes, like the buttons YouTube puts there.
    if (!floating && location.pathname === '/playlist') root.classList.add('anchor-yt-overlay');
    build(root);
    root.classList.toggle('anchor-yt-has-menu', !!root.querySelector('.anchor-yt-button[aria-haspopup="menu"]'));
    if (floating) document.body.append(root);
    else if (fullscreen) fullscreenHost().append(root);
    else if (shorts) target.insertBefore(root, before);
    else target.prepend(root);
    if (fullscreen) positionFullscreenButton(root, target);
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
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('webkitfullscreenchange', schedule);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('popstate', schedule);
  new MutationObserver((records) => {
    if (records.some(({ target }) => !target.closest?.('.anchor-yt-preview-control, #anchor-yt'))) schedule();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  schedule();
})();
