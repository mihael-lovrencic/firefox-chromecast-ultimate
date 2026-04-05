(function() {
  'use strict';
  
  alert('CAST BUTTON TEST: Content script running!');
  console.log('CAST BUTTON TEST: Script loaded on:', window.location.href);
  document.body.style.border = '10px solid red';
  document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;top:0;left:0;background:red;color:white;padding:20px;font-size:24px;z-index:99999999;">CAST BUTTON TEST ACTIVE</div>');
  
  let castButtons = new Map();
  
  function createCastButton(video) {
    if (castButtons.has(video)) return;
    
    alert('Creating cast button!');
    console.log('Creating cast button for:', video.src);
    
    const btn = document.createElement('button');
    btn.textContent = 'CAST';
    btn.style.cssText = 'position:absolute;bottom:10px;right:10px;width:60px;height:40px;background:#4285f4;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;font-weight:bold;z-index:9999999;';
    btn.onclick = () => alert('Cast clicked!');
    
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(btn);
    
    castButtons.set(video, btn);
    console.log('Cast button created!');
  }
  
  function findVideos() {
    const videos = document.querySelectorAll('video');
    console.log('Found', videos.length, 'videos');
    videos.forEach(v => {
      if (v.offsetWidth > 100 && v.offsetHeight > 50) {
        createCastButton(v);
      }
    });
  }
  
  findVideos();
  
  setInterval(findVideos, 2000);
  
  const observer = new MutationObserver(findVideos);
  observer.observe(document.body, { childList: true, subtree: true });
  
})();
