const { spawn } = require('child_process');

const HELPER_URL = 'http://127.0.0.1:4269';
const SAMPLE_URL = process.env.CAST_TEST_URL || 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const DEVICE_IP = process.env.DEVICE_IP || '';
const DEVICE_NAME = process.env.DEVICE_NAME || '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHelper(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${HELPER_URL}/status`);
      if (res.ok) return true;
    } catch (_) {}
    await sleep(300);
  }
  return false;
}

async function fetchJson(path, options) {
  const res = await fetch(`${HELPER_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  return res.json();
}

function pickDevice(devices) {
  if (DEVICE_IP) {
    return devices.find(d => d.address === DEVICE_IP) || null;
  }
  if (DEVICE_NAME) {
    return devices.find(d => (d.name || '').includes(DEVICE_NAME)) || null;
  }
  return devices[0] || null;
}

async function run() {
  const child = spawn(process.execPath, ['index.js'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(data));
  child.stderr.on('data', data => process.stderr.write(data));

  let exitCode = 1;
  try {
    const ready = await waitForHelper();
    if (!ready) throw new Error('Helper did not start');

    const devices = await fetchJson('/devices');
    if (!devices.length) throw new Error('No Chromecast devices found');

    const device = pickDevice(devices);
    if (!device) throw new Error('Selected device not found');

    await fetchJson('/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: SAMPLE_URL, device })
    });

    await sleep(3000);

    await fetchJson('/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device })
    });

    console.log('Smoke test OK');
    exitCode = 0;
  } catch (err) {
    console.error('Smoke test FAILED:', err.message);
  } finally {
    child.kill();
    process.exit(exitCode);
  }
}

run();
