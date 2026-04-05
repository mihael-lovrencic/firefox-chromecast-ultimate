# Firefox Chromecast Ultimate

A Firefox extension for casting videos and mirroring tabs to Chromecast devices. Works in **Standalone mode** with a local helper or with the ChromecastUltimate Android app.

## Features

- **Standalone Mode** - Cast directly to Chromecast using a local helper service
- **Cast Button Overlay** - Cast button appears on videos automatically
- **Device Discovery** - Auto-discovers Chromecast devices on your network
- **Video Casting** - Cast videos from any webpage to your Chromecast
- **YouTube Support** - Cast the current page (YouTube) directly
- **Tab Mirroring** - Mirror your browser tab to Chromecast (Android app required)
- **Remote Controls** - Play, pause, stop, seek, and volume control
- **Playlist** - Queue multiple videos for playback

## Two Modes

### Standalone Mode (Helper Required)
Standalone mode requires a small local helper service. Firefox extensions cannot access raw TCP/UDP sockets needed by
the Chromecast protocol, so the helper handles discovery and casting on your behalf.

#### Optional: Auto-start helper via Native Messaging (Windows)
You can let the extension start the helper automatically using a native host.

1. Register the native host:
```powershell
powershell -ExecutionPolicy Bypass -File native-messaging\install-native-host.ps1
```
2. Firefox will now auto-start the helper when needed.

#### Install helper (Windows/macOS/Linux)
1. Ensure Node.js 18+ is installed.
2. From `helper/`:
```bash
npm install
npm run start
```
3. Leave it running. It listens on `http://127.0.0.1:4269`.

### Android App Mode
For advanced features like tab mirroring, use the [ChromecastUltimate](https://github.com/mihael-lovrencic/ChromecastUltimate) Android app as a backend server.

## Installation

### Option 1: Install from AMO (Recommended)
Available on [Firefox Add-ons](https://addons.mozilla.org/addon/chromecast-ultimate/) - works on both desktop and Android Firefox.

### Option 2: Install from GitHub Release
1. Download the latest `.xpi` file from the [Releases](https://github.com/mihael-lovrencic/firefox-chromecast-ultimate/releases) page
2. Open Firefox and navigate to `about:config`
3. Search for `xpinstall.signatures.required` and set it to `false`
4. Drag and drop the `.xpi` file into Firefox window
5. Click "Add" when prompted

### Option 3: Temporary Installation (Development)
1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from this extension folder

## Usage

### Standalone Mode (Default)
1. Start the helper service (`helper/`)
2. Open the Firefox extension popup
3. Click "Scan for Chromecasts"
4. Select your Chromecast device
5. Cast videos directly

### Android App Mode
1. Start the ChromecastUltimate Android app and enable the server
2. Open the Firefox extension popup
3. Click "Android App" mode
4. Enter your Android device's IP address in the "Server URL" field
5. Select your Chromecast device and cast

### Cast Button Overlay
The extension automatically adds a cast button to videos on webpages. Hover over a video to see the cast button.

## Android Firefox

The extension works on Firefox for Android (version 128+):
- Use **Standalone Mode** for direct Chromecast casting
- Use **Android App Mode** if you have the ChromecastUltimate app running

**Note**: On Android, Firefox may open the popup in full-screen. Tap the extension icon in the address bar to access controls.

## Development

Build the extension:
```bash
npm install -g web-ext
web-ext build
```

The built `.xpi` file will be in the `web-ext-artifacts/` folder.

## License

MIT
