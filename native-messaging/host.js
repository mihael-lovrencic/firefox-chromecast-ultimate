const { spawn } = require('child_process');

const HELPER_URL = 'http://127.0.0.1:4269';
const HELPER_SCRIPT = require('path').join(__dirname, '..', 'helper', 'index.js');

function encodeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length, 0);
  return Buffer.concat([length, json]);
}

function sendMessage(message) {
  process.stdout.write(encodeMessage(message));
}

function readMessages(onMessage) {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const msgLength = buffer.readUInt32LE(0);
      if (buffer.length < msgLength + 4) break;
      const body = buffer.slice(4, 4 + msgLength).toString('utf8');
      buffer = buffer.slice(4 + msgLength);
      try {
        onMessage(JSON.parse(body));
      } catch (e) {
        sendMessage({ ok: false, error: 'Invalid JSON' });
      }
    }
  });
}

async function fetchJson(path) {
  const res = await fetch(`${HELPER_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function isHelperRunning() {
  try {
    const res = await fetch(`${HELPER_URL}/status`);
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function startHelper() {
  spawn(process.execPath, [HELPER_SCRIPT], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

async function ensureHelper() {
  if (await isHelperRunning()) return true;
  await startHelper();
  for (let i = 0; i < 10; i++) {
    if (await isHelperRunning()) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

readMessages(async (message) => {
  try {
    if (message.type === 'ping') {
      sendMessage({ ok: true });
      return;
    }
    if (message.type === 'ensureHelper') {
      const ok = await ensureHelper();
      sendMessage({ ok });
      return;
    }
    if (message.type === 'status') {
      const running = await isHelperRunning();
      sendMessage({ ok: true, running });
      return;
    }
    sendMessage({ ok: false, error: 'Unknown message' });
  } catch (e) {
    sendMessage({ ok: false, error: e.message });
  }
});
