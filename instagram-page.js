// Resolves one Instagram carousel item in the page's authenticated context. The app-side yt-dlp
// probe treats some selected carousel URLs as generic files, so pass Anchor the selected MP4 URL.
(() => {
  const CHANNEL = 'anchor-instagram-carousel-resolver-v1';
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const APP_ID = '936619743392459';
  const GRAPHQL_DOC_ID = '8845758582119845';

  function shortcodeId(shortcode) {
    let id = 0n;
    for (const char of shortcode) {
      const digit = ALPHABET.indexOf(char);
      if (digit < 0) throw new Error('Invalid Instagram post code');
      id = id * 64n + BigInt(digit);
    }
    return id.toString();
  }

  function requestHeaders() {
    const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    const headers = {
      'x-ig-app-id': APP_ID,
      'x-requested-with': 'XMLHttpRequest',
    };
    if (csrf) headers['x-csrftoken'] = decodeURIComponent(csrf);
    const claim = sessionStorage.getItem('www-claim-v2');
    if (claim) headers['x-ig-www-claim'] = claim;
    return headers;
  }

  async function lookupPostId(shortcode) {
    const body = new URLSearchParams({
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
      doc_id: GRAPHQL_DOC_ID,
      variables: JSON.stringify({ shortcode }),
    });
    const response = await fetch('/graphql/query/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...requestHeaders(),
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': 'PolarisPostActionLoadPostQueryQuery',
      },
      body,
    });
    if (!response.ok) throw new Error(`Instagram returned ${response.status}`);
    const data = await response.json();
    const id = data.data?.xdt_shortcode_media?.id;
    if (!id) throw new Error('Could not identify the Instagram post');
    return id;
  }

  async function postInfo(shortcode) {
    const headers = requestHeaders();
    let response = await fetch(`/api/v1/media/${shortcodeId(shortcode)}/info/`, {
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      const id = await lookupPostId(shortcode);
      response = await fetch(`/api/v1/media/${id}/info/`, { credentials: 'include', headers });
    }
    if (!response.ok) throw new Error(`Instagram returned ${response.status}`);
    return response.json();
  }

  function bestVideo(item) {
    const versions = item?.video_versions;
    if (!Array.isArray(versions) || versions.length === 0) return null;
    return versions.reduce((best, current) => {
      const currentArea = (current.width || 0) * (current.height || 0);
      const bestArea = (best.width || 0) * (best.height || 0);
      return currentArea > bestArea ? current : best;
    });
  }

  async function resolve(shortcode, index) {
    if (!/^[A-Za-z0-9_-]{5,20}$/.test(shortcode) || !Number.isInteger(index) || index < 1 || index > 100) {
      throw new Error('Invalid carousel selection');
    }
    const data = await postInfo(shortcode);
    const post = data.items?.[0];
    const items = Array.isArray(post?.carousel_media) ? post.carousel_media : [post].filter(Boolean);
    const selected = items[index - 1];
    const video = bestVideo(selected);
    if (!video?.url) throw new Error('The selected carousel slide is not a downloadable video');

    const url = new URL(video.url);
    if (url.protocol !== 'https:' || !/\.(?:fbcdn\.net|cdninstagram\.com)$/i.test(url.hostname)
        || !/\.mp4$/i.test(url.pathname)) {
      throw new Error('Instagram returned an unsupported video URL');
    }
    return { url: url.href };
  }

  window.addEventListener('message', async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin
        || request?.channel !== CHANNEL || request?.kind !== 'resolve') return;
    try {
      const result = await resolve(request.shortcode, request.index);
      window.postMessage({ channel: CHANNEL, kind: 'result', requestId: request.requestId, ...result }, location.origin);
    } catch (error) {
      window.postMessage({ channel: CHANNEL, kind: 'result', requestId: request.requestId,
        error: error instanceof Error ? error.message : 'Could not resolve this Instagram video' }, location.origin);
    }
  });
})();
