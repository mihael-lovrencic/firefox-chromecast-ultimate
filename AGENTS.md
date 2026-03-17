# AGENTS.md - Firefox Chromecast Ultimate Extension

## Project Overview

This is a Firefox browser extension (Manifest V3) for casting videos and mirroring tabs to Chromecast devices. It communicates with the ChromecastUltimate Android app as a backend server.

## Project Structure

```
firefox-chromecast-ultimate/
├── manifest.json          # Extension manifest (MV3)
├── popup.html            # Extension popup UI
├── popup.js              # Extension logic
├── icons/
│   └── icon.svg          # Extension icon
└── .github/workflows/
    └── release.yml       # CI/CD for building .xpi on release
```

## Build, Lint, and Test Commands

### Install Dependencies
```bash
npm install -g web-ext
```

### Lint Extension (Validate manifest and code)
```bash
cd /path/to/firefox-chromecast-ultimate
npx web-ext lint
```

### Build Extension
```bash
npx web-ext build
```
- Output: `.xpi` file in `web-ext-artifacts/` directory

### Run Extension in Development
```bash
npx web-ext run
```

### Single Test (via lint)
```bash
npx web-ext lint --verbose
```

## Code Style Guidelines

### General Principles

1. **Keep it simple** - This is a browser extension, not a complex framework
2. **No build tools** - Plain JavaScript, no transpilation required
3. **ES6+ allowed** - Firefox supports modern JS features

### JavaScript Style

- Use `const` by default, `let` when mutation is needed, avoid `var`
- Use arrow functions for callbacks and anonymous functions
- Use async/await for asynchronous operations instead of raw promises
- Use template literals for string interpolation: `` `Hello ${name}` ``

### Function Declarations
```javascript
// Good
async function loadDevices() { ... }

// Avoid
const loadDevices = async function() { ... };
```

### Variable Naming
- camelCase for variables and functions: `loadDevices`, `serverUrl`
- Descriptive names: `currentSession` not `cs`, `devices` not `d`
- Boolean prefixes: `isConnected`, `hasDevices`, `canCast`

### HTML/CSS Style (popup.html)

- Use semantic HTML elements
- Inline CSS in `<style>` block for simple styling
- Class names: lowercase with dashes: `.video-btn`, `.status-text`
- IDs: camelCase: `id="devices"`, `id="serverUrl"`

### Imports

This extension uses browser extension APIs. No import statements needed:
- Use `browser.tabs`, `browser.scripting`, `browser.storage`
- Use standard `fetch()` for HTTP requests

### Error Handling

```javascript
// Good pattern
async function loadDevices() {
  try {
    const res = await fetch(`${serverUrl}/devices`);
    const devices = await res.json();
    // ...
  } catch (e) {
    console.error('Error loading devices:', e);
    setStatus('Error loading devices');
  }
}
```

- Always use try/catch for async operations
- Log errors to console with descriptive messages
- Provide user feedback via setStatus()

### async/await Usage

```javascript
// Good
async function cast(url) {
  const device = devicesSelect.value;
  if (!device) {
    setStatus('Please select a device first');
    return;
  }
  const res = await fetch(`${serverUrl}/cast`, { ... });
  const result = await res.json();
  setStatus('Casting started');
}

// Avoid
function cast(url) {
  fetch(...).then(res => res.json()).then(result => ...);
}
```

### DOM Manipulation

- Cache DOM elements at top of script: `const statusEl = document.getElementById('status');`
- Use template literals for dynamic content
- Use `addEventListener` instead of inline onclick for better separation

### Manifest Requirements

- Manifest V3 required for Firefox 121+ and Firefox Android 128+
- Use `permissions` for runtime permissions, `host_permissions` for URLs
- Include `browser_specific_settings.gecko` with extension ID
- Set `android_min_version` for Firefox Android support

### Firefox Extension API Notes

- Use `browser.tabs.query()` to get current tab
- Use `browser.scripting.executeScript()` to inject scripts (MV3)
- Use `browser.runtime.getManifest()` to access manifest
- Popup context has access to extension APIs

### Git Workflow

1. Create feature branch: `git checkout -b feature/name`
2. Make changes and test with `npx web-ext run`
3. Lint before commit: `npx web-ext lint`
4. Commit with descriptive message
5. Push and create PR

### Release Process

1. Update version in `manifest.json`
2. Push to `main` branch
3. Create GitHub release with tag (e.g., v3.0.0)
4. CI automatically builds .xpi and attaches to release

### Common Issues

- **CORS errors**: Ensure server URL is correct and server allows CORS
- **Script injection fails**: Use `browser.scripting.executeScript()` for MV3
- **Extension won't load**: Run `npx web-ext lint` to validate

### Additional Notes

- Server URL is stored in `localStorage` for persistence
- Server discovery scans local network subnet (192.168.x.x)
- Extension connects to ChromecastUltimate Android app on port 5000