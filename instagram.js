// Adds an Anchor button to the Reel action rail and to video posts, immediately before Save.
(() => {
  const ROOT_ID = 'anchor-ig';
  const ICON = `<span class="anchor-ig-mark"><img class="anchor-ig-icon" src="${chrome.runtime.getURL('icon128.png')}" alt=""><span class="anchor-ig-spinner" aria-hidden="true"></span></span>`;
  const LIKE_ICONS = 'svg[aria-label="Like"], svg[aria-label="Unlike"]';
  const OTHER_ACTION_ICONS = ["Comment", "Share", "Save", "More"]
    .map((name) => `svg[aria-label="${name}"]`).join(', ');

  function reelLink() {
    const match = location.pathname.match(/^\/(?:reel|reels)\/([^/]+)/);
    // Instagram's viewer can use /reels/ for navigation; send yt-dlp the canonical single-Reel route.
    return match ? `https://www.instagram.com/reel/${match[1]}/` : null;
  }

  function send(url, button) {
    button.classList.add('anchor-ig-sending');
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'Sending to Anchor');
    chrome.runtime.sendMessage({ type: 'anchor-download', url, referrer: location.href }, (reply) => {
      const ok = !chrome.runtime.lastError && reply?.ok;
      button.classList.remove('anchor-ig-sending');
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', ok ? 'Sent to Anchor' : 'Anchor isn’t running');
      button.classList.toggle('anchor-ig-failed', !ok);
      setTimeout(() => {
        button.setAttribute('aria-label', button.title);
        button.classList.remove('anchor-ig-failed');
      }, 2500);
    });
  }

  function visible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
      && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function rendered(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
      && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function timelineVideoLink(article) {
    const links = [...article.querySelectorAll('a[href]')].map((link) => {
      try {
        const url = new URL(link.href, location.origin);
        const match = url.pathname.match(/^\/(reel|reels|p)\/([^/]+)\/?$/);
        return match ? { type: match[1], shortcode: match[2] } : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
    const post = links.find(({ type }) => type === 'reel' || type === 'reels')
      || links.find(({ type }) => type === 'p');
    if (!post) return null;
    const route = post.type === 'p' ? 'p' : 'reel';
    return `https://www.instagram.com/${route}/${post.shortcode}/`;
  }

  function syncTimelineVideos() {
    const activeControls = new Set();
    if (!/^\/(?:reel|reels)\//.test(location.pathname)) {
      for (const article of document.querySelectorAll('article')) {
        if (!article.querySelector('video')) continue;
        const url = timelineVideoLink(article);
        if (!url) continue;

        const saveIcon = [...article.querySelectorAll('svg[aria-label="Save"]')].find(rendered);
        const row = saveIcon?.closest('section');
        if (!saveIcon || !row || !row.querySelector(LIKE_ICONS)) continue;
        let saveSlot = saveIcon;
        while (saveSlot.parentElement && saveSlot.parentElement !== row) saveSlot = saveSlot.parentElement;
        if (saveSlot.parentElement !== row) continue;

        let control = article.querySelector('.anchor-ig-feed-control');
        let button = control?.querySelector('.anchor-ig-button');
        if (control?.dataset.url !== url || control.parentElement !== saveSlot || !button) {
          control?.remove();
          control = document.createElement('div');
          control.className = 'anchor-ig-feed-control';
          control.dataset.url = url;
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'anchor-ig-button anchor-ig-feed-button';
          button.title = 'Download this video with Anchor';
          button.setAttribute('aria-label', button.title);
          button.innerHTML = ICON;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            send(control.dataset.url, button);
          });
          control.append(button);
        }

        saveSlot.classList.add('anchor-ig-save-slot');
        if (control.parentElement !== saveSlot) saveSlot.append(control);
        activeControls.add(control);
      }
    }

    document.querySelectorAll('.anchor-ig-feed-control').forEach((control) => {
      if (!activeControls.has(control)) {
        const slot = control.parentElement;
        control.remove();
        if (slot?.classList.contains('anchor-ig-save-slot') && !slot.querySelector('.anchor-ig-feed-control')) {
          slot.classList.remove('anchor-ig-save-slot');
        }
      }
    });
  }

  // Find Instagram's vertical Reel action rail by its Like, Comment, Share and Save icons.
  // If Instagram changes the rail markup or hides it in a different viewing mode, don't add a floating fallback.
  function actionRail() {
    if (document.fullscreenElement) return null;
    for (const likeIcon of document.querySelectorAll(LIKE_ICONS)) {
      if (!visible(likeIcon)) continue;
      let node = likeIcon;
      while (node.parentElement) {
        const parent = node.parentElement;
        if (parent.children.length >= 3 && parent.querySelectorAll(OTHER_ACTION_ICONS).length >= 2) {
          let likeGroup = likeIcon;
          while (likeGroup.parentElement && likeGroup.parentElement !== parent) likeGroup = likeGroup.parentElement;
          if (likeGroup.parentElement === parent) return { rail: parent, likeGroup };
        }
        node = parent;
      }
    }
    return null;
  }

  function sync() {
    syncTimelineVideos();
    const url = reelLink();
    const target = url ? actionRail() : null;
    let root = document.getElementById(ROOT_ID);
    if (!url || !target) {
      root?.remove();
      return;
    }
    if (root?.dataset.url === url && root.parentElement === target.rail
        && root.nextElementSibling === target.likeGroup) return;
    root?.remove();
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.url = url;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anchor-ig-button';
    button.title = 'Download this Reel with Anchor';
    button.setAttribute('aria-label', 'Download this Reel with Anchor');
    button.innerHTML = ICON;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      send(url, button);
    });
    root.append(button);
    target.rail.insertBefore(root, target.likeGroup);
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }

  let currentRoute = `${location.pathname}${location.search}`;
  function syncAfterRouteChange() {
    const nextRoute = `${location.pathname}${location.search}`;
    if (nextRoute === currentRoute) return;
    currentRoute = nextRoute;
    for (const delay of [0, 100, 300, 700, 1400, 2200]) setTimeout(schedule, delay);
  }

  window.addEventListener('popstate', () => {
    currentRoute = `${location.pathname}${location.search}`;
    for (const delay of [0, 100, 300, 700, 1400, 2200]) setTimeout(schedule, delay);
  });
  // Instagram uses pushState for feed-to-Reel navigation, which doesn't fire popstate.
  setInterval(syncAfterRouteChange, 250);
  document.addEventListener('fullscreenchange', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
