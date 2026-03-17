let currentSession = null;
let playlist = [];
let serverUrl = localStorage.getItem('serverUrl') || 'http://localhost:5000';

const statusEl = document.getElementById('status');
const devicesSelect = document.getElementById('devices');
const videosContainer = document.getElementById('videos');
const playlistContainer = document.getElementById('playlist');
const serverInput = document.getElementById('serverUrl');

if (serverInput) serverInput.value = serverUrl;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function updateServerUrl(url) {
  serverUrl = url;
  localStorage.setItem('serverUrl', url);
  loadDevices();
}

async function loadDevices() {
  try {
    const res = await fetch(`${serverUrl}/devices`);
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
  const device = devicesSelect.value;
  if (!device) {
    setStatus('Please select a device first');
    return;
  }
  try {
    const res = await fetch(`${serverUrl}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, device })
    });
    const result = await res.json();
    setStatus('Casting started: ' + url.substring(0, 40) + '...');
  } catch (e) {
    setStatus('Error casting: ' + e.message);
  }
}

async function control(action) {
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

async function setSeek(value) {
  try {
    await fetch(`${serverUrl}/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (e) {
    console.error('Seek error:', e);
  }
}

async function setVolume(value) {
  try {
    await fetch(`${serverUrl}/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (e) {
    console.error('Volume error:', e);
  }
}

async function addSubtitle(file) {
  if (!file) return;
  try {
    const data = await file.text();
    await fetch(`${serverUrl}/subtitle`, {
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

document.getElementById('scanVideos').onclick = loadVideos;

document.getElementById('progress').oninput = (e) => setSeek(e.target.value);
document.getElementById('volume').oninput = (e) => setVolume(e.target.value);
document.getElementById('subtitle').onchange = (e) => addSubtitle(e.target.files[0]);

const serverUrlInput = document.getElementById('serverUrl');
if (serverUrlInput) {
  serverUrlInput.addEventListener('change', (e) => updateServerUrl(e.target.value));
}

loadDevices();
setTimeout(loadVideos, 500);