const HELPER_URL = 'http://127.0.0.1:4269';
let lastDevice = null;

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

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'discoverDevices') {
    helperRequest('/devices')
      .then(devices => sendResponse(devices))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'castVideo') {
    (async () => {
      try {
        const device = message.device || lastDevice;
        const payload = {
          url: message.videoUrl,
          device
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
