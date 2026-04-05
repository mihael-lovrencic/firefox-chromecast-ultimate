const http = require('http');
const { Client, DefaultMediaReceiver, Application, RequestResponseController } = require('castv2-client');
const { Bonjour } = require('bonjour-service');

const HOST = '127.0.0.1';
const PORT = 4269;
const DISCOVERY_TIMEOUT_MS = 2000;
const sessions = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function normalizeDevice(service) {
  const address = (service.addresses || []).find(a => a.includes('.'));
  if (!address) return null;
  return {
    name: service.name || service.host,
    address,
    port: service.port || 8009,
    id: service.txt && service.txt.id ? service.txt.id : undefined
  };
}

function discoverDevices(timeoutMs = DISCOVERY_TIMEOUT_MS) {
  return new Promise(resolve => {
    const bonjour = new Bonjour();
    const devices = new Map();
    const browser = bonjour.find({ type: 'googlecast' }, service => {
      const device = normalizeDevice(service);
      if (device) devices.set(device.address, device);
    });
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(Array.from(devices.values()));
    }, timeoutMs);
  });
}

function detectContentType(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (lower.endsWith('.mpd')) return 'application/dash+xml';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'video/mp4';
}

function isYouTubeUrl(url) {
  return /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '');
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/');
      const embedIndex = parts.indexOf('embed');
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
      const shortsIndex = parts.indexOf('shorts');
      if (shortsIndex >= 0 && parts[shortsIndex + 1]) return parts[shortsIndex + 1];
    }
  } catch (_) {}
  return null;
}

class YouTubeApp extends Application {
  constructor(client, session) {
    super(client, session);
    this.reqres = this.createController(RequestResponseController, 'urn:x-cast:com.google.cast.media');
    this.yt = this.createController(RequestResponseController, 'urn:x-cast:com.google.youtube.mdx');
    this.currentSession = null;
    const onMessage = (response, broadcast) => {
      if (response.type === 'MEDIA_STATUS' && broadcast) {
        this.currentSession = response.status[0];
      }
    };
    this.reqres.on('message', onMessage);
    this.reqres.once('close', () => this.reqres.removeListener('message', onMessage));
  }

  getStatus(cb) {
    this.reqres.request({ type: 'GET_STATUS' }, (err, response) => {
      if (err) return cb(err);
      const status = response.status && response.status[0];
      this.currentSession = status || null;
      cb(null, status);
    });
  }

  sessionRequest(data, cb) {
    const done = cb || (() => {});
    const withSession = (status) => {
      if (!status || !status.mediaSessionId) return done(new Error('No media session'));
      this.reqres.request({ ...data, mediaSessionId: status.mediaSessionId }, (err, response) => {
        if (err) return done(err);
        done(null, response.status && response.status[0]);
      });
    };
    if (this.currentSession) return withSession(this.currentSession);
    this.getStatus((err, status) => {
      if (err) return done(err);
      withSession(status);
    });
  }

  load(videoId, cb) {
    const payload = {
      type: 'flingVideo',
      data: { currentTime: 0, videoId }
    };
    this.yt.request(payload);
    if (cb) cb();
  }

  play(cb) { this.sessionRequest({ type: 'PLAY' }, cb); }
  pause(cb) { this.sessionRequest({ type: 'PAUSE' }, cb); }
  stop(cb) { this.sessionRequest({ type: 'STOP' }, cb); }
}

YouTubeApp.APP_ID = '233637DE';

function castToDevice(device, url) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const cleanup = (err) => {
      client.close();
      if (err) reject(err);
    };
    client.on('error', cleanup);
    client.connect(device.address, () => {
      if (isYouTubeUrl(url)) {
        const videoId = extractYouTubeId(url);
        if (!videoId) return cleanup(new Error('Invalid YouTube URL'));
        client.launch(YouTubeApp, (err, app) => {
          if (err) return cleanup(err);
          app.load(videoId, () => {
            sessions.set(device.address, { client, app, type: 'youtube' });
            resolve();
          });
        });
      } else {
        client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) return cleanup(err);
          const media = {
            contentId: url,
            contentType: detectContentType(url),
            streamType: 'BUFFERED'
          };
          player.load(media, { autoplay: true }, loadErr => {
            if (loadErr) return cleanup(loadErr);
            sessions.set(device.address, { client, player, type: 'media' });
            resolve();
          });
        });
      }
    });
  });
}

function getSession(device) {
  if (!device || !device.address) return null;
  return sessions.get(device.address);
}

function stopSession(device) {
  const session = getSession(device);
  if (!session) return false;
  try {
    if (session.type === 'youtube' && session.app) {
      session.app.stop(() => {});
    } else if (session.player) {
      session.player.stop(() => {});
    }
  } catch (_) {}
  session.client.close();
  sessions.delete(device.address);
  return true;
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

  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, { status: 'ok', version: '1.0.0' });
  }

  if (req.method === 'GET' && req.url === '/devices') {
    const devices = await discoverDevices();
    return json(res, 200, devices);
  }

  if (req.method === 'POST' && req.url === '/cast') {
    try {
      const body = await readBody(req);
      const url = body.url;
      if (!url) return json(res, 400, { error: 'Missing url' });
      let device = body.device;
      if (!device) {
        const devices = await discoverDevices();
        device = devices[0];
      }
      if (!device) return json(res, 404, { error: 'No devices found' });
      await castToDevice(device, url);
      return json(res, 200, { success: true });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/control') {
    try {
      const body = await readBody(req);
      const action = body.action;
      const device = body.device;
      const session = getSession(device);
      if (!session) return json(res, 404, { error: 'No active session' });
      if (action === 'play') {
        if (session.type === 'youtube' && session.app) session.app.play(() => {});
        else if (session.player) session.player.play(() => {});
      } else if (action === 'pause') {
        if (session.type === 'youtube' && session.app) session.app.pause(() => {});
        else if (session.player) session.player.pause(() => {});
      } else if (action === 'stop') {
        stopSession(device);
      } else {
        return json(res, 400, { error: 'Unknown action' });
      }
      return json(res, 200, { success: true });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/stop') {
    try {
      const body = await readBody(req);
      const device = body.device;
      const stopped = stopSession(device);
      if (!stopped) return json(res, 404, { error: 'No active session' });
      return json(res, 200, { success: true });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Helper running at http://${HOST}:${PORT}`);
});
