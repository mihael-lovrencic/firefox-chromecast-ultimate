# Firefox Chromecast Ultimate

A Firefox extension for casting videos and mirroring tabs to Chromecast devices.

## Features

- **Device Discovery** - Auto-discovers Chromecast devices on your network
- **Video Casting** - Cast videos from any webpage to your Chromecast
- **YouTube Support** - Cast the current page (YouTube) directly
- **Tab Mirroring** - Mirror your browser tab to Chromecast
- **Remote Controls** - Play, pause, stop, seek, and volume control
- **Subtitles** - Load .srt or .vtt subtitle files
- **Playlist** - Queue multiple videos for playback

## Installation

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from this extension folder

## Requirements

A backend server must be running to communicate with Chromecast devices:

```bash
# Install dependencies
npm install express body-parser mdns-browser castv2-client

# Run the server
node server.js
```

The server runs on `localhost:5000` by default.

## Permissions

- `activeTab` - Access current tab information
- `tabs` - Query browser tabs
- `scripting` - Execute scripts to find videos on pages
- `host_permissions` - Access all URLs for casting

## Development

Run tests locally:
```bash
npm install -g web-ext
web-ext lint
web-ext build
```

## License

MIT