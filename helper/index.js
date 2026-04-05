const http = require('http');
const mdns = require('multicast-dns')();
const { Client, DefaultMediaReceiver } = require('castv2-client');

const HOST = '127.0.0.1';
const PORT = 4269;
const DISCOVERY_TIMEOUT_MS = 3000;

function parseTxt(records) {
  const txt = {};
  for (const entry of records || []) {
    if (Buffer.isBuffer(entry)) {
      const str = entry.toString();
      const idx = str.indexOf('=');
      if (idx > 0) txt[str.slice(0, idx)] = str.slice(idx + 1);
    } else if (Array.isArray(entry)) {
      for (const buf of entry) {
        if (!Buffer.isBuffer(buf)) continue;
        const str = buf.toString();
        const idx = str.indexOf('=');
        if (idx > 0) txt[str.slice(0, idx)] = str.slice(idx + 1);
      }
    }
  }
  return txt;
}

function discoverDevices(timeoutMs = DISCOVERY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const devices = new Map();
    const srvMap = new Map();
    const hostMap = new Map();

    const onResponse = (response) => {
      for (const ans of response.answers || []) {
        if (ans.type === 'PTR' && ans.name === '_googlecast._tcp.local') {
          if (!devices.has(ans.data)) {
            devices.set(ans.data, { name: ans.data, address: null, port: 8009 });
          }
        }
        if (ans.type === 'SRV') {
          srvMap.set(ans.name, ans.data);
        }
        if (ans.type === 'TXT') {
          const txt = parseTxt(ans.data);
          const dev = devices.get(ans.name) || { name: ans.name, address: null, port: 8009 };
          dev.name = txt.fn || dev.name;
          devices.set(ans.name, dev);
        }
        if (ans.type === 'A') {
          hostMap.set(ans.name, ans.data);
        }
      }
    };

    mdns.on('response', onResponse);

    mdns.query({
      questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }]
    });

    setTimeout(() => {
      mdns.removeListener('response', onResponse);
      // Resolve SRV host -> IP
      for (const [instance, dev] of devices.entries()) {
        const srv = srvMap.get(instance);
        if (srv && srv.target && hostMap.has(srv.target)) {
          dev.address = hostMap.get(srv.target);
          dev.port = srv.port || 8009;
          devices.set(instance, dev);
        }
      }
      resolve(Array.from(devices.values()).filter(d => d.address));
    }, timeoutMs);
  });
}

function castToDevice({ url, address, port = 8009 }) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.connect(address, () => {
      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          client.close();
          return reject(err);
        }
        const media = {
          contentId: url,
          contentType: guessContentType(url),
          streamType: 'BUFFERED'
        };
        player.load(media, { autoplay: true }, (loadErr) => {
          client.close();
          if (loadErr) return reject(loadErr);
          resolve();
        });
      });
    });
    client.on('error', (err) => {
      client.close();
      reject(err);
    });
  });
}

function guessContentType(url) {
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (lower.endsWith('.mpd')) return 'application/dash+xml';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'video/mp4';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.url === '/status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.url === '/devices' && req.method === 'GET') {
    const devices = await discoverDevices();
    return sendJson(res, 200, devices);
  }

  if (req.url === '/cast' && req.method === 'POST') {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', async () => {
      try {
        const body = JSON.parse(data || '{}');
        if (!body.url) return sendJson(res, 400, { error: 'Missing url' });
        if (!body.address) {
          const devices = await discoverDevices();
          if (!devices.length) return sendJson(res, 404, { error: 'No devices found' });
          body.address = devices[0].address;
        }
        await castToDevice(body);
        return sendJson(res, 200, { success: true });
      } catch (e) {
        return sendJson(res, 500, { error: e.message || 'Cast failed' });
      }
    });
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Chromecast helper running on http://${HOST}:${PORT}`);
});
