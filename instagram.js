// Adds an Anchor button to the Reel action rail and to video posts, immediately before Save.
(() => {
  const ROOT_ID = 'anchor-ig';
  const ICON = `<span class="anchor-ig-mark"><img class="anchor-ig-icon" src="${chrome.runtime.getURL('icon128.png')}" alt=""><span class="anchor-ig-spinner" aria-hidden="true"></span></span>`;
  const LIKE_ICONS = 'svg[aria-label="Like"], svg[aria-label="Unlike"]';
  const OTHER_ACTION_ICONS = ["Comment", "Share", "Save", "More"]
    .map((name) => `svg[aria-label="${name}"]`).join(', ');
  const CAROUSEL_RESOLVER = 'anchor-instagram-carousel-resolver-v1';
  const pendingDownloads = new Map();

  function loadingKey(url) {
    try {
      const match = new URL(url).pathname.match(/^\/(?:reel|reels|p)\/([^/]+)/);
      return match ? `instagram:${match[1]}` : url;
    } catch {
      return url;
    }
  }

  function applyLoading(button, label) {
    button.classList.add('anchor-ig-sending');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', label);
  }

  function restoreLoading(button) {
    const label = pendingDownloads.get(button.dataset.loadingKey);
    if (label) applyLoading(button, label);
  }

  function afterLoadingPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function reelLink() {
    const match = location.pathname.match(/^\/(?:reel|reels)\/([^/]+)/);
    // Instagram's viewer can use /reels/ for navigation; send yt-dlp the canonical single-Reel route.
    return match ? `https://www.instagram.com/reel/${match[1]}/` : null;
  }

  function beginSending(button, label = 'Sending to Anchor', key = button.dataset.loadingKey) {
    key = key || loadingKey(button.dataset.url || location.href);
    button.dataset.loadingKey = key;
    pendingDownloads.set(key, label);
    const matchingButtons = [...document.querySelectorAll('.anchor-ig-button')]
      .filter((candidate) => candidate.dataset.loadingKey === key);
    if (!matchingButtons.includes(button)) matchingButtons.push(button);
    matchingButtons.forEach((candidate) => applyLoading(candidate, label));
  }

  function finishSending(button, ok, failureLabel = 'Anchor isn’t running') {
    const key = button.dataset.loadingKey;
    if (key) pendingDownloads.delete(key);
    const matchingButtons = key
      ? [...document.querySelectorAll('.anchor-ig-button')].filter((candidate) => candidate.dataset.loadingKey === key)
      : [];
    if (!matchingButtons.includes(button)) matchingButtons.push(button);
    matchingButtons.forEach((candidate) => {
      candidate.classList.remove('anchor-ig-sending');
      candidate.disabled = false;
      candidate.removeAttribute('aria-busy');
      candidate.setAttribute('aria-label', ok ? 'Sent to Anchor' : failureLabel);
      candidate.classList.toggle('anchor-ig-failed', !ok);
    });
    setTimeout(() => {
      matchingButtons.forEach((candidate) => {
        if (candidate.getAttribute('aria-busy') === 'true') return;
        candidate.setAttribute('aria-label', candidate.title);
        candidate.classList.remove('anchor-ig-failed');
      });
    }, 2500);
  }

  async function send(url, button, filename) {
    beginSending(button);
    await afterLoadingPaint();
    chrome.runtime.sendMessage({ type: 'anchor-download', url, filename, referrer: location.href }, (reply) => {
      const ok = !chrome.runtime.lastError && reply?.ok;
      finishSending(button, ok);
    });
  }

  function resolveCarouselVideo(shortcode, index) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Instagram did not return the selected video'));
      }, 10000);
      function onMessage(event) {
        const response = event.data;
        if (event.source !== window || event.origin !== location.origin
            || response?.channel !== CAROUSEL_RESOLVER || response.kind !== 'result'
            || response.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        if (response.error) reject(new Error(response.error));
        else resolve(response.url);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CAROUSEL_RESOLVER, kind: 'resolve', requestId, shortcode, index }, location.origin);
    });
  }

  async function sendCarouselVideo(shortcode, index, button) {
    beginSending(button, 'Finding this carousel video', `instagram:${shortcode}`);
    try {
      await afterLoadingPaint();
      const url = await resolveCarouselVideo(shortcode, index);
      beginSending(button, 'Sending to Anchor', `instagram:${shortcode}`);
      // Let Anchor derive the name and category from the CDN's .mp4 response. A suggestedName bypasses
      // Anchor's automatic category detection and leaves direct CDN files marked as Other.
      chrome.runtime.sendMessage({ type: 'anchor-download', url, referrer: location.href }, (reply) => {
        const ok = !chrome.runtime.lastError && reply?.ok;
        finishSending(button, ok, 'Couldn’t find this video');
      });
    } catch {
      finishSending(button, false, 'Couldn’t find this video');
    }
  }

  function visible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight
        || style.visibility === 'hidden' || style.display === 'none') return false;

    // A Reel opened from the feed leaves its post behind a full-screen overlay. Ignore those
    // background Like icons; the action rail we want must be the one receiving pointer events.
    const button = el.closest('button, [role="button"]');
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!button && !!hit && button.contains(hit);
  }

  function rendered(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
      && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function postLinks(article) {
    const links = [...article.querySelectorAll('a[href]')].map((link) => {
      try {
        const url = new URL(link.href, location.origin);
        const match = url.pathname.match(/^\/(reel|reels|p)\/([^/]+)\/?$/);
        return match ? { type: match[1], shortcode: match[2], imgIndex: Number(url.searchParams.get('img_index')) || null } : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
    const current = location.pathname.match(/^\/(reel|reels|p)\/([^/]+)\/?$/);
    const currentLink = current && links.find(({ type, shortcode }) => type === current[1] && shortcode === current[2]);
    if (currentLink) {
      links.splice(links.indexOf(currentLink), 1);
      links.unshift(currentLink);
    } else if (current) {
      links.unshift({ type: current[1], shortcode: current[2], imgIndex: Number(new URL(location.href).searchParams.get('img_index')) || null });
    } else {
      const videoAnchor = article.querySelector('video')?.closest('a[href]');
      if (videoAnchor) {
        try {
          const url = new URL(videoAnchor.href, location.origin);
          const match = url.pathname.match(/^\/(reel|reels|p)\/([^/]+)\/?$/);
          const linkedPost = match && links.find(({ type, shortcode }) => type === match[1] && shortcode === match[2]);
          if (linkedPost) {
            links.splice(links.indexOf(linkedPost), 1);
            links.unshift(linkedPost);
          }
        } catch {}
      }
    }
    return links;
  }

  function carouselIndex(article, links) {
    const activeSlide = [...article.querySelectorAll('[aria-current="step"][aria-label], [aria-pressed="true"][aria-label]')]
      .map((el) => el.getAttribute('aria-label') || '')
      .map((label) => label.match(/(?:slide|item)\s*(\d+)/i))
      .find(Boolean);
    if (activeSlide) return Number(activeSlide[1]);

    const linkIndex = links.find(({ type, imgIndex }) => type === 'p' && imgIndex)?.imgIndex;
    if (linkIndex) return linkIndex;

    const pageIndex = new URL(location.href).searchParams.get('img_index');
    return Number(pageIndex) || 1;
  }

  function carouselViewport(video, article) {
    for (let node = video.parentElement; node && node !== article; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip'
        || style.overflowX === 'auto' || style.overflowX === 'scroll';
      if (clipsX && node.scrollWidth > node.clientWidth + 1) return node;
    }
    return null;
  }

  function activeTimelineVideo(article, hasCarousel) {
    const videos = [...article.querySelectorAll('video')].filter(rendered);
    if (!hasCarousel) return videos[0] || null;

    // Instagram keeps adjacent carousel slides mounted while they are outside the clipped viewport.
    // Only add the button when a video occupies the actual slide window, not when it is a neighbor.
    return videos.find((video) => {
      const viewport = carouselViewport(video, article);
      if (!viewport) return false;
      const media = video.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      const centerX = media.left + media.width / 2;
      const centerY = media.top + media.height / 2;
      return centerX >= frame.left && centerX <= frame.right
        && centerY >= frame.top && centerY <= frame.bottom;
    }) || null;
  }

  function timelineVideoLink(links, carousel, index) {
    const post = carousel
      ? links.find(({ type }) => type === 'p')
      : links.find(({ type }) => type === 'reel' || type === 'reels') || links.find(({ type }) => type === 'p');
    if (!post) return null;
    const route = carousel || post.type === 'p' ? 'p' : 'reel';
    const slideQuery = carousel ? `?img_index=${index}` : '';
    return `https://www.instagram.com/${route}/${post.shortcode}/${slideQuery}`;
  }

  function syncTimelineVideos() {
    const activeControls = new Set();
    if (!/^\/(?:reel|reels)\//.test(location.pathname)) {
      const posts = [...document.querySelectorAll('article')];
      // Profile and Explore grid posts open in a dialog on some Instagram layouts instead of an article.
      // Use the dialog as a post container only when it has no article with its own video action row.
      for (const dialog of document.querySelectorAll('[role="dialog"]')) {
        const hasArticlePost = [...dialog.querySelectorAll('article')].some((article) =>
          article.querySelector('video') && article.querySelector('svg[aria-label="Save"]')
          && article.querySelector(LIKE_ICONS));
        if (!hasArticlePost) posts.push(dialog);
      }

      for (const article of posts) {
        const links = postLinks(article);
        const hasCarousel = !!article.querySelector('button[aria-label^="Go to slide "]')
          || !!article.querySelector('button[aria-label="Next"], button[aria-label="Go back"]')
          || links.some(({ type, imgIndex }) => type === 'p' && imgIndex);
        if (!activeTimelineVideo(article, hasCarousel)) continue;
        const index = carouselIndex(article, links);
        const url = timelineVideoLink(links, hasCarousel, index);
        if (!url) continue;
        const post = hasCarousel ? links.find(({ type }) => type === 'p') : null;

        const saveIcon = [...article.querySelectorAll('svg[aria-label="Save"]')].find(visible);
        const row = saveIcon?.closest('section');
        if (!saveIcon || !row || ![...row.querySelectorAll(LIKE_ICONS)].some(visible)) continue;
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
          if (post) {
            control.dataset.shortcode = post.shortcode;
            control.dataset.slideIndex = String(index);
          }
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'anchor-ig-button anchor-ig-feed-button';
          button.dataset.loadingKey = loadingKey(url);
          button.title = 'Download this video with Anchor';
          button.setAttribute('aria-label', button.title);
          button.innerHTML = ICON;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (control.dataset.shortcode && control.dataset.slideIndex) {
              sendCarouselVideo(control.dataset.shortcode, Number(control.dataset.slideIndex), button);
            } else {
              send(control.dataset.url, button);
            }
          });
          control.append(button);
          restoreLoading(button);
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
    button.dataset.loadingKey = loadingKey(url);
    button.dataset.url = url;
    button.title = 'Download this Reel with Anchor';
    button.setAttribute('aria-label', 'Download this Reel with Anchor');
    button.innerHTML = ICON;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      send(url, button);
    });
    root.append(button);
    restoreLoading(button);
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
