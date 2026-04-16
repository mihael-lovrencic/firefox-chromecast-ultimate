const androidModeToggle = document.getElementById('androidModeToggle');
const androidSettings = document.getElementById('androidSettings');
const androidUrlInput = document.getElementById('androidUrlInput');
const helperUrlInput = document.getElementById('helperUrlInput');
const autoScanToggle = document.getElementById('autoScanToggle');
const showCastButtonToggle = document.getElementById('showCastButtonToggle');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const toast = document.getElementById('toast');

const defaults = {
  mode: 'standalone',
  androidUrl: '',
  helperUrl: '',
  autoScan: true,
  showCastButton: true
};

function loadSettings() {
  const settings = {
    mode: localStorage.getItem('castMode') || defaults.mode,
    androidUrl: localStorage.getItem('androidUrl') || defaults.androidUrl,
    helperUrl: localStorage.getItem('helperUrl') || defaults.helperUrl,
    autoScan: localStorage.getItem('autoScan') !== 'false',
    showCastButton: localStorage.getItem('showCastButton') !== 'false'
  };

  androidModeToggle.classList.toggle('active', settings.mode === 'android');
  androidSettings.style.display = settings.mode === 'android' ? 'block' : 'none';
  androidUrlInput.value = settings.androidUrl;
  helperUrlInput.value = settings.helperUrl;
  autoScanToggle.classList.toggle('active', settings.autoScan);
  showCastButtonToggle.classList.toggle('active', settings.showCastButton);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function saveSettings() {
  const androidMode = androidModeToggle.classList.contains('active');
  
  localStorage.setItem('castMode', androidMode ? 'android' : 'standalone');
  localStorage.setItem('androidUrl', androidUrlInput.value.trim());
  localStorage.setItem('helperUrl', helperUrlInput.value.trim());
  localStorage.setItem('autoScan', autoScanToggle.classList.contains('active').toString());
  localStorage.setItem('showCastButton', showCastButtonToggle.classList.contains('active').toString());
  
  showToast('Settings saved!');
}

function resetSettings() {
  localStorage.setItem('castMode', defaults.mode);
  localStorage.setItem('androidUrl', defaults.androidUrl);
  localStorage.setItem('helperUrl', defaults.helperUrl);
  localStorage.setItem('autoScan', defaults.autoScan.toString());
  localStorage.setItem('showCastButton', defaults.showCastButton.toString());
  
  loadSettings();
  showToast('Settings reset!');
}

androidModeToggle.addEventListener('click', () => {
  androidModeToggle.classList.toggle('active');
  androidSettings.style.display = androidModeToggle.classList.contains('active') ? 'block' : 'none';
});

autoScanToggle.addEventListener('click', () => {
  autoScanToggle.classList.toggle('active');
});

showCastButtonToggle.addEventListener('click', () => {
  showCastButtonToggle.classList.toggle('active');
});

saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);

loadSettings();
