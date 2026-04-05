(function() {
  'use strict';
  
  console.log('[Chromecast] Content script loaded on:', window.location.href);
  
  const castButtons = new Map();
  let updateTimer = null;
  
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
      browser.runtime.sendMessage({ type: 'discoverDevices' }).then(devices => {
        if (!devices || devices.length === 0) {
          btn.textContent = 'NO';
          btn.style.background = '#f00';
          setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = ''; }, 2000);
        } else {
          btn.textContent = 'OK';
          btn.style.background = '#0f0';
          console.log('[Chromecast] Found devices:', devices);
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
  
})();
