const HELPER_URLS = ['http://localhost:4269', 'http://127.0.0.1:4269'];
let lastDevice = null;
const NATIVE_HOST_NAME = 'chromecast_ultimate_helper';
const lastMediaUrlByTab = new Map();
const lastMediaRequestByTab = new Map();
const HELPER_WAIT_ATTEMPTS = 20;
const HELPER_WAIT_DELAY_MS = 300;

function looksBase64(value) {
  return typeof value === 'string' && value.length >= 8 && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function decodeMaybeBase64(value) {
  try {
    return atob(value.replace(/[-_]/g, '+').replace(/ /g, '+'));
  } catch (_) {
    return null;
  }
}

function extractMediaUrl(raw) {
  try {
    if (!raw || typeof raw !== 'string') return null;
    const direct = raw.match(/https?:\/\/[^"'\\s]+?\.(m3u8|mp4)([^"'\\s]*)/i);
    if (direct && direct[0]) return direct[0];

    const parsed = new URL(raw);
    for (const [, value] of parsed.searchParams.entries()) {
      const candidate = decodeURIComponent(value);
      if (candidate.includes('.m3u8') || candidate.includes('.mp4')) return candidate;
      const embedded = candidate.match(/https?:\/\/[^"'\\s]+?\.(m3u8|mp4)([^"'\\s]*)/i);
      if (embedded && embedded[0]) return embedded[0];
      if (looksBase64(candidate)) {
        const decoded = decodeMaybeBase64(candidate);
        if (decoded && (decoded.includes('.m3u8') || decoded.includes('.mp4'))) return decoded;
      }
      if (looksBase64(value)) {
        const decoded = decodeMaybeBase64(value);
        if (decoded && (decoded.includes('.m3u8') || decoded.includes('.mp4'))) return decoded;
      }
    }
  } catch (_) {}
  return null;
}

async function helperRequest(path, options = {}) {
  const request = async (baseUrl) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || { 'Content-Type': 'application/json' },
      body: options.body
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch (_) {}
      throw new Error(message);
    }
    return res.json();
  };

  let lastError;
  for (const base of HELPER_URLS) {
    try {
      return await request(base);
    } catch (e) {
      lastError = e;
      if (e && e.message && e.message.includes('NetworkError')) {
        await ensureHelperRunning();
        await new Promise(r => setTimeout(r, 500));
        try {
          return await request(base);
        } catch (e2) {
          lastError = e2;
        }
      }
    }
  }
  throw lastError || new Error('Helper not reachable');
}

async function isHelperReachable() {
  for (const base of HELPER_URLS) {
    try {
      const res = await fetch(`${base}/status`);
      if (res.ok) return true;
    } catch (_) {}
  }
  return false;
}

async function waitForHelperReady() {
  for (let i = 0; i < HELPER_WAIT_ATTEMPTS; i++) {
    if (await isHelperReachable()) return true;
    await new Promise(r => setTimeout(r, HELPER_WAIT_DELAY_MS));
  }
  return false;
}

async function ensureHelperRunning() {
  if (await isHelperReachable()) {
    return true;
  }
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { type: 'ensureHelper' });
    if (!response || response.ok !== true) {
      throw new Error(response?.error || 'Native host failed to start helper');
    }
    const ready = await waitForHelperReady();
    if (!ready) {
      throw new Error('Helper not reachable after startup');
    }
    return true;
  } catch (e) {
    console.warn('[Native] Helper not available:', e?.message || e);
    throw e;
  }
}

async function getCookieHeader(url) {
  if (!url) return '';
  try {
    const cookies = await browser.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return '';
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.warn('[Cookies] Failed to read cookies:', e?.message || e);
    return '';
  }
}

function mergeCookieHeaders(...cookieStrings) {
  const jar = new Map();
  for (const cookieString of cookieStrings) {
    if (!cookieString) continue;
    cookieString.split(';').forEach(part => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const name = trimmed.slice(0, idx);
      const value = trimmed.slice(idx + 1);
      jar.set(name, value);
    });
  }
  if (jar.size === 0) return '';
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'mediaUrl') {
    const tabId = sender?.tab?.id;
    if (tabId != null && message.url) {
      lastMediaUrlByTab.set(tabId, message.url);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'getLastMediaUrl') {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender?.tab?.id;
    const url = tabId != null ? lastMediaUrlByTab.get(tabId) : null;
    sendResponse({ url: url || null });
    return true;
  }

  if (message.type === 'getLastMediaRequest') {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender?.tab?.id;
    const data = tabId != null ? lastMediaRequestByTab.get(tabId) : null;
    sendResponse({ data: data || null });
    return true;
  }

  if (message.type === 'getCaptureDebug') {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender?.tab?.id;
    const data = tabId != null ? lastMediaRequestByTab.get(tabId) : null;
    const mediaUrl = tabId != null ? lastMediaUrlByTab.get(tabId) : null;
    sendResponse({
      data: data || null,
      mediaUrl: mediaUrl || null
    });
    return true;
  }

  if (message.type === 'ensureHelper') {
    ensureHelperRunning()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'discoverDevices') {
    ensureHelperRunning()
      .then(() => helperRequest('/devices'))
      .then(devices => sendResponse(devices))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'castVideo') {
    (async () => {
      try {
        await ensureHelperRunning();
        const device = message.device || lastDevice;
        const cookieForReferer = await getCookieHeader(message.referer || '');
        const cookieForMedia = await getCookieHeader(message.videoUrl || '');
        const cookie = mergeCookieHeaders(cookieForReferer, cookieForMedia);
        let origin = '';
        try {
          origin = message.referer ? new URL(message.referer).origin : '';
        } catch (_) {}
        const payload = {
          url: message.videoUrl,
          device,
          useProxy: !!message.useProxy,
          streamType: message.streamType || '',
          contentType: message.contentType || '',
          referer: message.referer || '',
          cookie,
          origin,
          headers: Array.isArray(message.headers) ? message.headers : [],
          subtitles: Array.isArray(message.subtitles) ? message.subtitles : []
        };
        await helperRequest('/cast', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (device) lastDevice = device;
        sendResponse({ success: true });
      } catch (e) {
        console.error('[Background] Cast error:', e);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (message.type === 'control') {
    (async () => {
      try {
        await ensureHelperRunning();
        const payload = {
          action: message.action,
          device: lastDevice
        };
        await helperRequest('/control', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (message.type === 'stopCast') {
    (async () => {
      try {
        await ensureHelperRunning();
        await helperRequest('/stop', {
          method: 'POST',
          body: JSON.stringify({ device: lastDevice })
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

browser.runtime.onInstalled.addListener(() => {
  console.log('Chromecast Ultimate extension installed');
});

function normalizeHeaders(headers) {
  if (!Array.isArray(headers)) return [];
  return headers
    .filter(h => h && h.name && typeof h.value === 'string')
    .map(h => ({ name: h.name, value: h.value }));
}

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details || details.tabId < 0 || !details.url) return;
    const url = extractMediaUrl(details.url) || details.url;
    const isMedia = url.includes('.m3u8') || url.includes('.mp4');
    if (!isMedia) return;
    const headers = normalizeHeaders(details.requestHeaders || []);
    lastMediaRequestByTab.set(details.tabId, { url, headers, ts: Date.now() });
    lastMediaUrlByTab.set(details.tabId, url);
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);
