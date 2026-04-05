const HELPER_URL = 'http://localhost:4269';
let lastDevice = null;
const NATIVE_HOST_NAME = 'chromecast_ultimate_helper';

async function helperRequest(path, options = {}) {
  const res = await fetch(`${HELPER_URL}${path}`, {
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
}

async function ensureHelperRunning() {
  try {
    await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { type: 'ensureHelper' });
  } catch (e) {
    console.warn('[Native] Helper not available:', e?.message || e);
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
        const payload = {
          url: message.videoUrl,
          device,
          useProxy: !!message.useProxy,
          referer: message.referer || ''
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
