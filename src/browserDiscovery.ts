import * as net from "node:net"
import axios from "axios"
import * as dns from "node:dns"

/**
 * Check if a port is open on a given host
 */
export async function isPortOpen(host: string, port: number, timeout = 1000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket()
		let status = false

		// Set timeout
		socket.setTimeout(timeout)

		// Handle successful connection
		socket.on("connect", () => {
			status = true
			socket.destroy()
		})

		// Handle any errors
		socket.on("error", () => {
			socket.destroy()
		})

		// Handle timeout
		socket.on("timeout", () => {
			socket.destroy()
		})

		// Handle close
		socket.on("close", () => {
			resolve(status)
		})

		// Attempt to connect
		socket.connect(port, host)
	})
}

/**
 * Try to connect to Chrome at a specific IP address
 */
export async function tryChromeHostUrl(chromeHostUrl: string): Promise<boolean> {
	try {
		console.error(`Trying to connect to Chrome at: ${chromeHostUrl}/json/version`)
		await axios.get(`${chromeHostUrl}/json/version`, { timeout: 1000 })
		return true
	} catch (error) {
		return false
	}
}

/**
 * Get Docker host IP using multiple methods
 */
export async function getDockerHostIP(): Promise<string | null> {
	const methods = [
		// Method 1: host.docker.internal (Docker Desktop)
		async () => {
			return new Promise<string | null>((resolve) => {
				dns.lookup("host.docker.internal", (err: any, address: string) => {
					if (err) {
						resolve(null)
					} else {
						resolve(address)
					}
				})
			})
		},
		// Method 2: gateway.docker.internal (Docker Desktop)
		async () => {
			return new Promise<string | null>((resolve) => {
				dns.lookup("gateway.docker.internal", (err: any, address: string) => {
					if (err) {
						resolve(null)
					} else {
						resolve(address)
					}
				})
			})
		},
		// Method 3: Check if we're in a container and get host IP
		async () => {
			try {
				// Read Docker host IP from /etc/hosts
				const fs = await import("node:fs/promises")
				const hostsContent = await fs.readFile("/etc/hosts", "utf-8")
				const lines = hostsContent.split("\n")
				
				for (const line of lines) {
					if (line.includes("host.docker.internal")) {
						const parts = line.trim().split(/\s+/)
						if (parts[0] && parts[0].match(/^\d+\.\d+\.\d+\.\d+$/)) {
							return parts[0]
						}
					}
				}
			} catch (error) {
				// Ignore errors, try next method
			}
			return null
		},
		// Method 4: Common Docker host IPs
		async () => {
			const commonHostIPs = [
				"172.17.0.1", // Docker default bridge
				"172.18.0.1", // Docker custom bridge
				"192.168.65.1", // Docker Desktop for Mac
				"192.168.1.1", // Common router
				"10.0.0.1", // Common router
			]
			
			for (const ip of commonHostIPs) {
				if (await isPortOpen(ip, 9222, 500)) {
					return ip
				}
			}
			return null
		}
	]

	// Try each method
	for (const method of methods) {
		try {
			const result = await method()
			if (result) {
				console.error("Found Docker host IP:", result)
				return result
			}
		} catch (error) {
			// Continue to next method
		}
	}

	return null
}

/**
 * Get all network interfaces for scanning
 */
export async function getNetworkInterfaces(): Promise<string[]> {
	const interfaces: string[] = []
	
	try {
		const os = await import("node:os")
		const networkInterfaces = os.networkInterfaces()
		
		for (const [name, nets] of Object.entries(networkInterfaces)) {
			if (nets) {
				for (const net of nets) {
					if (net.family === "IPv4" && !net.internal) {
						interfaces.push(net.address)
					}
				}
			}
		}
	} catch (error) {
		console.error("Could not get network interfaces:", error)
	}
	
	return interfaces
}

/**
 * Scan a network range for Chrome debugging port
 */
export async function scanNetworkForChrome(baseIP: string, port: number): Promise<string | null> {
	if (!baseIP || !baseIP.match(/^\d+\.\d+\.\d+\./)) {
		return null
	}

	// Extract the network prefix (e.g., "192.168.65.")
	const networkPrefix = baseIP.split(".").slice(0, 3).join(".") + "."

	// Common Docker host IPs to try first
	const priorityIPs = [
		networkPrefix + "1", // Common gateway
		networkPrefix + "2", // Common host
		networkPrefix + "254", // Common host in some Docker setups
	]

	console.error(`Scanning priority IPs in network ${networkPrefix}*`)

	// Check priority IPs first
	for (const ip of priorityIPs) {
		const isOpen = await isPortOpen(ip, port)
		if (isOpen) {
			console.error(`Found Chrome debugging port open on ${ip}`)
			return ip
		}
	}

	return null
}

// Function to discover Chrome instances on the network
const discoverChromeHosts = async (port: number): Promise<string | null> => {
	// Get all network interfaces
	const ipAddresses = []

	// Try to get Docker host IP
	const hostIP = await getDockerHostIP()
	if (hostIP) {
		console.error("Found Docker host IP:", hostIP)
		ipAddresses.push(hostIP)
	}

	// Get all network interfaces
	const networkInterfaces = await getNetworkInterfaces()
	ipAddresses.push(...networkInterfaces)

	// Remove duplicates
	const uniqueIPs = [...new Set(ipAddresses)]
	console.error("IP Addresses to try:", uniqueIPs)

	// Try connecting to each IP address
	for (const ip of uniqueIPs) {
		const hostEndpoint = `http://${ip}:${port}`

		const hostIsValid = await tryChromeHostUrl(hostEndpoint)
		if (hostIsValid) {
			// Store the successful IP for future use
			console.error(`✅ Found Chrome at ${hostEndpoint}`)

			// Return the host URL and endpoint
			return hostEndpoint
		}
	}

	return null
}

/**
 * Test connection to a remote browser debugging websocket.
 * First tries specific hosts, then attempts auto-discovery if needed.
 * @param browserHostUrl Optional specific host URL to check first
 * @param port Browser debugging port (default: 9222)
 * @returns WebSocket debugger URL if connection is successful, null otherwise
 */
export async function discoverChromeHostUrl(port: number = 9222): Promise<string | null> {
	// First try specific hosts
	const hostsToTry = [
		`http://localhost:${port}`, 
		`http://127.0.0.1:${port}`,
		`http://host.docker.internal:${port}`,
		`http://gateway.docker.internal:${port}`
	]

	// Try each host directly first
	for (const hostUrl of hostsToTry) {
		console.error(`Trying to connect to: ${hostUrl}`)
		try {
			const hostIsValid = await tryChromeHostUrl(hostUrl)
			if (hostIsValid) return hostUrl
		} catch (error) {
			console.error(`Failed to connect to ${hostUrl}: ${error instanceof Error ? error.message : error}`)
		}
	}

	// If direct connections failed, attempt auto-discovery
	console.error("Direct connections failed. Attempting auto-discovery...")

	const discoveredHostUrl = await discoverChromeHosts(port)
	if (discoveredHostUrl) {
		console.error(`Trying to connect to discovered host: ${discoveredHostUrl}`)
		try {
			const hostIsValid = await tryChromeHostUrl(discoveredHostUrl)
			if (hostIsValid) return discoveredHostUrl
			console.error(`Failed to connect to discovered host ${discoveredHostUrl}`)
		} catch (error) {
			console.error(`Error connecting to discovered host: ${error instanceof Error ? error.message : error}`)
		}
	} else {
		console.error("No browser instances discovered on network")
	}

	return null
} 
