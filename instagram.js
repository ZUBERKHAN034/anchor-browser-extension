// Adds an Anchor button to the Reel action rail, immediately before Like.
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

  window.addEventListener('popstate', schedule);
  document.addEventListener('fullscreenchange', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
