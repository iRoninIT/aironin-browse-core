// Export the main browser automation classes and utilities
export { BrowserSession } from "./BrowserSession.js"
export { discoverChromeHostUrl, tryChromeHostUrl, isPortOpen, getDockerHostIP, scanNetworkForChrome } from "./browserDiscovery.js"
export type { BrowserActionResult } from "./BrowserSession.js" 
