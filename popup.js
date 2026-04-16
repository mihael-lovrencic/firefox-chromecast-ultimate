
let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
let helperUrl = localStorage.getItem('helperUrl') || '';
let androidUrl = localStorage.getItem('androidUrl') || '';
let androidConnected = localStorage.getItem('androidConnected') === 'true';
let isScanning = false;

const statusTextEl = document.getElementById('statusText');
const statusDotEl = document.getElementById('statusDot');
const devicesListEl = document.getElementById('devicesList');
const loadingStateEl = document.getElementById('loadingState');
const emptyStateEl = document.getElementById('emptyState');
const androidConnectionStatusEl = document.getElementById('androidConnectionStatus');
const androidErrorHintEl = document.getElementById('androidErrorHint');
const androidLoadingEl = document.getElementById('androidLoading');
const androidDevicesSectionEl = document.getElementById('androidDevicesSection');
const androidDevicesListEl = document.getElementById('androidDevicesList');
const androidRefreshBtnEl = document.getElementById('androidRefreshBtn');

function setStatus(message, type = 'default') {
  if (statusTextEl) statusTextEl.textContent = message;
  if (statusDotEl) {
    statusDotEl.className = 'status-dot';
    if (type === 'searching') statusDotEl.classList.add('searching');
    if (type === 'error') statusDotEl.classList.add('error');
    if (type === 'success') statusDotEl.style.background = '#34a853';
  }
}

function setAndroidConnectionState(state, message = '') {
  if (!androidConnectionStatusEl) return;
  
  androidConnectionStatusEl.className = 'connection-status ' + state;
  const span = androidConnectionStatusEl.querySelector('span');
  if (span) {
    span.textContent = message || (state === 'connected' ? 'Connected' : state === 'testing' ? 'Testing...' : 'Not connected');
  }
  
  if (state === 'connected') {
    localStorage.setItem('androidConnected', 'true');
    androidConnected = true;
  } else if (state === 'disconnected') {
    localStorage.setItem('androidConnected', 'false');
    androidConnected = false;
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

function clearAndroidDevices() {
  if (androidDevicesListEl) androidDevicesListEl.innerHTML = '';
}

function addDevice(device, targetListEl = devicesListEl) {
  if (!targetListEl) return;
  
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
  targetListEl.appendChild(card);
}

async function scanForChromecasts() {
  if (isScanning) return;
  isScanning = true;
  
  setStatus('Searching for devices...', 'searching');
  showLoading(true);
  showEmpty(false);
  clearDevices();
  
  try {
    const message = {
      type: 'discoverDevices',
      helperUrl: helperUrl,
      androidUrl: androidUrl,
      mode: currentMode
    };
    const devices = await browser.runtime.sendMessage(message);
    showLoading(false);
    
    if (!devices || devices.length === 0 || (devices.error && !devices[0])) {
      const errorMsg = devices?.error || 'No devices found';
      setStatus(errorMsg, 'error');
      showEmpty(true);
      showErrorHint(errorMsg);
      return;
    }
    
    if (devices.error) {
      setStatus(devices.error, 'error');
      showEmpty(true);
      showErrorHint(devices.error);
      return;
    }
    
    setStatus(`Found ${devices.length} device${devices.length > 1 ? 's' : ''}`, 'success');
    hideErrorHint();
    
    devices.forEach(device => addDevice(device));
    
    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
    
    updateCastingIndicator();
  } catch (error) {
    showLoading(false);
    const errorMsg = 'Connection failed. Make sure the helper is running.';
    setStatus(errorMsg, 'error');
    showEmpty(true);
    showErrorHint(errorMsg);
  } finally {
    isScanning = false;
  }
}

async function scanAndroidDevices() {
  if (isScanning) return;
  if (!androidConnected || !androidUrl) {
    setStatus('Connect to app first', 'error');
    return;
  }
  
  isScanning = true;
  setStatus('Scanning for devices...', 'searching');
  androidLoadingEl.style.display = 'block';
  clearAndroidDevices();
  
  if (androidRefreshBtnEl) {
    androidRefreshBtnEl.classList.add('spinning');
  }
  
  try {
    const devices = await browser.runtime.sendMessage({
      type: 'discoverDevices',
      androidUrl: androidUrl,
      mode: 'android'
    });
    
    androidLoadingEl.style.display = 'none';
    
    if (!devices || devices.length === 0 || (devices.error && !devices[0])) {
      const errorMsg = devices?.error || 'No devices found';
      setStatus(errorMsg, 'error');
      showErrorHint(errorMsg);
      return;
    }
    
    if (devices.error) {
      setStatus(devices.error, 'error');
      showErrorHint(devices.error);
      return;
    }
    
    setStatus(`Found ${devices.length} device${devices.length > 1 ? 's' : ''}`, 'success');
    hideErrorHint();
    androidDevicesSectionEl.style.display = 'block';
    
    devices.forEach(device => addDevice(device, androidDevicesListEl));
    
    if (devices.length === 1) {
      selectDevice(devices[0]);
    }
    
    updateCastingIndicator();
  } catch (error) {
    androidLoadingEl.style.display = 'none';
    const errorMsg = 'Connection failed: ' + error.message;
    setStatus(errorMsg, 'error');
    showErrorHint(errorMsg);
  } finally {
    isScanning = false;
    if (androidRefreshBtnEl) {
      androidRefreshBtnEl.classList.remove('spinning');
    }
  }
}

function showErrorHint(message) {
  if (!androidErrorHintEl) return;
  
  let hint = '';
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    hint = 'Check if the app is running and URL is correct';
  } else if (message.includes('404') || message.includes('Not Found')) {
    hint = 'Invalid URL. Make sure you copied the full address.';
  } else if (message.includes('CORS')) {
    hint = 'Server may not allow connections from browser';
  }
  
  if (hint) {
    androidErrorHintEl.textContent = hint;
    androidErrorHintEl.style.display = 'block';
  }
}

function hideErrorHint() {
  if (androidErrorHintEl) {
    androidErrorHintEl.style.display = 'none';
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

async function checkDeviceStatus() {
  if (!selectedDevice) return null;
  
  try {
    const status = await browser.runtime.sendMessage({
      type: 'getDeviceStatus',
      mode: currentMode,
      helperUrl: helperUrl,
      androidUrl: androidUrl
    });
    
    if (status && status.error) {
      return null;
    }
    
    return status;
  } catch (e) {
    return null;
  }
}

async function updateCastingIndicator() {
  const status = await checkDeviceStatus();
  
  document.querySelectorAll('.device-card').forEach(card => {
    card.classList.remove('device-casting');
  });
  
  if (status && status.casting && status.device) {
    const castingCard = document.querySelector(`.device-card[data-address="${status.device}"]`);
    if (castingCard) {
      castingCard.classList.add('device-casting');
    }
    
    const selectedCard = document.querySelector(`.device-card[data-address="${selectedDevice?.address}"]`);
    if (selectedCard && !selectedCard.classList.contains('device-casting')) {
      selectedCard.classList.add('device-casting');
    }
  }
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
      device: selectedDevice,
      helperUrl: helperUrl,
      androidUrl: androidUrl,
      mode: currentMode
    });
    setStatus('Casting started!', 'success');
    updateCastingIndicator();
  } catch (error) {
    setStatus('Cast failed: ' + error.message, 'error');
  }
}

async function stopCasting() {
  setStatus('Stopping...', 'searching');
  
  try {
    await browser.runtime.sendMessage({
      type: 'stopCast',
      mode: currentMode,
      helperUrl: helperUrl,
      androidUrl: androidUrl
    });
    setStatus('Stopped', 'success');
    updateCastingIndicator();
  } catch (error) {
    setStatus('Stop failed: ' + error.message, 'error');
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
    if (!isScanning) {
      scanForChromecasts();
    }
  } else {
    if (androidConnected) {
      setStatus('Connected to app');
      androidDevicesSectionEl.style.display = 'block';
    } else {
      setStatus('Enter app URL to connect');
    }
  }
}

document.getElementById('modeStandalone').onclick = () => setMode('standalone');
document.getElementById('modeAndroid').onclick = () => setMode('android');
document.getElementById('scanBtn').onclick = scanForChromecasts;

document.getElementById('connectAndroidBtn').onclick = async () => {
  const input = document.getElementById('androidUrl');
  androidUrl = input?.value?.trim() || '';
  localStorage.setItem('androidUrl', androidUrl);
  
  if (!androidUrl) {
    setStatus('Please enter app URL', 'error');
    setAndroidConnectionState('disconnected', 'Not connected');
    return;
  }
  
  setAndroidConnectionState('testing', 'Testing connection...');
  hideErrorHint();
  
  try {
    const result = await browser.runtime.sendMessage({ 
      type: 'testServer', 
      url: androidUrl,
      mode: 'android'
    });
    
    if (result && result.ok) {
      setAndroidConnectionState('connected', 'Connected');
      setStatus('Connected to Android app', 'success');
      hideErrorHint();
      
      androidDevicesSectionEl.style.display = 'block';
      setTimeout(() => scanAndroidDevices(), 300);
    } else {
      const errorMsg = result?.error || 'Connection failed';
      setAndroidConnectionState('disconnected', 'Connection failed');
      setStatus(errorMsg, 'error');
      showErrorHint(errorMsg);
    }
  } catch (error) {
    const errorMsg = 'Connection failed: ' + error.message;
    setAndroidConnectionState('disconnected', 'Connection failed');
    setStatus(errorMsg, 'error');
    showErrorHint(errorMsg);
  }
};

if (androidRefreshBtnEl) {
  androidRefreshBtnEl.onclick = scanAndroidDevices;
}

const androidUrlInput = document.getElementById('androidUrl');
if (androidUrlInput) androidUrlInput.value = androidUrl;

function initializeAndroidState() {
  if (androidConnected && androidUrl) {
    setAndroidConnectionState('connected', 'Connected');
  } else {
    setAndroidConnectionState('disconnected', 'Not connected');
  }
}

setMode(currentMode);
initializeAndroidState();
