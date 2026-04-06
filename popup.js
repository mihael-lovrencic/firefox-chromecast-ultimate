let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
let serverUrl = localStorage.getItem('serverUrl') || '';

const statusEl = document.getElementById('status');
const discoveredDevicesContainer = document.getElementById('discoveredDevices');
const loadingIndicator = document.getElementById('loadingIndicator');
const videosList = document.getElementById('videosList');
const serverUrlInput = document.getElementById('serverUrl');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function showLoading(show) {
  if (loadingIndicator) {
    loadingIndicator.style.display = show ? 'flex' : 'none';
  }
}

async function scanForChromecasts() {
  showLoading(true);
  setStatus('Scanning for Chromecasts...');
  discoveredDevicesContainer.innerHTML = '';
  
  try {
    const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
    
    showLoading(false);
    
    if (!devices || devices.length === 0) {
      setStatus('No Chromecasts found. Check network.');
      return;
    }
    
    setStatus(`Found ${devices.length} device(s)`);
    
    devices.forEach(device => {
      const btn = document.createElement('button');
      btn.className = 'device-btn';
      btn.dataset.address = device.address;
      
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('fill', 'currentColor');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z');
      svg.appendChild(path);
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'device-name';
      nameSpan.textContent = device.name || 'Chromecast';
      
      const ipSpan = document.createElement('span');
      ipSpan.className = 'device-ip';
      ipSpan.textContent = device.address;
      
      btn.appendChild(svg);
      btn.appendChild(nameSpan);
      btn.appendChild(ipSpan);
      
      btn.onclick = () => selectDevice(device);
      discoveredDevicesContainer.appendChild(btn);
    });
    
    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
  } catch (e) {
    showLoading(false);
    setStatus('Scan failed: ' + e.message);
  }
}

function selectDevice(device) {
  selectedDevice = device;
  setStatus(`Selected: ${device.name || device.address}`);
  
  document.querySelectorAll('.device-btn').forEach(el => el.classList.remove('selected'));
  
  const btn = document.querySelector(`.device-btn[data-address="${device.address}"]`);
  if (btn) btn.classList.add('selected');
}

async function castVideo(videoUrl) {
  if (!selectedDevice && currentMode === 'standalone') {
    setStatus('Please select a Chromecast first');
    return;
  }
  
  setStatus('Casting...');
  
  try {
    await browser.runtime.sendMessage({
      type: 'castVideo',
      videoUrl: videoUrl,
      device: selectedDevice
    });
    setStatus('Casting started!');
  } catch (e) {
    setStatus('Cast failed: ' + e.message);
  }
}

async function scanVideos() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    const videos = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('video')).map(v => ({ src: v.currentSrc || v.src, width: v.offsetWidth, height: v.offsetHeight })).filter(v => v.src)
    });
    
    videosList.innerHTML = '';
    
    if (!videos || videos.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color: #888; font-size: 12px; padding: 10px;';
      msg.textContent = 'No videos found';
      videosList.appendChild(msg);
      return;
    }
    
    videos[0].forEach((video, i) => {
      const btn = document.createElement('button');
      btn.className = 'device-btn';
      btn.style.background = '#333';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'device-name';
      nameSpan.textContent = `Video ${i + 1}`;
      const ipSpan = document.createElement('span');
      ipSpan.className = 'device-ip';
      ipSpan.textContent = `${video.width}x${video.height}`;
      btn.appendChild(nameSpan);
      btn.appendChild(ipSpan);
      btn.onclick = () => castVideo(video.src);
      videosList.appendChild(btn);
    });
  } catch (e) {
    setStatus('Scan videos failed: ' + e.message);
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
    setStatus('Standalone mode - no helper needed!');
    scanForChromecasts();
  } else {
    setStatus('Android mode - connect to server');
  }
}

document.getElementById('modeStandalone').onclick = () => setMode('standalone');
document.getElementById('modeAndroid').onclick = () => setMode('android');
document.getElementById('scanBtn').onclick = scanForChromecasts;
document.getElementById('scanVideosBtn').onclick = scanVideos;
document.getElementById('playBtn').onclick = () => browser.runtime.sendMessage({ type: 'control', action: 'play' });
document.getElementById('pauseBtn').onclick = () => browser.runtime.sendMessage({ type: 'control', action: 'pause' });
document.getElementById('stopBtn').onclick = () => browser.runtime.sendMessage({ type: 'control', action: 'stop' });
document.getElementById('castCurrentBtn').onclick = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab.url) castVideo(tab.url);
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
