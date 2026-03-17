# Firefox Chromecast Ultimate

A Firefox extension for casting videos and mirroring tabs to Chromecast devices using the ChromecastUltimate Android app as the backend server.

## Features

- **Device Discovery** - Auto-discovers Chromecast devices on your network
- **Video Casting** - Cast videos from any webpage to your Chromecast
- **YouTube Support** - Cast the current page (YouTube) directly
- **Tab Mirroring** - Mirror your browser tab to Chromecast
- **Remote Controls** - Play, pause, stop, seek, and volume control
- **Subtitles** - Load .srt or .vtt subtitle files and apply them to the current cast
- **Playlist** - Queue multiple videos for playback

## Installation

### Option 1: Install from GitHub Release (Recommended)

1. Download the latest `.xpi` file from the [Releases](https://github.com/mihael-lovrencic/firefox-chromecast-ultimate/releases) page
2. Open Firefox and navigate to `about:config`
3. Search for `xpinstall.signatures.required` and set it to `false`
4. Drag and drop the `.xpi` file into Firefox window
5. Click "Add" when prompted

### Option 2: Temporary Installation (Development)

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from this extension folder

**Note**: Temporary add-ons are removed when Firefox closes.

## Requirements

### Android App (Required)

This extension requires the [ChromecastUltimate](https://github.com/mihael-lovrencic/ChromecastUltimate) Android app to be running:

1. Install the ChromecastUltimate app on your Android device
2. Open the app and tap **"Start Server"**
   - The server runs as a foreground service, so it stays available even if you leave the app
3. Make sure your Android device and Firefox browser are on the same network
4. The extension will discover your Android device as a Chromecast

### Server API Endpoints

The extension communicates with the Android app's HTTP server (port 5000):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/devices` | GET | List available Chromecast devices |
| `/cast` | POST | Cast video URL (body: `{"url": "...", "device": "..."}`) |
| `/control` | POST | Control playback (body: `{"action": "play\|pause\|stop"}`) |
| `/seek` | POST | Seek position (body: `{"value": milliseconds}`) |
| `/volume` | POST | Set volume (body: `{"value": 0.0-1.0}`) |
| `/mirror` | POST | Start tab mirroring |
| `/subtitle` | POST | Load subtitle (body: `{"content": "...", "filename": "file.srt", "format": "srt\|vtt"}`) |
| `/subtitle/{id}` | GET | Fetch subtitle file (used by Chromecast) |
| `/status` | GET | Get connection status (includes `positionMs` and `durationMs`) |

## Usage

1. Start the ChromecastUltimate Android app and enable the server
2. Open the Firefox extension popup
3. Enter your Android device's IP address in the "Server URL" field (e.g., `http://192.168.1.100:5000`)
4. Click "Scan for Devices" to discover Chromecast devices
5. Select your Chromecast device from the dropdown
6. Cast videos or mirror tabs

### Subtitles

1. Start a cast (or queue subtitles before casting)
2. Click **Subtitles** and select a `.srt` or `.vtt` file
3. The extension uploads the subtitle to the Android app and applies it to the current cast

If no cast is active, subtitles are queued and will be applied on the next `/cast`.

### Android Firefox

The extension works on Firefox for Android (version 128+):

1. Install the `.xpi` file same as desktop
2. In the extension popup, enter your Android device's IP (where ChromecastUltimate app is running)
3. On Android, the ChromecastUltimate app acts as the server

**Note**: On Android, Firefox may open the popup in full-screen. Tap the extension icon in the address bar to access controls.

## Permissions

- `activeTab` - Access current tab information
- `tabs` - Query browser tabs
- `scripting` - Execute scripts to find videos on pages
- `host_permissions` - Access all URLs for casting

## Development

Build the extension:
```bash
npm install -g web-ext
web-ext build
```

The built `.xpi` file will be in the `web-ext-artifacts/` folder.

## License

MIT
