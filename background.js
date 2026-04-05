const Castv2Client = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
  
  async connect(host, port = 8009) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${host}:${port}`);
      let connected = false;
      let responseHandler = null;
      
      socket.onopen = () => {
        connected = true;
        console.log('Castv2: Connected to', host);
        resolve({
          socket,
          send: (data) => socket.send(JSON.stringify(data)),
          close: () => socket.close(),
          onMessage: (handler) => { responseHandler = handler; }
        });
      };
      
      socket.onerror = (e) => {
        console.error('Castv2: Socket error', e);
        if (!connected) reject(new Error('Connection failed'));
      };
      
      socket.onclose = () => {
        console.log('Castv2: Connection closed');
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Castv2: Message', data);
          if (responseHandler) responseHandler(data);
        } catch (e) {
          console.log('Castv2: Raw message', event.data);
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
    
    const checkDevice = (ip) => {
      return new Promise((resolve) => {
        try {
          const socket = new WebSocket(`ws://${ip}:8009`);
          let timeout = setTimeout(() => {
            socket.close();
            resolve(null);
          }, 2000);
          
          socket.onopen = () => {
            clearTimeout(timeout);
            socket.send(JSON.stringify({
              type: 'GET_APP_AVAILABILITY',
              requestId: 1,
              apps: ['YouTube', 'Netflix']
            }));
          };
          
          socket.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'receiver' || data.status) {
                clearTimeout(timeout);
                socket.close();
                resolve({
                  name: `Chromecast (${ip})`,
                  address: ip,
                  port: 8009
                });
              } else {
                clearTimeout(timeout);
                socket.close();
                resolve({
                  name: `Chromecast (${ip})`,
                  address: ip,
                  port: 8009
                });
              }
            } catch (e) {
              clearTimeout(timeout);
              socket.close();
              resolve({
                name: `Chromecast (${ip})`,
                address: ip,
                port: 8009
              });
            }
          };
          
          socket.onerror = () => {
            clearTimeout(timeout);
            socket.close();
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      });
    };
    
    const localIp = await this.getLocalIP();
    const subnets = localIp ? [localIp.substring(0, localIp.lastIndexOf('.'))] : ['192.168.1', '192.168.0'];
    
    for (const subnet of subnets) {
      const promises = [];
      for (let i = 1; i <= 254; i++) {
        promises.push(checkDevice(`${subnet}.${i}`).then(device => {
          if (device && !devices.find(d => d.address === device.address)) {
            devices.push(device);
          }
        }).catch(() => {}));
      }
      await Promise.all(promises);
    }
    
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
  status: Castv2Client.CLOSED,
  
  async connect(device) {
    if (this.socket) {
      this.socket.close();
    }
    
    this.status = Castv2Client.CONNECTING;
    this.device = device;
    
    try {
      this.socket = await Castv2Client.connect(device.address, device.port || 8009);
      this.status = Castv2Client.CONNECTED;
      
      this.send({
        type: 'CONNECT',
        transportId: 'web-4'
      });
      
      browser.runtime.sendMessage({
        type: 'castState',
        casting: true,
        deviceName: device.name
      });
      
      return true;
    } catch (e) {
      console.error('Failed to connect:', e);
      this.status = Castv2Client.CLOSED;
      return false;
    }
  },
  
  send(data) {
    if (this.socket && this.status === Castv2Client.CONNECTED) {
      this.socket.send(data);
    }
  },
  
  async castVideo(url) {
    if (!this.socket || this.status !== Castv2Client.CONNECTED) {
      const devices = await ChromecastDiscovery.discover();
      if (devices.length === 0) {
        throw new Error('No devices found');
      }
      await this.connect(devices[0]);
    }
    
    const mediaSession = {
      type: 'LOAD',
      requestId: Date.now(),
      sessionId: 'web-session',
      transportId: 'web-4',
      media: {
        contentId: url,
        streamType: 'BUFFERED',
        contentType: 'video/mp4'
      },
      autoplay: true,
      currentTime: 0
    };
    
    this.send(mediaSession);
  },
  
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.status = Castv2Client.CLOSED;
    this.device = null;
    
    browser.runtime.sendMessage({
      type: 'castState',
      casting: false
    });
  }
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'discoverDevices') {
    ChromecastDiscovery.discover().then(devices => {
      sendResponse(devices);
    });
    return true;
  }
  
  if (message.type === 'castVideo') {
    ChromecastSession.connect(message.device).then(() => {
      ChromecastSession.castVideo(message.videoUrl).then(() => {
        sendResponse({ success: true });
      }).catch(e => {
        sendResponse({ error: e.message });
      });
    });
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