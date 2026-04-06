const http = require('http');
const os = require('os');
const { Readable } = require('stream');
const { Client, DefaultMediaReceiver, Application, RequestResponseController } = require('castv2-client');
const { Bonjour } = require('bonjour-service');

const HOST = '0.0.0.0';
const PORT = 4269;
const DISCOVERY_TIMEOUT_MS = 2000;
const sessions = new Map();
const proxyHeadersByToken = new Map();
const inlineSubtitlesById = new Map();
const LOCAL_IP = getLocalIp() || '127.0.0.1';

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
  try {
    const parsed = new URL(url);
    const embedded = parsed.searchParams.get('url');
    if (embedded && embedded !== url) {
      return detectContentType(embedded);
    }
  } catch (_) {}
  if (lower.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (lower.endsWith('.mpd')) return 'application/dash+xml';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'video/mp4';
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

function buildProxyUrl(url, token) {
  const params = new URLSearchParams({ url });
  if (token) params.set('token', token);
  return `http://${LOCAL_IP}:${PORT}/proxy?${params.toString()}`;
}

function buildSubtitleUrl(track, token) {
  if (track.inlineId) {
    const params = new URLSearchParams({ id: track.inlineId });
    return `http://${LOCAL_IP}:${PORT}/subtitle?${params.toString()}`;
  }
  const params = new URLSearchParams({ url: track.url });
  if (token) params.set('token', token);
  if (track.format) params.set('format', track.format);
  return `http://${LOCAL_IP}:${PORT}/subtitle?${params.toString()}`;
}

function isM3U8(url, contentType) {
  if (contentType && contentType.toLowerCase().includes('mpegurl')) return true;
  return url.toLowerCase().includes('.m3u8');
}

function detectSubtitleFormat(url = '', contentType = '') {
  const lowerUrl = url.toLowerCase();
  const lowerType = contentType.toLowerCase();
  if (lowerUrl.endsWith('.srt') || lowerType.includes('subrip') || lowerType.includes('x-subrip')) {
    return 'srt';
  }
  if (lowerUrl.endsWith('.ttml') || lowerUrl.endsWith('.dfxp') || lowerType.includes('ttml')) {
    return 'ttml';
  }
  return 'vtt';
}

function subtitleContentType(format) {
  if (format === 'ttml') return 'application/ttml+xml';
  return 'text/vtt';
}

function srtToVtt(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return normalized.startsWith('WEBVTT') ? normalized : `WEBVTT\n\n${normalized}`;
}

function registerInlineSubtitle(content, contentType = 'text/vtt') {
  const id = Math.random().toString(36).slice(2);
  inlineSubtitlesById.set(id, { content, contentType });
  setTimeout(() => inlineSubtitlesById.delete(id), 30 * 60 * 1000);
  return id;
}

function normalizeSubtitleTracks(tracks = [], token) {
  const normalized = [];
  for (const rawTrack of tracks) {
    if (!rawTrack || typeof rawTrack !== 'object') continue;
    const label = rawTrack.label || rawTrack.language || `Subtitle ${normalized.length + 1}`;
    const language = rawTrack.language || 'en';
    const kind = rawTrack.kind === 'captions' ? 'CAPTIONS' : 'SUBTITLES';
    const format = detectSubtitleFormat(rawTrack.url || '', rawTrack.contentType || rawTrack.format || '');
    let inlineId = '';
    if (rawTrack.inlineVtt) {
      inlineId = registerInlineSubtitle(rawTrack.inlineVtt, 'text/vtt');
    } else if (!rawTrack.url) {
      continue;
    }
    normalized.push({
      trackId: normalized.length + 1,
      type: 'TEXT',
      trackContentId: buildSubtitleUrl({ url: rawTrack.url, format, inlineId }, token),
      trackContentType: subtitleContentType(format),
      name: label,
      language,
      subtype: kind,
      selected: !!rawTrack.selected
    });
  }
  return normalized;
}

function sanitizeHeaderName(name) {
  return name.toLowerCase();
}

function mergeHeaderMaps(...maps) {
  const result = new Map();
  for (const map of maps) {
    if (!map) continue;
    for (const [k, v] of map.entries()) {
      result.set(k, v);
    }
  }
  return result;
}

function toHeaderMap(rawHeaders = []) {
  const map = new Map();
  for (const h of rawHeaders) {
    if (!h || !h.name || typeof h.value !== 'string') continue;
    const key = sanitizeHeaderName(h.name);
    map.set(key, h.value);
  }
  return map;
}

function filterHeaders(map) {
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'upgrade',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    'sec-websocket-protocol'
  ]);
  const out = {};
  for (const [k, v] of map.entries()) {
    if (blocked.has(k)) continue;
    out[k] = v;
  }
  return out;
}

async function proxyFetch(targetUrl, headerMap, range) {
  const headers = {};
  const normalized = filterHeaders(headerMap || new Map());
  for (const [k, v] of Object.entries(normalized)) {
    headers[k] = v;
  }
  if (range) headers.Range = range;
  if (!headers.Accept) headers.Accept = '*/*';
  if (!headers['User-Agent'] && !headers['user-agent']) {
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  }
  return fetch(targetUrl, { headers });
}

async function handleProxy(req, res) {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const target = reqUrl.searchParams.get('url');
    const token = reqUrl.searchParams.get('token') || '';
    if (!target) return json(res, 400, { error: 'Missing url' });
    const targetUrl = new URL(target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return json(res, 400, { error: 'Invalid protocol' });
    }

    let upstream;
    try {
      const headerMap = proxyHeadersByToken.get(token) || new Map();
      upstream = await proxyFetch(targetUrl.toString(), headerMap, req.headers.range);
    } catch (err) {
      return json(res, 502, { error: `Upstream fetch failed: ${err.message}` });
    }
    const contentType = upstream.headers.get('content-type') || '';
    console.log('[Proxy]', targetUrl.toString(), 'status=', upstream.status, 'type=', contentType);

    if (isM3U8(targetUrl.toString(), contentType)) {
      const text = await upstream.text();
      const baseUrl = targetUrl.toString();
      const rewritten = text
        .split('\n')
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const absolute = new URL(trimmed, baseUrl).toString();
          return buildProxyUrl(absolute, token);
        })
        .join('\n');
      res.writeHead(200, {
        'Content-Type': contentType || 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(rewritten);
      return;
    }

    const passthrough = {
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    };
    const acceptRanges = upstream.headers.get('accept-ranges');
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const cacheControl = upstream.headers.get('cache-control');
    if (acceptRanges) passthrough['Accept-Ranges'] = acceptRanges;
    if (contentLength) passthrough['Content-Length'] = contentLength;
    if (contentRange) passthrough['Content-Range'] = contentRange;
    if (cacheControl) passthrough['Cache-Control'] = cacheControl;
    res.writeHead(upstream.status, passthrough);
    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

async function handleSubtitle(req, res) {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const inlineId = reqUrl.searchParams.get('id');
    if (inlineId) {
      const inlineSubtitle = inlineSubtitlesById.get(inlineId);
      if (!inlineSubtitle) return json(res, 404, { error: 'Subtitle not found' });
      res.writeHead(200, {
        'Content-Type': inlineSubtitle.contentType || 'text/vtt',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      res.end(inlineSubtitle.content);
      return;
    }

    const target = reqUrl.searchParams.get('url');
    const token = reqUrl.searchParams.get('token') || '';
    if (!target) return json(res, 400, { error: 'Missing url' });
    const targetUrl = new URL(target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return json(res, 400, { error: 'Invalid protocol' });
    }

    let upstream;
    try {
      const headerMap = proxyHeadersByToken.get(token) || new Map();
      upstream = await proxyFetch(targetUrl.toString(), headerMap);
    } catch (err) {
      return json(res, 502, { error: `Subtitle fetch failed: ${err.message}` });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const requestedFormat = reqUrl.searchParams.get('format') || '';
    const format = requestedFormat || detectSubtitleFormat(targetUrl.toString(), contentType);
    let body = await upstream.text();
    if (format === 'srt') {
      body = srtToVtt(body);
    }

    res.writeHead(200, {
      'Content-Type': subtitleContentType(format),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

function isYouTubeUrl(url) {
  return /(^https?:\/\/)?(www\.)?(m\.)?(music\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function extractYouTubeId(url) {
  try {
    let input = url.trim();
    if (input.startsWith('//')) input = `https:${input}`;
    if (input.startsWith('www.')) input = `https://${input}`;
    const u = new URL(input);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '');
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      if (u.searchParams.get('V')) return u.searchParams.get('V');
      const parts = u.pathname.split('/');
      const embedIndex = parts.indexOf('embed');
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
      const shortsIndex = parts.indexOf('shorts');
      if (shortsIndex >= 0 && parts[shortsIndex + 1]) return parts[shortsIndex + 1];
    }
  } catch (_) {}
  const match = url.match(/[?&]v=([^&]+)/i);
  if (match && match[1]) return match[1];
  const short = url.match(/youtu\.be\/([^?&]+)/i);
  if (short && short[1]) return short[1];
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

function castToDevice(device, url, options = {}) {
  return new Promise((resolve, reject) => {
    if (!device || !device.address) {
      return reject(new Error('Device address missing'));
    }
    const client = new Client();
    const cleanup = (err) => {
      client.close();
      if (err) reject(err);
    };
    client.on('error', (err) => {
      console.error('[Cast] Client error:', err?.message || err);
      cleanup(err);
    });
    const port = device.port || 8009;
    client.connect({ host: device.address, port }, () => {
      if (isYouTubeUrl(url)) {
        const videoId = extractYouTubeId(url) || extractYouTubeId(options.referer || '');
        if (!videoId) {
          return cleanup(new Error('YouTube video ID not found'));
        }
        client.launch(YouTubeApp, (err, app) => {
          if (err) return cleanup(err);
          app.load(videoId, () => {
            sessions.set(device.address, { client, app, type: 'youtube' });
            resolve();
          });
        });
      } else {
        const castUrl = options.useProxy ? buildProxyUrl(url, options.token) : url;
        const contentType = detectContentType(url);
        const subtitleTracks = normalizeSubtitleTracks(options.subtitles || [], options.token);
        const activeTrackIds = subtitleTracks
          .filter(track => track.selected)
          .map(track => track.trackId);
        console.log('[Cast] Using URL:', castUrl);
        client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) return cleanup(err);
          const media = {
            contentId: castUrl,
            contentType,
            streamType: 'BUFFERED'
          };
          if (subtitleTracks.length > 0) {
            media.tracks = subtitleTracks.map(({ selected, ...track }) => track);
            media.textTrackStyle = {
              backgroundColor: '#00000000',
              foregroundColor: '#FFFFFFFF',
              edgeType: 'OUTLINE',
              edgeColor: '#000000FF',
              fontScale: 1.0
            };
          }
          const loadOptions = { autoplay: true };
          if (activeTrackIds.length > 0) {
            loadOptions.activeTrackIds = activeTrackIds;
          }
          player.load(media, loadOptions, loadErr => {
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
    return json(res, 200, { status: 'ok', version: '1.0.0', host: LOCAL_IP });
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('pong');
    return;
  }

  if (req.method === 'GET' && req.url === '/devices') {
    const devices = await discoverDevices();
    return json(res, 200, devices);
  }

  if (req.method === 'GET' && req.url.startsWith('/proxy')) {
    return handleProxy(req, res);
  }

  if (req.method === 'GET' && req.url.startsWith('/subtitle')) {
    return handleSubtitle(req, res);
  }

  if (req.method === 'POST' && req.url === '/cast') {
    try {
      const body = await readBody(req);
      const url = body.url;
      const useProxy = !!body.useProxy;
      const referer = body.referer || '';
      const cookie = body.cookie || '';
      const origin = body.origin || '';
      const subtitles = Array.isArray(body.subtitles) ? body.subtitles : [];
      const headerMap = toHeaderMap(body.headers || []);
      const baseHeaders = new Map();
      if (referer) baseHeaders.set('referer', referer);
      if (origin) baseHeaders.set('origin', origin);
      if (cookie) baseHeaders.set('cookie', cookie);
      // Prefer the exact captured media request headers over the top-level tab headers.
      const merged = mergeHeaderMaps(baseHeaders, headerMap);
      const token = Math.random().toString(36).slice(2);
      proxyHeadersByToken.set(token, merged);
      setTimeout(() => proxyHeadersByToken.delete(token), 30 * 60 * 1000);
      console.log('[Cast] url=', url, 'referer=', referer, 'useProxy=', useProxy);
      if (!url) return json(res, 400, { error: 'Missing url' });
      if (useProxy && !isYouTubeUrl(url)) {
        let preflight;
        try {
          preflight = await proxyFetch(url, merged);
        } catch (err) {
          return json(res, 502, { error: `Upstream fetch failed: ${err.message}` });
        }
        const upstreamType = preflight.headers.get('content-type') || '';
        console.log('[Cast] Preflight status=', preflight.status, 'type=', upstreamType);
        try {
          if (preflight.body && typeof preflight.body.cancel === 'function') {
            await preflight.body.cancel();
          }
        } catch (_) {}
        if (!preflight.ok) {
          return json(res, 502, { error: `Stream host blocked cast stream (${preflight.status})` });
        }
      }
      let device = body.device;
      const devices = await discoverDevices();
      if (!device) {
        device = devices[0];
      } else if (!device.address) {
        const byId = device.id ? devices.find(d => d.id === device.id) : null;
        const byName = device.name ? devices.find(d => d.name === device.name) : null;
        device = byId || byName || devices[0];
      }
      if (!device) return json(res, 404, { error: 'No devices found' });
      if (!device.port) device.port = 8009;
      if (!device.address && device.host) device.address = device.host;
      await castToDevice(device, url, { useProxy, referer, cookie, origin, token, subtitles });
      return json(res, 200, { success: true });
    } catch (e) {
      console.error('[Cast] Failed:', e?.message || e);
      return json(res, 500, { error: e.message || 'Cast failed' });
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
  console.log(`Helper running at http://${LOCAL_IP}:${PORT}`);
});
