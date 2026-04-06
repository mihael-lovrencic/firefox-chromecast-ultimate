let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
let serverUrl = localStorage.getItem('serverUrl') || '';

const statusTextEl = document.getElementById('statusText');
const statusDotEl = document.getElementById('statusDot');
const devicesListEl = document.getElementById('devicesList');
const loadingStateEl = document.getElementById('loadingState');
const emptyStateEl = document.getElementById('emptyState');

function setStatus(message, type = 'default') {
  if (statusTextEl) statusTextEl.textContent = message;
  if (statusDotEl) {
    statusDotEl.className = 'status-dot';
    if (type === 'searching') statusDotEl.classList.add('searching');
    if (type === 'error') statusDotEl.classList.add('error');
    if (type === 'success') statusDotEl.style.background = '#34a853';
  }
}

function showLoading(show) {
  if (loadingStateEl) loadingStateEl.style.display = show ? 'block' : 'none';
}

function showEmpty(show) {
  if (emptyStateEl) emptyStateEl.style.display = show ? 'block' : 'none';
}

function clearDevices() {
  if (devicesListEl) devicesListEl.innerHTML = '';
}

function addDevice(device) {
  if (!devicesListEl) return;
  
  const card = document.createElement('div');
  card.className = 'device-card';
  card.dataset.address = device.address || '';
  
  const iconDiv = document.createElement('div');
  iconDiv.className = 'device-icon';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z');
  svg.appendChild(path);
  iconDiv.appendChild(svg);
  
  const infoDiv = document.createElement('div');
  infoDiv.className = 'device-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'device-name';
  nameEl.textContent = device.name || 'Chromecast';
  const ipEl = document.createElement('div');
  ipEl.className = 'device-ip';
  ipEl.textContent = device.address || '';
  infoDiv.appendChild(nameEl);
  infoDiv.appendChild(ipEl);
  
  const checkDiv = document.createElement('div');
  checkDiv.className = 'device-check';
  const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkSvg.setAttribute('viewBox', '0 0 24 24');
  const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  checkPath.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
  checkSvg.appendChild(checkPath);
  checkDiv.appendChild(checkSvg);
  
  card.appendChild(iconDiv);
  card.appendChild(infoDiv);
  card.appendChild(checkDiv);
  
  card.onclick = () => selectDevice(device);
  devicesListEl.appendChild(card);
}

async function scanForChromecasts() {
  setStatus('Searching for devices...', 'searching');
  showLoading(true);
  showEmpty(false);
  clearDevices();
  
  try {
    const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
    showLoading(false);
    
    if (!devices || devices.length === 0) {
      setStatus('No devices found', 'error');
      showEmpty(true);
      return;
    }
    
    setStatus(`Found ${devices.length} device${devices.length > 1 ? 's' : ''}`, 'success');
    
    devices.forEach(device => addDevice(device));
    
    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
  } catch (error) {
    showLoading(false);
    setStatus('Scan failed', 'error');
    showEmpty(true);
  }
}

function selectDevice(device) {
  selectedDevice = device;
  setStatus(`Selected: ${device.name || device.address}`, 'success');
  
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  const card = document.querySelector(`.device-card[data-address="${device.address}"]`);
  if (card) card.classList.add('selected');
}

async function castToChromecast(videoUrl) {
  if (!selectedDevice) {
    setStatus('Select a device first', 'error');
    return;
  }
  
  setStatus('Casting...', 'searching');
  
  try {
    await browser.runtime.sendMessage({
      type: 'castVideo',
      videoUrl: videoUrl,
      device: selectedDevice
    });
    setStatus('Casting started!', 'success');
  } catch (error) {
    setStatus('Cast failed: ' + error.message, 'error');
  }
}

function setMode(mode) {
  currentMode = mode;
  localStorage.setItem('castMode', mode);
  
  document.getElementById('modeStandalone').classList.toggle('active', mode === 'standalone');
  document.getElementById('modeAndroid').classList.toggle('active', mode === 'android');
  document.getElementById('standaloneSection').style.display = mode === 'standalone' ? 'block' : 'none';
  document.getElementById('androidSection').classList.toggle('active', mode === 'android');
  
  if (mode === 'standalone') {
    setStatus('Ready to scan');
    scanForChromecasts();
  } else {
    setStatus('Enter server URL');
  }
}

document.getElementById('modeStandalone').onclick = () => setMode('standalone');
document.getElementById('modeAndroid').onclick = () => setMode('android');
document.getElementById('scanBtn').onclick = scanForChromecasts;

document.getElementById('connectBtn').onclick = () => {
  const input = document.getElementById('serverUrl');
  serverUrl = input?.value || '';
  localStorage.setItem('serverUrl', serverUrl);
  setStatus('Connected to: ' + serverUrl, 'success');
};

const serverUrlInput = document.getElementById('serverUrl');
if (serverUrlInput) serverUrlInput.value = serverUrl;

setMode(currentMode);
