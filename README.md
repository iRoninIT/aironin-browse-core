# aiRonin Browse Core

The shared browser automation library used by all aiRonin Browse components. Provides headed Chrome automation with remote browser detection and screenshot analysis capabilities.

## 🎯 Features

- **Remote Browser Detection**: Automatically finds and connects to remote Chrome instances
- **Headed Chrome Automation**: See the browser in action for debugging
- **Screenshot Analysis**: Capture and analyze browser displays for AI agents
- **Smart Tab Management**: Handles multiple tabs and domains intelligently
- **Network Monitoring**: Automatically waits for page loads after interactions
- **Mouse & Keyboard Interactions**: Full browser automation capabilities

## 📋 Prerequisites

- **Node.js**: 20.0.0 or higher
- **Chrome/Chromium**: Will be downloaded automatically via Puppeteer

## 🚀 Quick Start

### Installation

```bash
# Install as dependency
pnpm add aironin-browse-core

# Or install from workspace
pnpm install
```

### Basic Usage

```typescript
import { BrowserSession } from "aironin-browse-core";

// Create browser session
const browser = new BrowserSession();

// Launch browser (auto-detects remote browsers)
await browser.launchBrowser();

// Navigate to URL
const result = await browser.navigateToUrl("https://example.com");

// Take screenshot
console.log("Screenshot:", result.screenshot);

// Click at coordinates
await browser.click("200,300");

// Type text
await browser.type("Hello World");

// Scroll page
await browser.scrollDown();
await browser.scrollUp();

// Close browser
await browser.closeBrowser();
```

## 🔧 Configuration

### Environment Variables

```bash
# Browser viewport size
export BROWSER_VIEWPORT_SIZE=1200x800

# Screenshot quality (1-100)
export SCREENSHOT_QUALITY=85

# Enable remote browser connection
export REMOTE_BROWSER_ENABLED=true

# Remote browser host URL
export REMOTE_BROWSER_HOST=http://localhost:9222
```

### Remote Browser Detection

The core library automatically detects and connects to remote browsers:

1. **Auto-Detection**: Scans for Chrome instances on port 9222
2. **Network Scanning**: Checks localhost, Docker hosts, and network interfaces
3. **Fallback**: Uses local browser if no remote browser found
4. **Manual Override**: Can force remote or local browser via environment variables

## 📦 API Reference

### BrowserSession Class

The main browser automation class.

#### Constructor

```typescript
new BrowserSession(storagePath?: string)
```

- `storagePath`: Optional path for browser storage (default: `./.browser-automation`)

#### Methods

##### `launchBrowser(): Promise<void>`

Launches or connects to a browser instance.

```typescript
const browser = new BrowserSession();
await browser.launchBrowser();
```

##### `navigateToUrl(url: string): Promise<BrowserActionResult>`

Navigates to a URL and returns page information.

```typescript
const result = await browser.navigateToUrl("https://example.com");
console.log("Current URL:", result.currentUrl);
console.log("Screenshot:", result.screenshot);
console.log("Console logs:", result.logs);
```

##### `click(coordinates: string): Promise<BrowserActionResult>`

Clicks at specified coordinates.

```typescript
await browser.click("200,300");
```

##### `type(text: string): Promise<BrowserActionResult>`

Types text into the browser.

```typescript
await browser.type("Hello World");
```

##### `scrollDown(): Promise<BrowserActionResult>`

Scrolls the page down.

```typescript
await browser.scrollDown();
```

##### `scrollUp(): Promise<BrowserActionResult>`

Scrolls the page up.

```typescript
await browser.scrollUp();
```

##### `hover(coordinates: string): Promise<BrowserActionResult>`

Hovers at specified coordinates.

```typescript
await browser.hover("200,300");
```

##### `resize(size: string): Promise<BrowserActionResult>`

Resizes the browser window.

```typescript
await browser.resize("1200,800");
```

##### `closeBrowser(): Promise<BrowserActionResult>`

Closes the browser and returns final state.

```typescript
const result = await browser.closeBrowser();
```

##### `doAction(action: (page: Page) => Promise<void>): Promise<BrowserActionResult>`

Executes a custom action and returns results with screenshot.

```typescript
const result = await browser.doAction(async (page) => {
  // Custom page interaction
  await page.evaluate(() => {
    document.title = "Modified Title";
  });
});
```

### BrowserActionResult Interface

All browser actions return this interface:

```typescript
interface BrowserActionResult {
  screenshot?: string; // Base64 data URL for AI analysis
  logs?: string; // Console logs for debugging
  currentUrl?: string; // Current page URL
  currentMousePosition?: string; // Last mouse position
}
```

### Browser Discovery Utilities

#### `discoverChromeHostUrl(port?: number): Promise<string | null>`

Discovers Chrome instances on the network.

```typescript
import { discoverChromeHostUrl } from "aironin-browse-core";

const hostUrl = await discoverChromeHostUrl(9222);
if (hostUrl) {
  console.log("Found Chrome at:", hostUrl);
}
```

## 🤖 AI Agent Integration

### Screenshot Analysis

The core library is optimized for AI agent analysis:

1. **Visual Feedback**: Screenshots provide visual context of browser state
2. **State Tracking**: URL and mouse position for context awareness
3. **Error Detection**: Console logs help identify issues
4. **Interaction Planning**: AI can plan actions based on visual data

### Example AI Agent Workflow

```typescript
const browser = new BrowserSession();

// 1. Launch and navigate
await browser.launchBrowser();
const navResult = await browser.navigateToUrl("https://example.com");

// 2. Analyze screenshot for AI decision-making
if (navResult.screenshot) {
  // AI can analyze the screenshot to understand page content
  console.log("Screenshot available for analysis");
}

// 3. Interact based on analysis
await browser.click("200,300");
await browser.type("AI Agent Input");

// 4. Get updated state
const finalResult = await browser.closeBrowser();
```

## 🔍 Remote Browser Detection

### How It Works

1. **Priority Scanning**: Checks localhost, Docker hosts, common IPs
2. **Network Discovery**: Scans network interfaces for Chrome instances
3. **Connection Testing**: Validates WebSocket connections
4. **Fallback**: Uses local browser if remote not found

### Supported Remote Browsers

- **Local Chrome**: `http://localhost:9222`
- **Docker Hosts**: `host.docker.internal:9222`
- **Network Chrome**: Any Chrome with `--remote-debugging-port=9222`
- **Custom Hosts**: Via `REMOTE_BROWSER_HOST` environment variable

### Manual Remote Browser Setup

```bash
# Start Chrome with remote debugging
chrome --remote-debugging-port=9222

# The library will automatically detect and connect
```

## 🧪 Testing

### Unit Tests

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

### Integration Tests

```bash
# Test with real browser
pnpm test:integration
```

## 🔍 Troubleshooting

### Common Issues

1. **Chrome not launching**:

   - Ensure sufficient disk space for Chromium download
   - Check internet connection for Chromium download
   - Verify Chrome/Chromium is not already running in debug mode

2. **Remote connection fails**:

   - Verify Chrome is running with `--remote-debugging-port=9222`
   - Check firewall settings
   - Ensure correct host URL

3. **Permission errors**:
   - Check file permissions for storage directory
   - Ensure write access to current directory

### Debug Mode

Enable debug logging:

```bash
DEBUG=aironin-browse* node your-script.js
```

## 🛠️ Development

### Building from Source

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Project Structure

```
aironin-browse-core/
├── src/
│   ├── BrowserSession.ts      # Main browser automation class
│   ├── browserDiscovery.ts    # Remote browser detection
│   └── index.ts              # Public API exports
├── dist/                     # Built files
├── package.json
└── tsconfig.json
```

### Adding New Features

1. **Browser Actions**: Add methods to `BrowserSession` class
2. **Discovery**: Extend `browserDiscovery.ts` for new detection methods
3. **Configuration**: Add environment variable support
4. **Testing**: Add unit and integration tests

## 📄 License

MIT License - see LICENSE file for details.

## 🏢 About

**aiRonin Browse Core** is developed by **CK @ iRonin.IT**.

**iRonin.IT** is a software development company specializing in AI-powered tools and automation solutions.

## 🆘 Support

For issues and questions:

- Open an issue on the repository
- Check the troubleshooting section
- Review the configuration options

---

**Ready to power browser automation for AI agents!** 🎯🤖
