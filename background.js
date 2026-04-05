const Castv2Client = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSED: 'closed',
  
  async connect(host, port = 8009) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${host}:${port}`);
      let connected = false;
      
      socket.onopen = () => {
        connected = true;
        console.log('Castv2: Connected to', host);
        resolve({
          socket,
          send: (data) => socket.send(JSON.stringify(data)),
          close: () => socket.close()
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
          this.handleMessage(data);
        } catch (e) {
          console.log('Castv2: Raw message', event.data);
        }
      };
      
      setTimeout(() => {
        if (!connected) reject(new Error('Connection timeout'));
      }, 10000);
    });
  },
  
  handleMessage(data) {
    console.log('Castv2: Message', data);
  }
};

const MDNSDiscovery = {
  async discover(timeout = 5000) {
    const devices = [];
    const startTime = Date.now();
    
    const scanSubnet = async (subnet) => {
      const promises = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        promises.push(this.checkDevice(ip).then(device => {
          if (device) devices.push(device);
        }).catch(() => {}));
      }
      await Promise.all(promises);
    };
    
    const localIp = await this.getLocalIP();
    if (localIp) {
      const subnet = localIp.substring(0, localIp.lastIndexOf('.'));
      await scanSubnet(subnet);
    } else {
      await scanSubnet('192.168.1');
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
  },
  
  async checkDevice(ip) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      
      const response = await fetch(`http://${ip}:8009`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      const text = await response.text();
      
      if (text.includes('Google') || text.includes('Chromecast') || text.includes('Cast')) {
        const nameMatch = text.match(/friendlyName["\s:=]+([^"<&]+)/i) || 
                        text.match(/name["\s:=]+([^"<&]+)/i);
        return {
          name: nameMatch ? nameMatch[1].trim() : `Chromecast (${ip})`,
          address: ip,
          port: 8009
        };
      }
    } catch (e) {}
    return null;
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
      const devices = await MDNSDiscovery.discover();
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
    MDNSDiscovery.discover().then(devices => {
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