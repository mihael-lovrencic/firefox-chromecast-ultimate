const Castv2Client = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
  
  async connect(host, port = 8009) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${host}:${port}`);
      let connected = false;
      let requestId = 0;
      const pending = {};
      const sessionId = `session-${Date.now()}`;
      
      socket.onopen = () => {
        connected = true;
        console.log('[Castv2] Connected to', host);
        
        this.send({
          type: 'CONNECT',
          transportId: sessionId
        });
        
        resolve({
          socket,
          sessionId,
          send: (data) => socket.send(JSON.stringify(data)),
          onMessage: (handler) => { 
            socket.onmessage = (e) => handler(JSON.parse(e.data)); 
          },
          close: () => socket.close()
        });
      };
      
      socket.onerror = (e) => {
        console.error('[Castv2] Socket error', e);
        if (!connected) reject(new Error('Connection failed'));
      };
      
      socket.onclose = () => console.log('[Castv2] Connection closed');
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Castv2] Received:', data.type);
          if (pending[data.requestId]) {
            pending[data.requestId](data);
            delete pending[data.requestId];
          }
        } catch (e) {
          console.log('[Castv2] Raw message:', event.data);
        }
      };
      
      setTimeout(() => {
        if (!connected) reject(new Error('Connection timeout'));
      }, 10000);
    });
  }
};

const ChromecastDiscovery = {
  async discover() {
    const devices = [];
    const subnets = ['192.168.1', '192.168.0'];
    
    console.log('[Discovery] Starting scan...');
    
    const checkDevice = (ip) => {
      return new Promise((resolve) => {
        try {
          const socket = new WebSocket(`ws://${ip}:8009`);
          let timeout = setTimeout(() => {
            try { socket.close(); } catch(e) {}
            resolve(null);
          }, 1000);
          
          socket.onopen = () => {
            clearTimeout(timeout);
            socket.close();
            resolve({ name: `Chromecast (${ip})`, address: ip, port: 8009 });
          };
          
          socket.onerror = () => {
            clearTimeout(timeout);
            try { socket.close(); } catch(e) {}
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      });
    };
    
    for (const subnet of subnets) {
      const promises = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        promises.push(checkDevice(ip).then(device => {
          if (device && !devices.find(d => d.address === device.address)) {
            devices.push(device);
            console.log('[Discovery] Found:', ip);
          }
        }).catch(() => {}));
      }
      await Promise.all(promises);
    }
    
    console.log('[Discovery] Complete. Found', devices.length, 'devices');
    return devices;
  },
  
  async getLocalIP() {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate) {
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+)\.\d+/);
          pc.close();
          resolve(match ? match[1] + '.1' : null);
        }
      };
      pc.createOffer().then(o => pc.setLocalDescription(o));
      setTimeout(() => { pc.close(); resolve(null); }, 2000);
    });
  }
};

const ChromecastSession = {
  socket: null,
  device: null,
  sessionId: null,
  
  async connect(device) {
    if (this.socket) {
      this.socket.close();
    }
    
    console.log('[Session] Connecting to', device.address);
    
    try {
      this.socket = await Castv2Client.connect(device.address, device.port || 8009);
      this.device = device;
      this.sessionId = this.socket.sessionId;
      
      console.log('[Session] Connected, launching receiver...');
      
      await this.launchReceiver();
      
      console.log('[Session] Receiver launched');
      
      return true;
    } catch (e) {
      console.error('[Session] Connection failed:', e);
      this.socket = null;
      return false;
    }
  },
  
  async launchReceiver() {
    return new Promise((resolve, reject) => {
      const launchRequest = {
        type: 'LAUNCH',
        requestId: Date.now(),
        sessionId: this.sessionId,
        transportId: this.sessionId,
        appId: 'CC1AD845'
      };
      
      this.socket.onMessage((data) => {
        if (data.type === 'RECEIVER_STATUS') {
          const app = data.status.applications?.find(a => a.appId === 'CC1AD845');
          if (app) {
            this.sessionId = app.sessionId;
            console.log('[Session] Receiver running, sessionId:', this.sessionId);
            resolve();
          }
        }
      });
      
      this.socket.send(launchRequest);
      
      setTimeout(() => resolve(), 5000);
    });
  },
  
  async loadMedia(contentUrl) {
    if (!this.socket) throw new Error('Not connected');
    
    console.log('[Session] Loading media:', contentUrl);
    
    const loadRequest = {
      type: 'LOAD',
      requestId: Date.now(),
      sessionId: this.sessionId,
      transportId: this.sessionId,
      media: {
        contentId: contentUrl,
        streamType: 'BUFFERED',
        contentType: 'video/mp4'
      },
      autoplay: true,
      currentTime: 0
    };
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 5000);
      
      this.socket.onMessage((data) => {
        if (data.type === 'MEDIA_STATUS' && data.status?.[0]) {
          clearTimeout(timeout);
          console.log('[Session] Media loaded, playing');
          resolve();
        }
      });
      
      this.socket.send(loadRequest);
    });
  },
  
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.device = null;
    this.sessionId = null;
  }
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'discoverDevices') {
    ChromecastDiscovery.discover()
      .then(devices => sendResponse(devices))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  
  if (message.type === 'castVideo') {
    (async () => {
      try {
        const device = message.device;
        if (!device) {
          const devices = await ChromecastDiscovery.discover();
          if (devices.length === 0) {
            sendResponse({ error: 'No devices found' });
            return;
          }
          device = devices[0];
        }
        
        await ChromecastSession.connect(device);
        await ChromecastSession.loadMedia(message.videoUrl);
        
        sendResponse({ success: true });
      } catch (e) {
        console.error('[Background] Cast error:', e);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  
  if (message.type === 'stopCast') {
    ChromecastSession.disconnect();
    sendResponse({ success: true });
    return true;
  }
});

browser.runtime.onInstalled.addListener(() => {
  console.log('Chromecast Ultimate extension installed');
});
