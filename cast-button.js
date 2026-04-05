(function() {
  'use strict';
  
  console.log('[Chromecast] Content script loaded on:', window.location.href);
  
  const castButtons = new Map();
  let updateTimer = null;
  const capturedUrls = [];

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
    btn.textContent = 'CAST';
    btn.title = 'Cast to Chromecast';
    btn.style.position = 'fixed';
    btn.style.pointerEvents = 'auto';
    btn.style.bottom = 'auto';
    btn.style.right = 'auto';
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[Chromecast] Cast button clicked!');
      btn.textContent = '...';
      let videoUrl = video.currentSrc || video.src;
      if (videoUrl && videoUrl.startsWith('blob:')) {
        const candidate = findCandidateUrl();
        if (candidate) videoUrl = candidate;
      }
      if (videoUrl && /youtube\.com|youtu\.be/i.test(window.location.href)) {
        videoUrl = window.location.href;
      }
      if (!videoUrl) {
        btn.textContent = 'NO URL';
        btn.style.background = '#f00';
        setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 2000);
        return;
      }
      const useProxy = shouldProxy(videoUrl);
      browser.runtime.sendMessage({ type: 'discoverDevices' }).then(devices => {
        if (!devices || devices.length === 0) {
          btn.textContent = 'NO';
          btn.style.background = '#f00';
          setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 2000);
        } else {
          let device = devices[0];
          if (devices.length > 1) {
            const list = devices.map((d, i) => `${i + 1}. ${d.name || d.address}`).join('\n');
            const choice = prompt(`Select Chromecast:\n${list}`, '1');
            const index = parseInt(choice || '1', 10) - 1;
            if (Number.isNaN(index) || index < 0 || index >= devices.length) {
              btn.textContent = 'CANCEL';
              btn.style.background = '#f00';
              setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 2000);
              return;
            }
            device = devices[index];
          }
          browser.runtime.sendMessage({ type: 'castVideo', videoUrl, device, useProxy, referer: window.location.href }).then(res => {
            if (res && res.error) throw new Error(res.error);
            btn.textContent = 'CASTING';
            btn.style.background = '#34a853';
            setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 3000);
          }).catch(err => {
            console.error('[Chromecast] Cast error:', err);
            btn.textContent = 'ERR';
            btn.style.background = '#f00';
            setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 3000);
          });
        }
      }).catch(e => {
        console.error('[Chromecast] Error:', e);
        btn.textContent = 'ERR';
        btn.style.background = '#f00';
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
      capturedUrls.push(event.data.url);
    }
  });
  installUrlSniffer();
  
  function shouldProxy(url) {
    if (!url) return false;
    if (/youtube\.com|youtu\.be/i.test(url)) return false;
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
  
})();
