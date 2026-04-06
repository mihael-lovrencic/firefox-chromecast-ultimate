let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
let serverUrl = localStorage.getItem('serverUrl') || '';

const statusEl = document.getElementById('status');
const discoveredDevicesContainer = document.getElementById('discoveredDevices');
const loadingIndicator = document.getElementById('loadingIndicator');
const videosList = document.getElementById('videosList');
const serverUrlInput = document.getElementById('serverUrl');

function setStatus(message) {
  statusEl.textContent = message;
}

function showLoading(show) {
  if (loadingIndicator) {
    loadingIndicator.style.display = show ? 'flex' : 'none';
  }
}

function isDirectMediaUrl(url) {
  return typeof url === 'string' && (url.includes('.m3u8') || url.includes('.mp4'));
}

function shouldProxy(url, headers = []) {
  if (!url) return false;
  if (/youtube\.com|youtu\.be/i.test(url)) return false;
  if (url.includes('.m3u8')) return true;
  if (url.includes('.mp4')) {
    return headers.some(h => {
      const name = (h.name || '').toLowerCase();
      return name === 'cookie' || name === 'authorization';
    });
  }
  return true;
}

async function ensureHelperReady() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'ensureHelper' });
    if (res && res.error) {
      throw new Error(res.error);
    }
  } catch (error) {
    throw new Error(error.message || 'Helper not reachable');
  }
}

async function scanForChromecasts() {
  showLoading(true);
  setStatus('Scanning for Chromecasts...');
  discoveredDevicesContainer.innerHTML = '';

  try {
    if (currentMode === 'standalone') {
      await ensureHelperReady();
    }

    const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
    showLoading(false);

    if (!devices || devices.error) {
      throw new Error(devices?.error || 'No devices found');
    }

    if (devices.length === 0) {
      setStatus('No Chromecasts found. Check network.');
      return;
    }

    setStatus(`Found ${devices.length} device(s)`);

    devices.forEach(device => {
      const btn = document.createElement('button');
      btn.className = 'device-btn';
      btn.dataset.address = device.address || '';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('fill', 'currentColor');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11z');
      svg.appendChild(path);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'device-name';
      nameSpan.textContent = device.name || 'Chromecast';

      const ipSpan = document.createElement('span');
      ipSpan.className = 'device-ip';
      ipSpan.textContent = device.address || 'Unknown address';

      btn.appendChild(svg);
      btn.appendChild(nameSpan);
      btn.appendChild(ipSpan);

      btn.onclick = () => selectDevice(device);
      discoveredDevicesContainer.appendChild(btn);
    });

    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
  } catch (error) {
    showLoading(false);
    setStatus('Scan failed: ' + error.message);
  }
}

function selectDevice(device) {
  selectedDevice = device;
  setStatus(`Selected: ${device.name || device.address}`);
  document.querySelectorAll('.device-btn').forEach(el => el.classList.remove('selected'));
  const btn = document.querySelector(`.device-btn[data-address="${device.address}"]`);
  if (btn) {
    btn.classList.add('selected');
  }
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function resolveVideoUrl(initialUrl, tabUrl) {
  let finalUrl = initialUrl;
  let headers = [];

  if (!/youtube\.com|youtu\.be/i.test(finalUrl) && !isDirectMediaUrl(finalUrl)) {
    const lastReq = await browser.runtime.sendMessage({ type: 'getLastMediaRequest' });
    if (lastReq && lastReq.data && isDirectMediaUrl(lastReq.data.url)) {
      finalUrl = lastReq.data.url;
      headers = Array.isArray(lastReq.data.headers) ? lastReq.data.headers : [];
      setStatus('Using captured stream URL');
    } else {
      const lastUrl = await browser.runtime.sendMessage({ type: 'getLastMediaUrl' });
      if (lastUrl && isDirectMediaUrl(lastUrl.url)) {
        finalUrl = lastUrl.url;
        setStatus('Using captured stream URL');
      }
    }
  } else if (isDirectMediaUrl(finalUrl)) {
    const lastReq = await browser.runtime.sendMessage({ type: 'getLastMediaRequest' });
    if (lastReq && lastReq.data && lastReq.data.url === finalUrl) {
      headers = Array.isArray(lastReq.data.headers) ? lastReq.data.headers : [];
    }
  }

  if (/youtube\.com|youtu\.be/i.test(tabUrl || '')) {
    finalUrl = tabUrl;
  }

  if (!/youtube\.com|youtu\.be/i.test(finalUrl) && !isDirectMediaUrl(finalUrl)) {
    throw new Error('No stream URL captured. Play the video for a few seconds, then cast.');
  }

  return { finalUrl, headers };
}

async function castVideo(videoUrl) {
  if (!selectedDevice && currentMode === 'standalone') {
    setStatus('Please select a Chromecast first');
    return;
  }

  setStatus('Casting...');

  try {
    const tab = await getActiveTab();
    const tabUrl = tab?.url || '';

    if (currentMode === 'standalone') {
      await ensureHelperReady();
      const { finalUrl, headers } = await resolveVideoUrl(videoUrl, tabUrl);
      const response = await browser.runtime.sendMessage({
        type: 'castVideo',
        videoUrl: finalUrl,
        device: selectedDevice,
        useProxy: shouldProxy(finalUrl, headers),
        referer: tabUrl,
        headers
      });
      if (response && response.error) {
        throw new Error(response.error);
      }
      setStatus('Casting started!');
      return;
    }

    if (!serverUrl) {
      throw new Error('Connect Android server first');
    }

    const response = await fetch(`${serverUrl}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setStatus('Casting started!');
  } catch (error) {
    setStatus('Cast failed: ' + error.message);
  }
}

async function scanVideos() {
  try {
    const tab = await getActiveTab();
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.currentSrc || v.src,
        width: v.offsetWidth,
        height: v.offsetHeight
      })).filter(v => v.src)
    });

    const videos = results[0]?.result || [];
    videosList.innerHTML = '';

    if (videos.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color: #888; font-size: 12px; padding: 10px;';
      msg.textContent = 'No videos found';
      videosList.appendChild(msg);
      return;
    }

    videos.forEach((video, index) => {
      const btn = document.createElement('button');
      btn.className = 'device-btn';
      btn.style.background = '#333';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'device-name';
      nameSpan.textContent = `Video ${index + 1}`;
      const ipSpan = document.createElement('span');
      ipSpan.className = 'device-ip';
      ipSpan.textContent = `${video.width}x${video.height}`;
      btn.appendChild(nameSpan);
      btn.appendChild(ipSpan);
      btn.onclick = () => castVideo(video.src);
      videosList.appendChild(btn);
    });
  } catch (error) {
    setStatus('Scan videos failed: ' + error.message);
  }
}

function setMode(mode) {
  currentMode = mode;
  localStorage.setItem('castMode', mode);

  document.getElementById('modeStandalone').classList.toggle('active', mode === 'standalone');
  document.getElementById('modeAndroid').classList.toggle('active', mode === 'android');
  document.getElementById('standaloneSection').classList.toggle('active', mode === 'standalone');
  document.getElementById('androidSection').classList.toggle('active', mode === 'android');

  if (mode === 'standalone') {
    setStatus('Standalone mode - helper powered casting');
    scanForChromecasts();
  } else {
    setStatus('Android mode - connect to server');
  }
}

async function sendControl(action) {
  try {
    const response = await browser.runtime.sendMessage({ type: 'control', action });
    if (response && response.error) {
      throw new Error(response.error);
    }
    setStatus(`Action: ${action}`);
  } catch (error) {
    setStatus(`Control failed: ${error.message}`);
  }
}

document.getElementById('modeStandalone').onclick = () => setMode('standalone');
document.getElementById('modeAndroid').onclick = () => setMode('android');
document.getElementById('scanBtn').onclick = scanForChromecasts;
document.getElementById('scanVideosBtn').onclick = scanVideos;
document.getElementById('playBtn').onclick = () => sendControl('play');
document.getElementById('pauseBtn').onclick = () => sendControl('pause');
document.getElementById('stopBtn').onclick = () => sendControl('stop');
document.getElementById('castCurrentBtn').onclick = async () => {
  const tab = await getActiveTab();
  if (tab.url) {
    castVideo(tab.url);
  }
};

document.getElementById('connectBtn').onclick = () => {
  serverUrl = serverUrlInput.value;
  localStorage.setItem('serverUrl', serverUrl);
  setStatus('Connected to: ' + serverUrl);
};

if (serverUrlInput) {
  serverUrlInput.value = serverUrl;
}

setMode(currentMode);
