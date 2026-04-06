let currentMode = localStorage.getItem('castMode') || 'standalone';
let selectedDevice = null;
let serverUrl = localStorage.getItem('serverUrl') || '';
const POPUP_HELPER_URLS = ['http://localhost:4269', 'http://127.0.0.1:4269'];

const statusEl = document.getElementById('status');
const discoveredDevicesContainer = document.getElementById('discoveredDevices');
const loadingIndicator = document.getElementById('loadingIndicator');
const videosList = document.getElementById('videosList');
const serverUrlInput = document.getElementById('serverUrl');
const debugTabUrlEl = document.getElementById('debugTabUrl');
const debugMediaUrlEl = document.getElementById('debugMediaUrl');
const debugProxyEl = document.getElementById('debugProxy');
const debugHeadersEl = document.getElementById('debugHeaders');
const subtitleSelectEl = document.getElementById('subtitleSelect');
const subtitleHintEl = document.getElementById('subtitleHint');
let currentVideoContexts = [];
let currentVideoIndex = 0;

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

async function fetchHelperJson(path) {
  let lastError = null;
  for (const base of POPUP_HELPER_URLS) {
    try {
      const response = await fetch(`${base}${path}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Helper not reachable');
}

async function ensureHelperReady() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'ensureHelper' });
    if (res && res.error) {
      throw new Error(res.error);
    }
  } catch (error) {
    try {
      await fetchHelperJson('/status');
      return;
    } catch (_) {
      throw new Error(error.message || 'Helper not reachable');
    }
  }
}

async function discoverDevicesWithFallback() {
  try {
    const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
    if (Array.isArray(devices)) {
      return devices;
    }
    if (devices && devices.error) {
      throw new Error(devices.error);
    }
  } catch (_) {
  }
  return fetchHelperJson('/devices');
}

async function scanForChromecasts() {
  showLoading(true);
  setStatus('Scanning for Chromecasts...');
  discoveredDevicesContainer.innerHTML = '';

  try {
    if (currentMode === 'standalone') {
      await ensureHelperReady();
    }

    const devices = await discoverDevicesWithFallback();
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

function getActiveVideoContext() {
  if (!Array.isArray(currentVideoContexts) || currentVideoContexts.length === 0) {
    return null;
  }
  return currentVideoContexts[currentVideoIndex] || currentVideoContexts[0] || null;
}

function applySubtitleChoice(subtitles = []) {
  const tracks = Array.isArray(subtitles) ? subtitles : [];
  const choice = subtitleSelectEl ? subtitleSelectEl.value : 'auto';
  if (tracks.length === 0) {
    return [];
  }
  if (choice === 'off') {
    return [];
  }
  if (choice.startsWith('track:')) {
    const selectedIndex = Number.parseInt(choice.slice(6), 10);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0) {
      const selectedTrack = tracks[selectedIndex];
      return selectedTrack ? [{ ...selectedTrack, selected: true }] : [];
    }
  }
  return tracks
    .filter(track => track.selected)
    .map(track => ({ ...track, selected: true }));
}

function renderSubtitlePicker(subtitles = []) {
  if (!subtitleSelectEl || !subtitleHintEl) return;
  const previousValue = subtitleSelectEl.value || 'auto';
  subtitleSelectEl.innerHTML = '';

  const autoOption = document.createElement('option');
  autoOption.value = 'auto';
  autoOption.textContent = 'Auto';
  subtitleSelectEl.appendChild(autoOption);

  const offOption = document.createElement('option');
  offOption.value = 'off';
  offOption.textContent = 'Off';
  subtitleSelectEl.appendChild(offOption);

  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    subtitleSelectEl.disabled = true;
    subtitleHintEl.textContent = 'No subtitles detected for the current video.';
    subtitleSelectEl.value = 'auto';
    return;
  }

  subtitles.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = `track:${index}`;
    const label = track.label || track.language || `Subtitle ${index + 1}`;
    const language = track.language ? ` (${track.language})` : '';
    option.textContent = `${label}${language}`;
    subtitleSelectEl.appendChild(option);
  });

  subtitleSelectEl.disabled = false;
  subtitleHintEl.textContent = `${subtitles.length} subtitle track${subtitles.length === 1 ? '' : 's'} available for the current video.`;

  const validValues = new Set(Array.from(subtitleSelectEl.options).map(option => option.value));
  if (validValues.has(previousValue)) {
    subtitleSelectEl.value = previousValue;
  } else {
    subtitleSelectEl.value = 'auto';
  }
}

function setActiveVideoIndex(index) {
  if (!Array.isArray(currentVideoContexts) || currentVideoContexts.length === 0) {
    currentVideoIndex = 0;
    renderSubtitlePicker([]);
    return;
  }
  currentVideoIndex = Math.max(0, Math.min(index, currentVideoContexts.length - 1));
  renderSubtitlePicker(currentVideoContexts[currentVideoIndex]?.subtitles || []);
}

function getVideoContextsScript() {
  return () => {
    function inferSubtitleFormat(url) {
      const lower = String(url || '').toLowerCase();
      if (lower.endsWith('.srt')) return 'srt';
      if (lower.endsWith('.ttml') || lower.endsWith('.dfxp')) return 'ttml';
      return 'vtt';
    }

    function formatCueTime(seconds) {
      const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
      const hours = Math.floor(totalMs / 3600000);
      const minutes = Math.floor((totalMs % 3600000) / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      const ms = totalMs % 1000;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    function serializeTrackToVtt(textTrack) {
      try {
        const cues = Array.from(textTrack?.cues || []);
        if (cues.length === 0) return '';
        let vtt = 'WEBVTT\n\n';
        cues.forEach((cue, index) => {
          const text = String(cue.text || '').trim();
          if (!text) return;
          vtt += `${cue.id || index + 1}\n`;
          vtt += `${formatCueTime(cue.startTime)} --> ${formatCueTime(cue.endTime)}\n`;
          vtt += `${text}\n\n`;
        });
        return vtt;
      } catch (_) {
        return '';
      }
    }

    function collectSubtitles(video) {
      const subtitles = [];
      const seen = new Set();

      Array.from(video.querySelectorAll('track')).forEach((trackEl, index) => {
        const kind = (trackEl.kind || '').toLowerCase();
        if (kind !== 'subtitles' && kind !== 'captions') return;
        const src = trackEl.src || trackEl.getAttribute('src') || '';
        const absoluteUrl = src ? new URL(src, document.baseURI).toString() : '';
        const textTrack = trackEl.track;
        const inlineVtt = !absoluteUrl ? serializeTrackToVtt(textTrack) : '';
        if (!absoluteUrl && !inlineVtt) return;
        const key = absoluteUrl || `${trackEl.label || textTrack?.label || ''}:${trackEl.srclang || textTrack?.language || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        subtitles.push({
          url: absoluteUrl,
          inlineVtt,
          label: trackEl.label || textTrack?.label || `Subtitle ${index + 1}`,
          language: trackEl.srclang || textTrack?.language || '',
          kind,
          selected: !!trackEl.default || textTrack?.mode === 'showing',
          format: absoluteUrl ? inferSubtitleFormat(absoluteUrl) : 'vtt'
        });
      });

      Array.from(video.textTracks || []).forEach((textTrack, index) => {
        const label = textTrack?.label || `Subtitle ${index + 1}`;
        const language = textTrack?.language || '';
        const key = `${label}:${language}`;
        if (seen.has(key)) return;
        const inlineVtt = serializeTrackToVtt(textTrack);
        if (!inlineVtt) return;
        seen.add(key);
        subtitles.push({
          url: '',
          inlineVtt,
          label,
          language,
          kind: textTrack?.kind || 'subtitles',
          selected: textTrack?.mode === 'showing',
          format: 'vtt'
        });
      });

      return subtitles;
    }

    return Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.currentSrc || v.src,
      width: v.offsetWidth,
      height: v.offsetHeight,
      subtitles: collectSubtitles(v),
      pageUrl: location.href,
      pageTitle: document.title
    })).filter(v => v.src || (Array.isArray(v.subtitles) && v.subtitles.length > 0));
  };
}

function formatHeaderSummary(headers = []) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return 'No captured request headers yet';
  }
  return headers
    .slice(0, 8)
    .map(h => `${h.name}: ${h.value}`)
    .join('\n');
}

function updateDebugPanel({ tabUrl = '-', mediaUrl = '-', headers = [], proxy = '-' }) {
  if (debugTabUrlEl) debugTabUrlEl.textContent = tabUrl || '-';
  if (debugMediaUrlEl) debugMediaUrlEl.textContent = mediaUrl || '-';
  if (debugProxyEl) debugProxyEl.textContent = proxy;
  if (debugHeadersEl) debugHeadersEl.textContent = formatHeaderSummary(headers);
}

async function refreshDebugPanel() {
  try {
    const tab = await getActiveTab();
    const tabId = tab?.id;
    const tabUrl = tab?.url || '-';
    if (!Number.isInteger(tabId)) {
      updateDebugPanel({ tabUrl, mediaUrl: '-', headers: [], proxy: 'No active tab' });
      return;
    }
    const debug = await browser.runtime.sendMessage({ type: 'getCaptureDebug', tabId });
    const headers = Array.isArray(debug?.data?.headers) ? debug.data.headers : [];
    const mediaUrl = debug?.data?.url || debug?.mediaUrl || '-';
    const proxy = mediaUrl && mediaUrl !== '-'
      ? (shouldProxy(mediaUrl, headers) ? 'Proxy' : 'Direct')
      : 'No media captured';
    updateDebugPanel({ tabUrl, mediaUrl, headers, proxy });
  } catch (error) {
    updateDebugPanel({
      tabUrl: '-',
      mediaUrl: '-',
      headers: [],
      proxy: `Debug failed: ${error.message}`
    });
  }
}

async function loadVideoContexts() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    currentVideoContexts = [];
    setActiveVideoIndex(0);
    return [];
  }
  const results = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: getVideoContextsScript()
  });
  currentVideoContexts = (results || []).flatMap(result => {
    const items = Array.isArray(result?.result) ? result.result : [];
    return items.map(item => ({
      ...item,
      frameId: result.frameId,
      tabUrl: tab.url || ''
    }));
  });
  if (currentVideoIndex >= currentVideoContexts.length) {
    currentVideoIndex = 0;
  }
  setActiveVideoIndex(currentVideoIndex);
  return currentVideoContexts;
}

async function resolveVideoUrl(initialUrl, tabUrl) {
  let finalUrl = initialUrl;
  let headers = [];
  const tab = await getActiveTab();
  const tabId = tab?.id;

  if (!/youtube\.com|youtu\.be/i.test(finalUrl) && !isDirectMediaUrl(finalUrl)) {
    const lastReq = await browser.runtime.sendMessage({ type: 'getLastMediaRequest', tabId });
    if (lastReq && lastReq.data && isDirectMediaUrl(lastReq.data.url)) {
      finalUrl = lastReq.data.url;
      headers = Array.isArray(lastReq.data.headers) ? lastReq.data.headers : [];
      setStatus('Using captured stream URL');
    } else {
      const lastUrl = await browser.runtime.sendMessage({ type: 'getLastMediaUrl', tabId });
      if (lastUrl && isDirectMediaUrl(lastUrl.url)) {
        finalUrl = lastUrl.url;
        setStatus('Using captured stream URL');
      }
    }
  } else if (isDirectMediaUrl(finalUrl)) {
    const lastReq = await browser.runtime.sendMessage({ type: 'getLastMediaRequest', tabId });
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

async function castVideo(videoUrl, subtitles = [], videoContext = null) {
  if (!selectedDevice && currentMode === 'standalone') {
    setStatus('Please select a Chromecast first');
    return;
  }

  setStatus('Casting...');

  try {
    const tab = await getActiveTab();
    const tabUrl = tab?.url || '';
    const refererUrl = videoContext?.pageUrl || tabUrl;

    if (currentMode === 'standalone') {
      await ensureHelperReady();
      const { finalUrl, headers } = await resolveVideoUrl(videoUrl, refererUrl);
      const chosenSubtitles = applySubtitleChoice(subtitles);
      const response = await browser.runtime.sendMessage({
        type: 'castVideo',
        videoUrl: finalUrl,
        device: selectedDevice,
        useProxy: shouldProxy(finalUrl, headers),
        referer: refererUrl,
        headers,
        subtitles: chosenSubtitles
      });
      if (response && response.error) {
        throw new Error(response.error);
      }
      setStatus('Casting started!');
      await refreshDebugPanel();
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
    await refreshDebugPanel();
  } catch (error) {
    setStatus('Cast failed: ' + error.message);
  }
}

async function scanVideos() {
  try {
    const videos = await loadVideoContexts();
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
      const subtitleCount = Array.isArray(video.subtitles) ? video.subtitles.length : 0;
      const sourceHost = (() => {
        try {
          return new URL(video.pageUrl || video.tabUrl || '').hostname;
        } catch (_) {
          return '';
        }
      })();
      ipSpan.textContent = `${video.width}x${video.height}${subtitleCount ? ` • ${subtitleCount} subtitle${subtitleCount === 1 ? '' : 's'}` : ''}${sourceHost ? ` • ${sourceHost}` : ''}`;
      btn.appendChild(nameSpan);
      btn.appendChild(ipSpan);
      btn.onmouseenter = () => setActiveVideoIndex(index);
      btn.onfocus = () => setActiveVideoIndex(index);
      btn.onclick = () => {
        setActiveVideoIndex(index);
        castVideo(video.src, video.subtitles || [], video);
      };
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
    loadVideoContexts().catch(() => renderSubtitlePicker([]));
  } else {
    setStatus('Android mode - connect to server');
  }
  refreshDebugPanel();
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
  const videos = await loadVideoContexts();
  const activeVideo = getActiveVideoContext();
  if (activeVideo) {
    castVideo(activeVideo.src || tab.url, activeVideo.subtitles || [], activeVideo);
  } else if (tab.url) {
    castVideo(tab.url, []);
  }
};
document.getElementById('refreshDebugBtn').onclick = refreshDebugPanel;
if (subtitleSelectEl) {
  subtitleSelectEl.onchange = () => {
    const activeVideo = getActiveVideoContext();
    renderSubtitlePicker(activeVideo?.subtitles || []);
  };
}

document.getElementById('connectBtn').onclick = () => {
  serverUrl = serverUrlInput.value;
  localStorage.setItem('serverUrl', serverUrl);
  setStatus('Connected to: ' + serverUrl);
};

if (serverUrlInput) {
  serverUrlInput.value = serverUrl;
}

setMode(currentMode);
loadVideoContexts().catch(() => renderSubtitlePicker([]));
refreshDebugPanel();
