(function() {
  'use strict';
  
  let currentCastDevice = null;
  let castButtons = new Map();
  
  function createCastButton(video) {
    if (castButtons.has(video)) return;
    
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';
    
    const btn = document.createElement('button');
    btn.className = 'chromecast-btn';
    btn.title = 'Cast to Chromecast';
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z');
    svg.appendChild(path);
    btn.appendChild(svg);
    btn.style.cssText = 'pointer-events: auto;';
    
    const tooltip = document.createElement('div');
    tooltip.className = 'chromecast-tooltip';
    tooltip.textContent = 'Click to cast';
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCastClick(video, btn, tooltip);
    });
    
    container.appendChild(btn);
    container.appendChild(tooltip);
    
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(container);
    
    video.addEventListener('mouseenter', () => {
      btn.classList.add('visible');
    });
    
    video.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('casting')) {
        btn.classList.remove('visible');
      }
    });
    
    castButtons.set(video, { btn, tooltip, container });
  }
  
  async function handleCastClick(video, btn, tooltip) {
    const videoUrl = video.currentSrc || video.src;
    if (!videoUrl) {
      tooltip.textContent = 'No video URL found';
      return;
    }
    
    tooltip.textContent = 'Discovering devices...';
    tooltip.classList.add('visible');
    
    try {
      const devices = await browser.runtime.sendMessage({ type: 'discoverDevices' });
      
      if (!devices || devices.length === 0) {
        tooltip.textContent = 'No devices found';
        setTimeout(() => tooltip.classList.remove('visible'), 2000);
        return;
      }
      
      tooltip.textContent = `Found ${devices.length} device(s)`;
      
      const device = devices[0];
      btn.classList.add('casting');
      tooltip.textContent = `Casting to ${device.name}...`;
      
      await browser.runtime.sendMessage({
        type: 'castVideo',
        videoUrl: videoUrl,
        device: device
      });
      
      tooltip.textContent = `Casting to ${device.name}`;
      
    } catch (e) {
      console.error('Cast error:', e);
      tooltip.textContent = 'Cast failed';
      setTimeout(() => tooltip.classList.remove('visible'), 2000);
    }
  }
  
  function observeVideos() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'VIDEO') {
            if (node.offsetWidth > 200 && node.offsetHeight > 100) {
              createCastButton(node);
            }
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('video').forEach((video) => {
              if (video.offsetWidth > 200 && video.offsetHeight > 100) {
                createCastButton(video);
              }
            });
          }
        });
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    document.querySelectorAll('video').forEach((video) => {
      if (video.offsetWidth > 200 && video.offsetHeight > 100) {
        createCastButton(video);
      }
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeVideos);
  } else {
    observeVideos();
  }
  
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'castState') {
      castButtons.forEach(({ btn, tooltip }) => {
        if (event.data.casting) {
          btn.classList.add('casting');
          tooltip.textContent = event.data.deviceName ? `Casting to ${event.data.deviceName}` : 'Casting';
        } else {
          btn.classList.remove('casting');
          tooltip.textContent = 'Click to cast';
        }
      });
    }
  });
  
})();