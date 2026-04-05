const HELPER_URL = 'http://127.0.0.1:4269';

async function helperGet(path) {
  const res = await fetch(`${HELPER_URL}${path}`);
  if (!res.ok) throw new Error(`Helper ${res.status}`);
  return res.json();
}

async function helperPost(path, body) {
  const res = await fetch(`${HELPER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Helper ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'discoverDevices') {
    helperGet('/devices')
      .then(devices => sendResponse(devices))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'castVideo') {
    helperPost('/cast', { url: message.videoUrl, address: message.device?.address })
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

browser.runtime.onInstalled.addListener(() => {
  console.log('Chromecast Ultimate extension installed');
});
