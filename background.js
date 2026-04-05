const HELPER_URLS = ['http://localhost:4269', 'http://127.0.0.1:4269'];
let lastDevice = null;
const NATIVE_HOST_NAME = 'chromecast_ultimate_helper';

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

async function ensureHelperRunning() {
  try {
    await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { type: 'ensureHelper' });
  } catch (e) {
    console.warn('[Native] Helper not available:', e?.message || e);
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

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
        const cookie = await getCookieHeader(message.referer || '');
        const payload = {
          url: message.videoUrl,
          device,
          useProxy: !!message.useProxy,
          referer: message.referer || '',
          cookie
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
