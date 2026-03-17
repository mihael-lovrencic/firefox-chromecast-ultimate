let currentSession = null;
let playlist = [];
let serverUrl = localStorage.getItem('serverUrl') || '';
let discoveredServerUrl = '';

const statusEl = document.getElementById('status');
const lastSeenEl = document.getElementById('lastSeen');
const devicesSelect = document.getElementById('devices');
const videosContainer = document.getElementById('videos');
const playlistContainer = document.getElementById('playlist');
const serverInput = document.getElementById('serverUrl');
const progressInput = document.getElementById('progress');
const volumeInput = document.getElementById('volume');
const downloadAppBtn = document.getElementById('downloadApp');
const useLocalhostBtn = document.getElementById('useLocalhost');

const REQUEST_TIMEOUT = 5000;
const APP_DOWNLOAD_URL = 'https://github.com/mihael-lovrencic/ChromecastUltimate/releases';
const STATUS_POLL_INTERVAL = 4000;
const STATUS_FAILS_BEFORE_DOWNLOAD = 2;

let statusPollTimer = null;
let statusInFlight = false;
let statusFailCount = 0;
let lastSeenAt = 0;
let selectedDevice = localStorage.getItem('selectedDevice') || '';

function validateServerUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isPrivateIp =
      parsed.hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/) ||
      parsed.hostname.match(/^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])/);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
           (isLocalhost || isPrivateIp);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function updateLastSeen(ts) {
  if (!lastSeenEl) return;
  if (!ts) {
    lastSeenEl.style.display = 'none';
    return;
  }
  const agoSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const text = agoSec < 60 ? `${agoSec}s ago` : `${Math.floor(agoSec / 60)}m ago`;
  lastSeenEl.textContent = `Last seen: ${text}`;
  lastSeenEl.style.display = 'block';
}

function setDownloadVisible(visible) {
  if (!downloadAppBtn) return;
  downloadAppBtn.style.display = visible ? 'block' : 'none';
}

function bumpStatusFail() {
  statusFailCount += 1;
  if (statusFailCount >= STATUS_FAILS_BEFORE_DOWNLOAD) {
    setDownloadVisible(true);
  }
}

function resetStatusFail() {
  statusFailCount = 0;
  setDownloadVisible(false);
  lastSeenAt = Date.now();
  updateLastSeen(lastSeenAt);
}

function updateServerUrl(url) {
  if (!validateServerUrl(url)) {
    setStatus('Invalid server URL. Use local IP (192.168.x.x or 10.x.x.x)');
    return;
  }
  serverUrl = url;
  localStorage.setItem('serverUrl', url);
  loadDevices();
  refreshStatus();
}

async function discoverServer() {
  setStatus('Searching for ChromecastUltimate server...');
  try {
    const services = await getMDNSServices();
    if (services.length > 0) {
      discoveredServerUrl = `http://${services[0].addresses[0]}:5000`;
      if (!validateServerUrl(discoveredServerUrl)) {
        setStatus('Found server but IP not in private range');
        return;
      }
      serverUrl = discoveredServerUrl;
      localStorage.setItem('serverUrl', serverUrl);
      if (serverInput) serverInput.value = serverUrl;
      setStatus(`Found server at ${services[0].addresses[0]}`);
      loadDevices();
    } else {
      setStatus('No server found. Enter IP manually (e.g. http://192.168.x.x:5000 or http://127.0.0.1:5000).');
    }
  } catch (e) {
    console.error('Discovery error:', e);
    setStatus('Discovery failed. Enter IP manually (e.g. http://192.168.x.x:5000 or http://127.0.0.1:5000).');
  }
}

async function getMDNSServices() {
  const found = [];
  
  const checkUrl = async (ip) => {
    try {
      await fetchWithTimeout(`http://${ip}:5000/status`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }, 2000);
      return ip;
    } catch (e) {
      return null;
    }
  };
  
  const localIp = await getLocalIP();
  const subnet = localIp ? localIp.substring(0, localIp.lastIndexOf('.')) : '192.168.1';
  
  const chunks = [];
  for (let i = 1; i <= 254; i += 10) {
    const chunk = [];
    for (let j = i; j < Math.min(i + 10, 255); j++) {
      chunk.push(checkUrl(`${subnet}.${j}`));
    }
    chunks.push(chunk);
  }
  
  for (const chunk of chunks) {
    const results = await Promise.all(chunk);
    const foundIp = results.find(ip => ip !== null);
    if (foundIp) {
      found.push({ addresses: [foundIp], name: 'ChromecastUltimate' });
      break;
    }
  }
  
  return found;
}

async function getLocalIP() {
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    pc.onicecandidate = (e) => {
      if (e.candidate && e.candidate.candidate) {
        const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+)\.\d+/);
        pc.close();
        resolve(match ? match[1] + '.1' : null);
      }
    };
    pc.createOffer().then(o => pc.setLocalDescription(o));
    setTimeout(() => { pc.close(); resolve(null); }, 1000);
  });
}

async function loadDevices() {
  if (!serverUrl || !validateServerUrl(serverUrl)) {
    setStatus('Enter valid server URL first');
    return;
  }
  try {
    const res = await fetchWithTimeout(`${serverUrl}/devices`, {}, 10000);
    const devices = await res.json();
    devicesSelect.innerHTML = '';
    resetStatusFail();
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No devices found';
      devicesSelect.appendChild(opt);
      setStatus('No Chromecast devices found. Make sure server is running.');
    } else {
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.address;
        opt.textContent = d.name || d.address;
        devicesSelect.appendChild(opt);
      });
      if (selectedDevice && devices.some(d => d.address === selectedDevice)) {
        devicesSelect.value = selectedDevice;
      } else if (devices.length === 1) {
        devicesSelect.value = devices[0].address;
        selectedDevice = devices[0].address;
        localStorage.setItem('selectedDevice', selectedDevice);
      }
      setStatus(`Found ${devices.length} device(s)`);
    }
  } catch (e) {
    setStatus('Server not running. Start the server in the Android app.');
    devicesSelect.innerHTML = '<option value="">Server not connected</option>';
    bumpStatusFail();
  }
}

async function refreshStatus() {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  if (statusInFlight) return;
  statusInFlight = true;
  try {
    const res = await fetchWithTimeout(`${serverUrl}/status`, {}, 5000);
    const status = await res.json();
    resetStatusFail();

    if (typeof status.volume === 'number' && volumeInput) {
      volumeInput.value = Math.round(status.volume * 100);
    }

    if (typeof status.durationMs === 'number' && status.durationMs > 0 && progressInput) {
      progressInput.max = status.durationMs;
      const position = typeof status.positionMs === 'number' ? status.positionMs : 0;
      progressInput.value = Math.min(position, status.durationMs);
    }

    if (status.connected === false) {
      setStatus('Not connected to Chromecast. Open the app to connect.');
    }
  } catch (e) {
    // Ignore status errors; server might not be running yet.
    bumpStatusFail();
    updateLastSeen(lastSeenAt);
  } finally {
    statusInFlight = false;
  }
}

async function loadVideos() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('video')).map(v => ({ src: v.currentSrc, type: v.type })).filter(v => v.src)
    });
    const videos = results[0]?.result || [];
    
    videosContainer.innerHTML = '';
    if (videos.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = 'No videos found on this page';
      msg.style.fontSize = '11px';
      msg.style.color = '#666';
      videosContainer.appendChild(msg);
    } else {
      videos.forEach(video => {
        const btn = document.createElement('button');
        btn.className = 'video-btn';
        btn.textContent = `Cast: ${video.src.substring(0, 50)}...`;
        btn.onclick = () => {
          playlist.push(video.src);
          cast(video.src);
          updatePlaylist();
        };
        videosContainer.appendChild(btn);
      });
    }
  } catch (e) {
    console.error('Error loading videos:', e);
  }
}

function updatePlaylist() {
  playlistContainer.innerHTML = '';
  playlist.forEach((url, index) => {
    const el = document.createElement('div');
    el.textContent = `${index + 1}. ${url.substring(0, 60)}...`;
    el.style.fontSize = '11px';
    playlistContainer.appendChild(el);
  });
}

function clearPlaylist() {
  playlist = [];
  updatePlaylist();
}

async function cast(url) {
  if (!serverUrl || !validateServerUrl(serverUrl)) {
    setStatus('Enter valid server URL first');
    return;
  }
  const device = devicesSelect.value;
  if (!device) {
    setStatus('Please select a device first');
    return;
  }
  try {
    const res = await fetchWithTimeout(`${serverUrl}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, device })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      setStatus(result.error || 'Casting failed');
      return;
    }
    setStatus('Casting started: ' + url.substring(0, 40) + '...');
    refreshStatus();
  } catch (e) {
    setStatus('Error casting: ' + e.message);
  }
}

async function control(action) {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    await fetchWithTimeout(`${serverUrl}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    setStatus('Action: ' + action);
    refreshStatus();
  } catch (e) {
    setStatus('Control error: ' + e.message);
  }
}

async function setSeek(value) {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    const ms = parseInt(value, 10);
    await fetchWithTimeout(`${serverUrl}/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: ms })
    });
    refreshStatus();
  } catch (e) {
    console.error('Seek error:', e);
  }
}

async function setVolume(value) {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    const volume = Math.max(0, Math.min(1, parseInt(value, 10) / 100));
    await fetchWithTimeout(`${serverUrl}/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: volume })
    });
    refreshStatus();
  } catch (e) {
    console.error('Volume error:', e);
  }
}

async function addSubtitle(file) {
  if (!file || !serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    const data = await file.text();
    const name = file.name || 'subtitle';
    const lower = name.toLowerCase();
    const format = lower.endsWith('.vtt') ? 'vtt' : lower.endsWith('.srt') ? 'srt' : 'vtt';
    const res = await fetchWithTimeout(`${serverUrl}/subtitle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data, filename: name, format })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      setStatus(result.error || 'Subtitle error');
      return;
    }
    setStatus((result.message || 'Subtitle applied') + ': ' + name);
    refreshStatus();
  } catch (e) {
    setStatus('Subtitle error: ' + e.message);
  }
}

document.getElementById('yt').onclick = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;
  playlist.push(url);
  cast(url);
  updatePlaylist();
};

document.getElementById('mirror').onclick = async () => {
  if (!serverUrl || !validateServerUrl(serverUrl)) {
    setStatus('Enter valid server URL first');
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    await fetchWithTimeout(`${serverUrl}/mirror`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url })
    });
    setStatus('Tab mirroring started');
  } catch (e) {
    setStatus('Mirror error: ' + e.message);
  }
};

document.getElementById('scanVideos').onclick = loadVideos;

document.getElementById('progress').oninput = (e) => setSeek(e.target.value);
document.getElementById('volume').oninput = (e) => setVolume(e.target.value);
document.getElementById('subtitle').onchange = (e) => addSubtitle(e.target.files[0]);

const serverUrlInput = document.getElementById('serverUrl');
if (serverUrlInput) {
  serverUrlInput.addEventListener('change', (e) => updateServerUrl(e.target.value));
}

document.getElementById('discoverServer').onclick = discoverServer;
if (downloadAppBtn) {
  downloadAppBtn.onclick = () => {
    browser.tabs.create({ url: APP_DOWNLOAD_URL });
  };
}
if (useLocalhostBtn) {
  useLocalhostBtn.onclick = () => {
    const localUrl = 'http://127.0.0.1:5000';
    if (serverInput) serverInput.value = localUrl;
    updateServerUrl(localUrl);
  };
}
devicesSelect.addEventListener('change', () => {
  selectedDevice = devicesSelect.value;
  if (selectedDevice) {
    localStorage.setItem('selectedDevice', selectedDevice);
  }
});

loadDevices();
setTimeout(loadVideos, 500);
if (statusPollTimer) clearInterval(statusPollTimer);
statusPollTimer = setInterval(refreshStatus, STATUS_POLL_INTERVAL);
