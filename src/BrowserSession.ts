import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Browser, Page, type ScreenshotOptions, TimeoutError, launch, connect } from "puppeteer-core"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import pWaitFor from "p-wait-for"
import delay from "delay"
import { discoverChromeHostUrl, tryChromeHostUrl } from "./browserDiscovery.js"
import axios from "axios"

// Timeout constants
const BROWSER_NAVIGATION_TIMEOUT = 15_000 // 15 seconds

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

export interface BrowserActionResult {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export class BrowserSession {
	private browser?: Browser
	private page?: Page
	private currentMousePosition?: string
	private lastConnectionAttempt?: number
	private isUsingRemoteBrowser: boolean = false
	private storagePath: string

	constructor(storagePath: string = path.join(process.cwd(), ".browser-automation")) {
		this.storagePath = storagePath
	}

	private async ensureChromiumExists(): Promise<PCRStats> {
		const puppeteerDir = path.join(this.storagePath, "puppeteer")
		const dirExists = await this.fileExists(puppeteerDir)
		if (!dirExists) {
			await fs.mkdir(puppeteerDir, { recursive: true })
		}

		// if chromium doesn't exist, this will download it to path.join(puppeteerDir, ".chromium-browser-snapshots")
		// if it does exist it will return the path to existing chromium
		const stats: PCRStats = await PCR({
			downloadPath: puppeteerDir,
		})

		return stats
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	/**
	 * Gets the viewport size from environment or returns default
	 */
	private getViewport() {
		const size = process.env.BROWSER_VIEWPORT_SIZE || "900x600"
		const [width, height] = size.split("x").map(Number)
		return { width: width || 900, height: height || 600 }
	}

	/**
	 * Launches a local browser instance
	 */
	private async launchLocalBrowser(): Promise<void> {
		console.error("Launching local browser")
		const stats = await this.ensureChromiumExists()
		this.browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
			],
			executablePath: stats.executablePath,
			defaultViewport: this.getViewport(),
			headless: false, // This is the key difference - headed mode for visibility
		})
		this.isUsingRemoteBrowser = false
		
		// Create a new page after launching
		this.page = await this.browser.newPage()
	}

	/**
	 * Connects to a browser using a WebSocket URL
	 */
	private async connectWithChromeHostUrl(chromeHostUrl: string): Promise<boolean> {
		try {
			console.error(`🔍 DEBUG: Connecting to Chrome at ${chromeHostUrl}`)
			
			// Get the WebSocket URL from the Chrome debugging endpoint
			const response = await axios.get(`${chromeHostUrl}/json/version`)
			const webSocketDebuggerUrl = response.data.webSocketDebuggerUrl

			if (!webSocketDebuggerUrl) {
				console.error("🔍 DEBUG: No WebSocket debugger URL found in response")
				return false
			}

			console.error(`🔍 DEBUG: WebSocket URL: ${webSocketDebuggerUrl}`)

			// Connect to the browser using the WebSocket URL
			this.browser = await connect({
				browserWSEndpoint: webSocketDebuggerUrl,
			})

			// Cache the successful endpoint
			console.error(`🔍 DEBUG: Connected to remote browser at ${chromeHostUrl}`)
			this.lastConnectionAttempt = Date.now()
			this.isUsingRemoteBrowser = true

			// Get the first page or create a new one
			const pages = await this.browser.pages()
			this.page = pages[0] || await this.browser.newPage()

			console.error("🔍 DEBUG: Successfully connected to remote browser")
			return true
		} catch (error) {
			console.error(`🔍 DEBUG: Failed to connect using WebSocket endpoint: ${error}`)
			return false
		}
	}

	/**
	 * Attempts to connect to a remote browser using various methods
	 * Returns true if connection was successful, false otherwise
	 */
	private async connectToRemoteBrowser(): Promise<boolean> {
		let remoteBrowserHost = process.env.REMOTE_BROWSER_HOST
		let reconnectionAttempted = false

		console.error("🔍 DEBUG: Starting remote browser connection attempt")
		console.error(`🔍 DEBUG: REMOTE_BROWSER_ENABLED = ${process.env.REMOTE_BROWSER_ENABLED}`)
		console.error(`🔍 DEBUG: REMOTE_BROWSER_HOST = ${remoteBrowserHost}`)

		// If user provided a remote browser host, try to connect to it
		if (remoteBrowserHost && !reconnectionAttempted) {
			console.error(`🔍 DEBUG: Attempting to connect to remote browser at ${remoteBrowserHost}`)
			try {
				const hostIsValid = await tryChromeHostUrl(remoteBrowserHost)

				if (!hostIsValid) {
					throw new Error("Could not find chromeHostUrl in the response")
				}

				console.error(`🔍 DEBUG: Found WebSocket endpoint: ${remoteBrowserHost}`)

				if (await this.connectWithChromeHostUrl(remoteBrowserHost)) {
					console.error("🔍 DEBUG: Successfully connected to remote browser")
					return true
				}
			} catch (error) {
				console.error(`🔍 DEBUG: Failed to connect to remote browser: ${error}`)
				// Fall back to auto-discovery if remote connection fails
			}
		}

		try {
			console.error("🔍 DEBUG: Attempting browser auto-discovery...")
			const chromeHostUrl = await discoverChromeHostUrl()

			if (chromeHostUrl) {
				console.error(`🔍 DEBUG: Auto-discovered Chrome at: ${chromeHostUrl}`)
				if (await this.connectWithChromeHostUrl(chromeHostUrl)) {
					console.error("🔍 DEBUG: Successfully connected to auto-discovered Chrome")
					return true
				}
			} else {
				console.error("🔍 DEBUG: No Chrome instances discovered")
			}
		} catch (error) {
			console.error(`🔍 DEBUG: Auto-discovery failed: ${error}`)
			// Fall back to local browser if auto-discovery fails
		}

		console.error("🔍 DEBUG: All remote connection attempts failed")
		return false
	}

	async launchBrowser(): Promise<void> {
		console.error("launch browser called")

		// Check if remote browser connection is enabled
		const remoteBrowserEnabled = process.env.REMOTE_BROWSER_ENABLED === "true"

		if (!remoteBrowserEnabled) {
			console.error("Launching local browser")
			if (this.browser) {
				await this.closeBrowser() // this may happen when the model launches a browser again after having used it already before
			} else {
				// If browser wasn't open, just reset the state
				this.resetBrowserState()
			}
			await this.launchLocalBrowser()
		} else {
			console.error("Connecting to remote browser")
			// Remote browser connection is enabled
			const remoteConnected = await this.connectToRemoteBrowser()

			// If all remote connection attempts fail, fall back to local browser
			if (!remoteConnected) {
				console.error("Falling back to local browser")
				await this.launchLocalBrowser()
			}
		}
	}

	/**
	 * Closes the browser and resets browser state
	 */
	async closeBrowser(): Promise<BrowserActionResult> {
		if (this.browser || this.page) {
			console.error("closing browser...")

			if (this.isUsingRemoteBrowser && this.browser) {
				await this.browser.disconnect().catch(() => {})
			} else {
				await this.browser?.close().catch(() => {})
			}
			this.resetBrowserState()
		}
		return {}
	}

	/**
	 * Resets all browser state variables
	 */
	private resetBrowserState(): void {
		this.browser = undefined
		this.page = undefined
		this.currentMousePosition = undefined
		this.isUsingRemoteBrowser = false
	}

	async doAction(action: (page: Page) => Promise<void>): Promise<BrowserActionResult> {
		if (!this.page) {
			throw new Error(
				"Browser is not launched. This may occur if the browser was automatically closed.",
			)
		}

		const logs: string[] = []
		let lastLogTs = Date.now()

		const consoleListener = (msg: any) => {
			if (msg.type() === "log") {
				logs.push(msg.text())
			} else {
				logs.push(`[${msg.type()}] ${msg.text()}`)
			}
			lastLogTs = Date.now()
		}

		const errorListener = (err: Error) => {
			logs.push(`[Page Error] ${err.toString()}`)
			lastLogTs = Date.now()
		}

		// Add the listeners
		this.page.on("console", consoleListener)
		this.page.on("pageerror", errorListener)

		try {
			await action(this.page)
		} catch (err) {
			if (!(err instanceof TimeoutError)) {
				logs.push(`[Error] ${err instanceof Error ? err.toString() : String(err)}`)
			}
		}

		// Wait for console inactivity, with a timeout
		await pWaitFor(() => Date.now() - lastLogTs >= 500, {
			timeout: 3_000,
			interval: 100,
		}).catch(() => {})

		let options: ScreenshotOptions = {
			encoding: "base64",
		}

		let screenshotBase64 = await this.page.screenshot({
			...options,
			type: "webp",
			quality: parseInt(process.env.SCREENSHOT_QUALITY || "75"),
		})
		let screenshot = `data:image/webp;base64,${screenshotBase64}`

		if (!screenshotBase64) {
			console.error("webp screenshot failed, trying png")
			screenshotBase64 = await this.page.screenshot({
				...options,
				type: "png",
			})
			screenshot = `data:image/png;base64,${screenshotBase64}`
		}

		if (!screenshotBase64) {
			throw new Error("Failed to take screenshot.")
		}

		// this.page.removeAllListeners() <- causes the page to crash!
		this.page.off("console", consoleListener)
		this.page.off("pageerror", errorListener)

		return {
			screenshot,
			logs: logs.join("\n"),
			currentUrl: this.page.url(),
			currentMousePosition: this.currentMousePosition,
		}
	}

	/**
	 * Extract the root domain from a URL
	 * e.g., http://localhost:3000/path -> localhost:3000
	 * e.g., https://example.com/path -> example.com
	 */
	private getRootDomain(url: string): string {
		try {
			const urlObj = new URL(url)
			// Remove www. prefix if present
			return urlObj.host.replace(/^www\./, "")
		} catch (error) {
			// If URL parsing fails, return the original URL
			return url
		}
	}

	/**
	 * Navigate to a URL with standard loading options
	 */
	private async navigatePageToUrl(page: Page, url: string): Promise<void> {
		await page.goto(url, { timeout: BROWSER_NAVIGATION_TIMEOUT, waitUntil: ["domcontentloaded", "networkidle2"] })
		await this.waitTillHTMLStable(page)
	}

	/**
	 * Creates a new tab and navigates to the specified URL
	 */
	private async createNewTab(url: string): Promise<BrowserActionResult> {
		if (!this.browser) {
			throw new Error("Browser is not launched")
		}

		// Create a new page
		const newPage = await this.browser.newPage()

		// Set the new page as the active page
		this.page = newPage

		// Navigate to the URL
		const result = await this.doAction(async (page) => {
			await this.navigatePageToUrl(page, url)
		})

		return result
	}

	async navigateToUrl(url: string): Promise<BrowserActionResult> {
		if (!this.browser) {
			throw new Error("Browser is not launched")
		}
		// Remove trailing slash for comparison
		const normalizedNewUrl = url.replace(/\/$/, "")

		// Extract the root domain from the URL
		const rootDomain = this.getRootDomain(normalizedNewUrl)

		// Get all current pages
		const pages = await this.browser.pages()

		// Try to find a page with the same root domain
		let existingPage: Page | undefined

		for (const page of pages) {
			try {
				const pageUrl = page.url()
				if (pageUrl && this.getRootDomain(pageUrl) === rootDomain) {
					existingPage = page
					break
				}
			} catch (error) {
				// Skip pages that might have been closed or have errors
				console.error(`Error checking page URL: ${error}`)
				continue
			}
		}

		if (existingPage) {
			// Tab with the same root domain exists, switch to it
			console.error(`Tab with domain ${rootDomain} already exists, switching to it`)

			// Update the active page
			this.page = existingPage
			existingPage.bringToFront()

			// Navigate to the new URL if it's different]
			const currentUrl = existingPage.url().replace(/\/$/, "") // Remove trailing / if present
			if (this.getRootDomain(currentUrl) === rootDomain && currentUrl !== normalizedNewUrl) {
				console.error(`Navigating to new URL: ${normalizedNewUrl}`)
				console.error(`Current URL: ${currentUrl}`)
				console.error(`Root domain: ${this.getRootDomain(currentUrl)}`)
				console.error(`New URL: ${normalizedNewUrl}`)
				// Navigate to the new URL
				return this.doAction(async (page) => {
					await this.navigatePageToUrl(page, normalizedNewUrl)
				})
			} else {
				console.error(`Tab with domain ${rootDomain} already exists, and URL is the same: ${normalizedNewUrl}`)
				// URL is the same, just reload the page to ensure it's up to date
				console.error(`Reloading page: ${normalizedNewUrl}`)
				console.error(`Current URL: ${currentUrl}`)
				console.error(`Root domain: ${this.getRootDomain(currentUrl)}`)
				console.error(`New URL: ${normalizedNewUrl}`)
				return this.doAction(async (page) => {
					await page.reload({
						timeout: BROWSER_NAVIGATION_TIMEOUT,
						waitUntil: ["domcontentloaded", "networkidle2"],
					})
					await this.waitTillHTMLStable(page)
				})
			}
		} else {
			// No tab with this root domain exists, create a new one
			console.error(`No tab with domain ${rootDomain} exists, creating a new one`)
			return this.createNewTab(normalizedNewUrl)
		}
	}

	// page.goto { waitUntil: "networkidle0" } may not ever resolve, and not waiting could return page content too early before js has loaded
	// https://stackoverflow.com/questions/52497252/puppeteer-wait-until-page-is-completely-loaded/61304202#61304202
	private async waitTillHTMLStable(page: Page, timeout = 5_000) {
		const checkDurationMsecs = 500 // 1000
		const maxChecks = timeout / checkDurationMsecs
		let lastHTMLSize = 0
		let checkCounts = 1
		let countStableSizeIterations = 0
		const minStableSizeIterations = 3

		while (checkCounts++ <= maxChecks) {
			let html = await page.content()
			let currentHTMLSize = html.length

			// let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length)
			console.error("last: ", lastHTMLSize, " <> curr: ", currentHTMLSize)

			if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
				countStableSizeIterations++
			} else {
				countStableSizeIterations = 0 //reset the counter
			}

			if (countStableSizeIterations >= minStableSizeIterations) {
				console.error("Page rendered fully...")
				break
			}

			lastHTMLSize = currentHTMLSize
			await delay(checkDurationMsecs)
		}
	}

	/**
	 * Handles mouse interaction with network activity monitoring
	 */
	private async handleMouseInteraction(
		page: Page,
		coordinate: string,
		action: (x: number, y: number) => Promise<void>,
	): Promise<void> {
		const [x, y] = coordinate.split(",").map(Number)
		
		if (x === undefined || y === undefined || isNaN(x) || isNaN(y)) {
			throw new Error(`Invalid coordinates: ${coordinate}. Expected format: "x,y"`)
		}

		// Set up network request monitoring
		let hasNetworkActivity = false
		const requestListener = () => {
			hasNetworkActivity = true
		}
		page.on("request", requestListener)

		// Perform the mouse action
		await action(x, y)
		this.currentMousePosition = coordinate

		// Small delay to check if action triggered any network activity
		await delay(100)

		if (hasNetworkActivity) {
			// If we detected network activity, wait for navigation/loading
			await page
				.waitForNavigation({
					waitUntil: ["domcontentloaded", "networkidle2"],
					timeout: BROWSER_NAVIGATION_TIMEOUT,
				})
				.catch(() => {})
			await this.waitTillHTMLStable(page)
		}

		// Clean up listener
		page.off("request", requestListener)
	}

	async click(coordinate: string): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			await this.handleMouseInteraction(page, coordinate, async (x, y) => {
				await page.mouse.click(x, y)
			})
		})
	}

	async type(text: string): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			await page.keyboard.type(text)
		})
	}

	/**
	 * Scrolls the page by the specified amount
	 */
	private async scrollPage(page: Page, direction: "up" | "down"): Promise<void> {
		const { height } = this.getViewport()
		const scrollAmount = direction === "down" ? height : -height

		await page.evaluate((scrollHeight) => {
			// @ts-ignore - window is available in browser context
			window.scrollBy({
				top: scrollHeight,
				behavior: "auto",
			})
		}, scrollAmount)

		await delay(300)
	}

	async scrollDown(): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			await this.scrollPage(page, "down")
		})
	}

	async scrollUp(): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			await this.scrollPage(page, "up")
		})
	}

	async hover(coordinate: string): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			await this.handleMouseInteraction(page, coordinate, async (x, y) => {
				await page.mouse.move(x, y)
				// Small delay to allow any hover effects to appear
				await delay(300)
			})
		})
	}

	async resize(size: string): Promise<BrowserActionResult> {
		return this.doAction(async (page) => {
			const [width, height] = size.split(",").map(Number)
			
			if (width === undefined || height === undefined || isNaN(width) || isNaN(height)) {
				throw new Error(`Invalid size: ${size}. Expected format: "width,height"`)
			}
			
			const session = await page.createCDPSession()
			await page.setViewport({ width, height })
			const { windowId } = await session.send("Browser.getWindowForTarget")
			await session.send("Browser.setWindowBounds", {
				bounds: { width, height },
				windowId,
			})
		})
	}
} 
