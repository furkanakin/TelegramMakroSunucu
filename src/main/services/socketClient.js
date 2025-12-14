const io = require('socket.io-client');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');

const store = new Store();

class SocketClient {
    constructor() {
        this.socket = null;
        this.managerUrl = store.get('managerUrl', 'http://localhost:3000');
        this.serverId = store.get('serverId');

        if (!this.serverId) {
            this.serverId = uuidv4();
            store.set('serverId', this.serverId);
        }

        this.serverName = os.hostname();
        this.isConnected = false;
        this.heartbeatInterval = null;
    }

    connect(url) {
        if (url) {
            this.managerUrl = url;
            store.set('managerUrl', url);
        }

        if (this.socket) {
            this.socket.close();
        }

        console.log(`[SocketClient] Connecting to ${this.managerUrl}...`);

        this.socket = io(this.managerUrl, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
        });

        this.socket.on('connect', () => {
            console.log('[SocketClient] Connected to Manager');
            this.isConnected = true;
            this.register();
            this.startHeartbeat();
        });

        this.socket.on('disconnect', () => {
            console.log('[SocketClient] Disconnected from Manager');
            this.isConnected = false;
            this.stopHeartbeat();
        });

        this.socket.on('connect_error', (error) => {
            // console.error('[SocketClient] Connection error:', error.message);
        });
    }

    register() {
        if (!this.socket || !this.isConnected) return;

        const networkInterfaces = os.networkInterfaces();
        let ipAddress = '127.0.0.1';

        // Find the first non-internal IPv4 address
        for (const interfaceName in networkInterfaces) {
            const interfaces = networkInterfaces[interfaceName];
            for (const iface of interfaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ipAddress = iface.address;
                    break;
                }
            }
            if (ipAddress !== '127.0.0.1') break;
        }

        const info = {
            id: this.serverId,
            name: this.serverName,
            ip: ipAddress,
            platform: os.platform(),
            release: os.release(),
            totalMem: os.totalmem(),
            type: 'macro-node'
        };

        this.socket.emit('macro:register', info);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 5000); // Send heartbeat every 5 seconds
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    sendHeartbeat() {
        if (!this.socket || !this.isConnected) return;

        const cpus = os.cpus();
        const freeMem = os.freemem();
        const totalMem = os.totalmem();

        // Simple CPU usage calculation (not perfect but gives an idea)
        // ideally we would compare snapshots, but for heartbeat this is "good enough" for now or just static info

        const stats = {
            cpuUser: cpus[0].times.user,
            ram: Math.round(((totalMem - freeMem) / totalMem) * 100),
            cpu: 0, // Placeholder, calculating real CPU usage in node is multiline logic
            uptime: os.uptime()
        };

        this.socket.emit('macro:heartbeat', stats);
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.stopHeartbeat();
    }
}

module.exports = new SocketClient();
