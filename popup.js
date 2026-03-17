let currentSession = null;
let playlist = [];
let serverUrl = localStorage.getItem('serverUrl') || '';
let discoveredServerUrl = '';

const statusEl = document.getElementById('status');
const devicesSelect = document.getElementById('devices');
const videosContainer = document.getElementById('videos');
const playlistContainer = document.getElementById('playlist');
const serverInput = document.getElementById('serverUrl');

const REQUEST_TIMEOUT = 5000;

function validateServerUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && 
           (parsed.hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/) || 
            parsed.hostname.match(/^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])/));
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

function updateServerUrl(url) {
  if (!validateServerUrl(url)) {
    setStatus('Invalid server URL. Use local IP (192.168.x.x or 10.x.x.x)');
    return;
  }
  serverUrl = url;
  localStorage.setItem('serverUrl', url);
  loadDevices();
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
      setStatus('No server found. Enter IP manually.');
    }
  } catch (e) {
    console.error('Discovery error:', e);
    setStatus('Discovery failed. Enter IP manually.');
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
      setStatus(`Found ${devices.length} device(s)`);
    }
  } catch (e) {
    setStatus('Server not running. Start server.js first.');
    devicesSelect.innerHTML = '<option value="">Server not connected</option>';
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
      body: JSON.stringify({ url })
    });
    const result = await res.json();
    setStatus('Casting started: ' + url.substring(0, 40) + '...');
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
  } catch (e) {
    setStatus('Control error: ' + e.message);
  }
}

async function setSeek(value) {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    await fetchWithTimeout(`${serverUrl}/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (e) {
    console.error('Seek error:', e);
  }
}

async function setVolume(value) {
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    await fetchWithTimeout(`${serverUrl}/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (e) {
    console.error('Volume error:', e);
  }
}

async function addSubtitle(file) {
  setStatus('Subtitles not supported by Android app');
  return;
  if (!file || !serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    const data = await file.text();
    await fetchWithTimeout(`${serverUrl}/subtitle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data })
    });
    setStatus('Subtitle loaded: ' + file.name);
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

loadDevices();
setTimeout(loadVideos, 500);