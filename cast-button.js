(function() {
  'use strict';
  
  let castButtons = new Map();
  
  function createCastButton(video) {
    if (castButtons.has(video)) return;
    if (video.offsetWidth < 100 || video.offsetHeight < 50) return;
    
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    
    const btn = document.createElement('button');
    btn.textContent = 'CAST';
    btn.style.cssText = 'pointer-events:auto;position:absolute;bottom:80px;right:20px;width:60px;height:40px;background:#4285f4;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:bold;z-index:10000;opacity:1;';
    btn.title = 'Cast to Chromecast';
    
    const tooltip = document.createElement('div');
    tooltip.textContent = 'Click to cast';
    tooltip.style.cssText = 'position:absolute;bottom:130px;right:10px;background:#333;color:white;padding:8px 12px;border-radius:4px;font-size:12px;z-index:10000;opacity:1;white-space:nowrap;';
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tooltip.textContent = 'Discovering...';
      browser.runtime.sendMessage({ type: 'discoverDevices' }).then(devices => {
        if (!devices || devices.length === 0) {
          tooltip.textContent = 'No devices found';
          setTimeout(() => tooltip.textContent = 'Click to cast', 2000);
        } else {
          tooltip.textContent = `Found ${devices.length} device(s)`;
          browser.runtime.sendMessage({
            type: 'castVideo',
            videoUrl: video.currentSrc || video.src,
            device: devices[0]
          });
        }
      });
    });
    
    container.appendChild(btn);
    container.appendChild(tooltip);
    
    if (!video.parentElement) return;
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(container);
    
    castButtons.set(video, { btn, tooltip, container });
  }
  
  function findVideos() {
    document.querySelectorAll('video').forEach(v => createCastButton(v));
  }
  
  findVideos();
  
  setInterval(findVideos, 3000);
  
  const observer = new MutationObserver(findVideos);
  observer.observe(document.body, { childList: true, subtree: true });
  
})();
