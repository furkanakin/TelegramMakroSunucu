const io = require('socket.io-client');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

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
        this.handlers = {};
    }

    setHandlers(handlers) {
        this.handlers = handlers;
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

        // --- Command Listeners ---

        this.socket.on('macro:add_channel', async (channelLink) => {
            console.log('[SocketClient] Received channel:', channelLink);
            if (this.handlers.onAddChannel) {
                try {
                    await this.handlers.onAddChannel(channelLink);
                    this.sendLog(`Kanal eklendi: ${channelLink}`, 'success');
                } catch (err) {
                    this.sendLog(`Kanal ekleme hatası: ${err.message}`, 'error');
                }
            }
        });

        this.socket.on('macro:command', async (command) => {
            console.log('[SocketClient] Received command:', command);

            // Handle sync_sessions internally:
            if (command.type === 'sync_sessions') {
                console.log('[SocketClient] Executing internal sync_sessions command');
                if (this.handlers.onGetSessions) {
                    try {
                        const sessions = await this.handlers.onGetSessions();
                        this.socket.emit('macro:update_sessions', sessions);
                        this.sendLog(`Hesap listesi senkronize edildi (${sessions.length} adet).`, 'success');
                    } catch (err) {
                        this.sendLog(`Senkronizasyon hatası: ${err.message}`, 'error');
                    }
                } else {
                    this.sendLog('Senkronizasyon hatası: onGetSessions handler tanımlı değil.', 'error');
                }
                return; // Use 'return' to skip the default onCommand
            }

            if (this.handlers.onCommand) {
                try {
                    await this.handlers.onCommand(command);
                    this.sendLog(`Komut işlendi: ${command.type}`, 'info');
                } catch (err) {
                    this.sendLog(`Komut hatası: ${err.message}`, 'error');
                }
            }
        });

        this.socket.on('macro:get_details', async () => {
            if (this.handlers.onGetDetails) {
                try {
                    const details = await this.handlers.onGetDetails();
                    this.socket.emit('macro:node_details', {
                        serverId: this.serverId,
                        details
                    });
                } catch (err) {
                    this.sendLog(`Detay alma hatası: ${err.message}`, 'error');
                }
            }
        });

        this.socket.on('macro:get_screenshot', async () => {
            if (this.handlers.onGetScreenshot) {
                try {
                    const image = await this.handlers.onGetScreenshot();
                    if (image) {
                        this.socket.emit('macro:screenshot', {
                            serverId: this.serverId,
                            image
                        });
                    }
                } catch (err) {
                    this.sendLog(`Ekran görüntüsü hatası: ${err.message}`, 'error');
                }
            }
        });

        this.socket.on('macro:global_settings', (settings) => {
            console.log('[SocketClient] Received settings update', settings);
            if (this.handlers.onSettingsUpdate) {
                this.handlers.onSettingsUpdate(settings);
            }
        });

        // Live Stream & Remote Control
        this.socket.on('macro:start_stream', () => {
            if (this.handlers.onStartStream) this.handlers.onStartStream();
        });

        this.socket.on('macro:stop_stream', () => {
            if (this.handlers.onStopStream) this.handlers.onStopStream();
        });

        this.socket.on('macro:remote_input', (data) => {
            if (this.handlers.onRemoteInput) this.handlers.onRemoteInput(data);
        });

        // ------------------------

        this.socket.on('connect_error', (error) => {
            // console.error('[SocketClient] Connection error:', error.message);
        });
    }

    sendLog(message, type = 'info') {
        if (this.socket && this.isConnected) {
            this.socket.emit('macro:log', {
                serverId: this.serverId,
                message,
                type,
                timestamp: new Date()
            });
        }
    }

    sendStreamFrame(image) {
        if (this.socket && this.isConnected) {
            this.socket.emit('macro:stream_frame', {
                serverId: this.serverId,
                image
            });
        }
    }

    async getDiskInfo() {
        try {
            const { stdout } = await execAsync('powershell "Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID=\'C:\'\\" | Select-Object Size, FreeSpace | ConvertTo-Json"');
            const data = JSON.parse(stdout);
            const total = parseInt(data.Size);
            const free = parseInt(data.FreeSpace);
            return {
                total: Math.round(total / (1024 * 1024 * 1024)),
                free: Math.round(free / (1024 * 1024 * 1024)),
                used: Math.round((total - free) / (1024 * 1024 * 1024)),
                percent: Math.round(((total - free) / total) * 100)
            };
        } catch (e) {
            // Fallback for other platforms or errors
            return null;
        }
    }

    async register() {
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

        let availableSessions = [];
        if (this.handlers.onGetSessions) {
            try {
                availableSessions = await this.handlers.onGetSessions();
            } catch (e) {
                console.error('[SocketClient] Failed to get sessions', e);
            }
        }

        const info = {
            id: this.serverId,
            name: this.serverName,
            ip: ipAddress,
            platform: os.platform(),
            release: os.release(),
            totalMem: os.totalmem(),
            type: 'macro-node',
            availableSessions // Array of session names
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

    async sendHeartbeat() {
        if (!this.socket || !this.isConnected) return;

        const cpus = os.cpus();
        const freeMem = os.freemem();
        const totalMem = os.totalmem();

        let extraStats = {};
        if (this.handlers.onGetStats) {
            extraStats = await this.handlers.onGetStats();
        }

        const stats = {
            cpuUser: cpus[0].times.user,
            ram: Math.round(((totalMem - freeMem) / totalMem) * 100),
            cpu: 0,
            uptime: os.uptime(),
            disk: await this.getDiskInfo(),
            ...extraStats
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

    isConnected() {
        return this.isConnected;
    }
}

module.exports = new SocketClient();
