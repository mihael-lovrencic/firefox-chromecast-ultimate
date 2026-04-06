(function() {
  'use strict';
  
  console.log('[Chromecast] Content script loaded on:', window.location.href);
  
  const castButtons = new Map();
  let updateTimer = null;
  const capturedUrls = [];

  function createCastGlyph() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    [
      'M4 18a2 2 0 0 1 2 2',
      'M4 14a6 6 0 0 1 6 6',
      'M4 10a10 10 0 0 1 10 10',
      'M4 6h16v9'
    ].forEach(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function setButtonVisual(btn, state, label) {
    btn.classList.remove('casting', 'success', 'warning', 'error');
    btn.dataset.stateLabel = label || '';
    if (state && state !== 'idle') {
      btn.classList.add(state);
    }
  }

  function resetButton(btn, label = 'Cast') {
    btn.replaceChildren(createCastGlyph());
    setButtonVisual(btn, 'idle', label);
  }

  function installUrlSniffer() {
    if (window.__chromecastSnifferInstalled) return;
    window.__chromecastSnifferInstalled = true;
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        if (window.__chromecastSnifferActive) return;
        window.__chromecastSnifferActive = true;
        const urls = new Set();
        function report(url) {
          if (!url || typeof url !== 'string') return;
          if (!url.includes('.m3u8') && !url.includes('.mp4')) return;
          if (urls.has(url)) return;
          urls.add(url);
          window.postMessage({ type: 'chromecast-url', url }, '*');
        }
        const origFetch = window.fetch;
        window.fetch = function(...args) {
          try { report(args[0]?.toString?.() || args[0]); } catch (_) {}
          return origFetch.apply(this, args);
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          try { report(url); } catch (_) {}
          return origOpen.call(this, method, url, ...rest);
        };
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
          const ws = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
          ws.addEventListener('message', (event) => {
            try {
              if (typeof event.data === 'string') {
                report(event.data);
                if (event.data.includes('.m3u8') || event.data.includes('.mp4')) return;
                const parsed = JSON.parse(event.data);
                const values = JSON.stringify(parsed);
                report(values);
              }
            } catch (_) {}
          });
          return ws;
        };
        window.WebSocket.prototype = NativeWebSocket.prototype;
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }
  
  function createCastButton(video) {
    if (castButtons.has(video)) return;
    console.log('[Chromecast] Creating button for video:', video.src || video.currentSrc);
    
    const btn = document.createElement('button');
    btn.className = 'chromecast-btn';
    btn.title = 'Cast to Chromecast';
    btn.style.position = 'fixed';
    btn.style.pointerEvents = 'auto';
    btn.style.bottom = 'auto';
    btn.style.right = 'auto';
    resetButton(btn, 'Cast');
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[Chromecast] Cast button clicked!');
      setButtonVisual(btn, 'idle', 'Scanning');
      let videoUrl = video.currentSrc || video.src;
      if (videoUrl && videoUrl.startsWith('blob:')) {
        const candidate = findCandidateUrl();
        if (candidate) videoUrl = candidate;
      }
      if (videoUrl && /youtube\.com|youtu\.be/i.test(window.location.href)) {
        videoUrl = window.location.href;
      }
      if (!/youtube\.com|youtu\.be/i.test(videoUrl) && !videoUrl.includes('.m3u8') && !videoUrl.includes('.mp4')) {
        setButtonVisual(btn, 'warning', 'Play video first');
        setTimeout(() => resetButton(btn, 'Cast'), 2000);
        return;
      }
      if (!videoUrl) {
        setButtonVisual(btn, 'error', 'No media URL');
        setTimeout(() => resetButton(btn, 'Cast'), 2000);
        return;
      }
      const subtitles = collectSubtitles(video);
      browser.runtime.sendMessage({ type: 'getLastMediaRequest' }).then(lastReq => {
        const headers = lastReq && lastReq.data && lastReq.data.url === videoUrl
          ? (lastReq.data.headers || [])
          : [];
        const useProxy = shouldProxy(videoUrl, headers);
        return browser.runtime.sendMessage({ type: 'discoverDevices' }).then(devices => ({ devices, headers, useProxy }));
      }).then(({ devices, headers, useProxy }) => {
        if (!Array.isArray(devices)) {
          const message = devices && devices.error ? devices.error : 'Device scan failed';
          setButtonVisual(btn, 'error', message);
          setTimeout(() => resetButton(btn, 'Cast'), 2500);
        } else if (devices.length === 0) {
          setButtonVisual(btn, 'error', 'No devices');
          setTimeout(() => resetButton(btn, 'Cast'), 2000);
        } else {
          let device = devices[0];
          if (devices.length > 1) {
            const list = devices.map((d, i) => `${i + 1}. ${d.name || d.address}`).join('\n');
            const choice = prompt(`Select Chromecast:\n${list}`, '1');
            const index = parseInt(choice || '1', 10) - 1;
            if (Number.isNaN(index) || index < 0 || index >= devices.length) {
              setButtonVisual(btn, 'warning', 'Cancelled');
              setTimeout(() => resetButton(btn, 'Cast'), 1800);
              return;
            }
            device = devices[index];
          }
          setButtonVisual(btn, 'casting', `Casting to ${device.name || device.address}`);
          browser.runtime.sendMessage({
            type: 'castVideo',
            videoUrl,
            device,
            useProxy,
            referer: window.location.href,
            headers,
            subtitles
          }).then(res => {
            if (res && res.error) throw new Error(res.error);
            setButtonVisual(btn, 'success', `Connected to ${device.name || device.address}`);
            setTimeout(() => resetButton(btn, 'Cast'), 3000);
          }).catch(err => {
            console.error('[Chromecast] Cast error:', err);
            setButtonVisual(btn, 'error', err.message || 'Cast failed');
            setTimeout(() => resetButton(btn, 'Cast'), 3000);
          });
        }
      }).catch(e => {
        console.error('[Chromecast] Error:', e);
        setButtonVisual(btn, 'error', e.message || 'Cast failed');
        setTimeout(() => resetButton(btn, 'Cast'), 3000);
      });
    });
    
    document.body.appendChild(btn);
    castButtons.set(video, btn);
    console.log('[Chromecast] Button created successfully!');
  }
  
  function isVisible(rect) {
    return rect.width >= 100 && rect.height >= 50 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }
  
  function updateButtons() {
    castButtons.forEach((btn, video) => {
      if (!video.isConnected) {
        btn.remove();
        castButtons.delete(video);
        return;
      }
      const rect = video.getBoundingClientRect();
      if (!isVisible(rect)) {
        btn.style.display = 'none';
        return;
      }
      btn.style.display = 'flex';
      btn.style.left = `${Math.max(0, rect.right - 50 - 10)}px`;
      btn.style.top = `${Math.max(0, rect.bottom - 50 - 10)}px`;
    });
  }
  
  function findVideos() {
    const videos = document.querySelectorAll('video');
    if (videos.length) console.log('[Chromecast] Found', videos.length, 'videos');
    videos.forEach(v => createCastButton(v));
    updateButtons();
  }
  
  console.log('[Chromecast] Starting video search...');
  findVideos();
  
  setInterval(findVideos, 2000);
  
  const observer = new MutationObserver(findVideos);
  observer.observe(document.body, { childList: true, subtree: true });
  
  window.addEventListener('scroll', updateButtons, { passive: true });
  window.addEventListener('resize', updateButtons);
  if (!updateTimer) {
    updateTimer = setInterval(updateButtons, 500);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'chromecast-url' && event.data.url) {
      const extracted = extractMediaUrl(event.data.url) || event.data.url;
      capturedUrls.push(extracted);
      try {
        browser.runtime.sendMessage({ type: 'mediaUrl', url: extracted });
      } catch (_) {}
    }
  });
  installUrlSniffer();
  
  function shouldProxy(url, headers) {
    if (!url) return false;
    if (/youtube\.com|youtu\.be/i.test(url)) return false;
    if (url.includes('.m3u8')) return true;
    if (url.includes('.mp4')) {
      return (headers || []).some(h => {
        const name = (h.name || '').toLowerCase();
        return name === 'cookie' || name === 'authorization';
      });
    }
    return true;
  }
  
  function findCandidateUrl() {
    try {
      const sources = [];
      document.querySelectorAll('video source').forEach(s => {
        if (s.src) sources.push(s.src);
      });
      const perf = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(n => n.includes('.m3u8') || n.includes('.mp4'));
      return sources.pop() || capturedUrls[capturedUrls.length - 1] || perf.pop() || null;
    } catch (_) {
      return null;
    }
  }

  function extractMediaUrl(raw) {
    try {
      if (!raw || typeof raw !== 'string') return null;
      const direct = raw.match(/https?:\/\/[^"'\\s]+?\.(m3u8|mp4)([^"'\\s]*)/i);
      if (direct && direct[0]) return direct[0];
      if (raw.includes('.m3u8') || raw.includes('.mp4')) {
        const url = tryExtractFromQuery(raw);
        return url || raw;
      }
      return tryExtractFromQuery(raw);
    } catch (_) {
      return null;
    }
  }

  function tryExtractFromQuery(raw) {
    try {
      const u = new URL(raw);
      for (const [key, value] of u.searchParams.entries()) {
        const candidate = decodeURIComponent(value);
        if (candidate.includes('.m3u8') || candidate.includes('.mp4')) return candidate;
        if (looksBase64(candidate)) {
          const decoded = atob(candidate.replace(/[-_]/g, '+').replace(/ /g, '+'));
          if (decoded.includes('.m3u8') || decoded.includes('.mp4')) return decoded;
        }
        if (looksBase64(value)) {
          const decoded = atob(value.replace(/[-_]/g, '+').replace(/ /g, '+'));
          if (decoded.includes('.m3u8') || decoded.includes('.mp4')) return decoded;
        }
      }
    } catch (_) {}
    return null;
  }

  function looksBase64(val) {
    return typeof val === 'string' && val.length >= 8 && /^[A-Za-z0-9+/=_-]+$/.test(val);
  }

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
  
})();
