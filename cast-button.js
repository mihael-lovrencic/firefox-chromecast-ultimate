(function() {
  'use strict';
  
  console.log('[Chromecast] Content script loaded on:', window.location.href);
  
  let castButtons = new Map();
  
  function createCastButton(video) {
    if (castButtons.has(video)) return;
    if (video.offsetWidth < 100 || video.offsetHeight < 50) return;
    
    console.log('[Chromecast] Creating button for video:', video.src || video.currentSrc);
    
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999999;';
    
    const btn = document.createElement('button');
    btn.textContent = 'CAST';
    btn.id = 'chromecast-cast-btn';
    btn.style.cssText = 'pointer-events:auto;position:absolute;bottom:10px;right:10px;width:50px;height:50px;background:#4285f4;color:white;border:none;border-radius:50%;cursor:pointer;font-size:12px;font-weight:bold;z-index:100000000;opacity:1;box-shadow:0 2px 10px rgba(0,0,0,0.5);';
    btn.title = 'Cast to Chromecast';
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[Chromecast] Cast button clicked!');
      btn.textContent = '...';
      browser.runtime.sendMessage({ type: 'discoverDevices' }).then(devices => {
        if (!devices || devices.length === 0) {
          btn.textContent = 'NO';
          btn.style.background = '#f00';
          setTimeout(() => { btn.textContent = 'CAST'; btn.style.background = '#4285f4'; }, 2000);
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
    
    container.appendChild(btn);
    
    if (!video.parentElement) return;
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(container);
    
    castButtons.set(video, btn);
    console.log('[Chromecast] Button created successfully!');
  }
  
  function findVideos() {
    const videos = document.querySelectorAll('video');
    console.log('[Chromecast] Found', videos.length, 'videos');
    videos.forEach(v => createCastButton(v));
  }
  
  console.log('[Chromecast] Starting video search...');
  findVideos();
  
  setInterval(findVideos, 2000);
  
  const observer = new MutationObserver(findVideos);
  observer.observe(document.body, { childList: true, subtree: true });
  
})();
