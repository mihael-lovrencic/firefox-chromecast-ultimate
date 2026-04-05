let currentSession = null;
let playlist = [];
let serverUrl = localStorage.getItem('serverUrl') || '';
let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
const HELPER_URL = 'http://localhost:4269';

console.log('popup.js loaded!');

const statusEl = document.getElementById('status');
if (!statusEl) console.error('status element not found!');
const devicesSelect = document.getElementById('devices');
const videosContainer = document.getElementById('videos');
const playlistContainer = document.getElementById('playlist');
const serverInput = document.getElementById('serverUrl');
const discoveredDevicesContainer = document.getElementById('discoveredDevices');
if (!discoveredDevicesContainer) console.error('discoveredDevices element not found!');
const helperStatusEl = document.getElementById('helperStatus');
const helperDevicesEl = document.getElementById('helperDevices');

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

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function refreshHelperStatus() {
  if (currentMode !== 'standalone') return;
  if (helperStatusEl) helperStatusEl.textContent = 'Checking helper...';
  try {
    const res = await fetch(`${HELPER_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (helperStatusEl) helperStatusEl.textContent = 'Helper: running';
    const devices = await fetch(`${HELPER_URL}/devices`).then(r => r.json());
    if (helperDevicesEl) helperDevicesEl.textContent = `Helper devices: ${devices.length}`;
  } catch (e) {
    if (helperStatusEl) helperStatusEl.textContent = 'Helper: not reachable';
    if (helperDevicesEl) helperDevicesEl.textContent = '';
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
    setStatus('Standalone mode - scanning for Chromecasts...');
    refreshHelperStatus();
    scanForChromecasts();
  } else {
    setStatus('Android mode - connecting to server...');
    loadDevices();
  }
}

document.getElementById('modeStandalone').onclick = () => setMode('standalone');
document.getElementById('modeAndroid').onclick = () => setMode('android');

async function scanForChromecasts() {
  setStatus('Scanning for Chromecasts...');
  discoveredDevicesContainer.innerHTML = '<button id="scanDevices" style="background:#34a853;">Scanning...</button><div id="scanDebug" style="font-size:10px;margin-top:5px;color:#666;"></div>';
  
  const debugEl = document.getElementById('scanDebug');
  const log = (msg) => {
    console.log(msg);
    if (debugEl) debugEl.textContent += msg + '\n';
  };
  
  log('Starting discovery...');
  
  try {
    log('Sending message to background script...');
    const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
    if (devices && devices.error) {
      throw new Error(devices.error);
    }
    log('Got response: ' + JSON.stringify(devices));
    
    discoveredDevicesContainer.innerHTML = '';
    
    if (!devices || devices.length === 0) {
      setStatus('No Chromecasts found. Check network access.');
      log('No devices found');
      const btn = document.createElement('button');
      btn.style.background = '#34a853';
      btn.textContent = 'Scan for Chromecasts';
      btn.onclick = scanForChromecasts;
      discoveredDevicesContainer.appendChild(btn);
      return;
    }
    
    log('Found ' + devices.length + ' device(s)!');
    
    devices.forEach(device => {
      const div = document.createElement('div');
      div.className = 'discovered-device';
      const nameEl = document.createElement('strong');
      nameEl.textContent = device.name || device.address;
      const br = document.createElement('br');
      const small = document.createElement('small');
      small.textContent = device.address;
      div.appendChild(nameEl);
      div.appendChild(br);
      div.appendChild(small);
      div.onclick = () => selectDevice(device);
      discoveredDevicesContainer.appendChild(div);
    });
    
    setStatus(`Found ${devices.length} Chromecast(s)`);
    
    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
  } catch (e) {
    console.error('Discovery error:', e);
    setStatus('Discovery failed: ' + e.message + '. Start helper on this device.');
    log('ERROR: ' + e.message);
  }
}

async function selectDevice(device) {
  selectedDevice = device;
  setStatus(`Selected: ${device.name || device.address}`);
  
  document.querySelectorAll('.discovered-device').forEach(el => {
    el.style.background = '#e8f0fe';
  });
  
  const selectedEl = Array.from(document.querySelectorAll('.discovered-device')).find(el => 
    el.textContent.includes(device.address)
  );
  if (selectedEl) {
    selectedEl.style.background = '#34a853';
    selectedEl.style.color = 'white';
  }
}

async function castToChromecast(url) {
  if (!selectedDevice) {
    setStatus('Select a Chromecast first');
    return;
  }
  
  try {
    let referer = '';
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      referer = tab?.url || '';
    } catch (_) {}
    const useProxy = shouldProxy(url);
    const res = await browser.runtime.sendMessage({
      type: 'castVideo',
      videoUrl: url,
      device: selectedDevice,
      useProxy,
      referer
    });
    if (res && res.error) throw new Error(res.error);
    setStatus(`Casting to ${selectedDevice.name || selectedDevice.address}`);
  } catch (e) {
    console.error('Cast error:', e);
    setStatus('Cast failed: ' + e.message + '. Is helper running?');
  }
}

async function discoverServer() {
  setStatus('Searching for ChromecastUltimate server...');
  try {
    const services = await getMDNSServices();
    if (services.length > 0) {
      serverUrl = `http://${services[0].addresses[0]}:5000`;
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
      await fetch(`http://${ip}:5000/status`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
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
    const res = await fetch(`${serverUrl}/devices`);
    const devices = await res.json();
    devicesSelect.innerHTML = '';
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No devices found';
      devicesSelect.appendChild(opt);
      setStatus('No Chromecast devices found.');
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
          if (currentMode === 'standalone') {
            playlist.push(video.src);
            castToChromecast(video.src);
            updatePlaylist();
          } else {
            playlist.push(video.src);
            cast(video.src);
            updatePlaylist();
          }
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
  try {
    const res = await fetch(`${serverUrl}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    setStatus('Casting started: ' + url.substring(0, 40) + '...');
  } catch (e) {
    setStatus('Error casting: ' + e.message);
  }
}

async function control(action) {
  if (currentMode === 'standalone') {
    if (!selectedDevice) return;
    try {
      await browser.runtime.sendMessage({ type: 'control', action });
      setStatus('Action: ' + action);
    } catch (e) {
      setStatus('Control error: ' + e.message);
    }
    return;
  }
  
  if (!serverUrl || !validateServerUrl(serverUrl)) return;
  try {
    await fetch(`${serverUrl}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    setStatus('Action: ' + action);
  } catch (e) {
    setStatus('Control error: ' + e.message);
  }
}

document.getElementById('yt').onclick = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;
  playlist.push(url);
  if (currentMode === 'standalone') {
    castToChromecast(url);
  } else {
    cast(url);
  }
  updatePlaylist();
};

document.getElementById('mirror').onclick = async () => {
  if (currentMode === 'standalone') {
    setStatus('Mirroring not supported in standalone mode');
    return;
  }
  if (!serverUrl || !validateServerUrl(serverUrl)) {
    setStatus('Enter valid server URL first');
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    await fetch(`${serverUrl}/mirror`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url })
    });
    setStatus('Tab mirroring started');
  } catch (e) {
    setStatus('Mirror error: ' + e.message);
  }
};

document.getElementById('playBtn').onclick = () => control('play');
document.getElementById('pauseBtn').onclick = () => control('pause');
document.getElementById('stopBtn').onclick = () => control('stop');
document.getElementById('clearPlaylist').onclick = clearPlaylist;
document.getElementById('scanVideos').onclick = loadVideos;
document.getElementById('discoverServer').onclick = discoverServer;

const serverUrlInput = document.getElementById('serverUrl');
if (serverUrlInput) {
  serverUrlInput.value = serverUrl;
  serverUrlInput.addEventListener('change', (e) => {
    serverUrl = e.target.value;
    localStorage.setItem('serverUrl', serverUrl);
    loadDevices();
  });
}

setMode(currentMode);
setTimeout(loadVideos, 500);
setInterval(refreshHelperStatus, 4000);

function shouldProxy(url) {
  if (!url) return false;
  if (/youtube\.com|youtu\.be/i.test(url)) return false;
  return true;
}
