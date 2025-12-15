const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class ProcessManager {
    constructor() {
        this.activeProcesses = new Map(); // pid -> { pid, accountId, phoneNumber, startTime, duration, process }
        this.settings = {
            minDuration: 3 * 60 * 1000, // 3 min in ms
            maxDuration: 15 * 60 * 1000 // 15 min in ms
        };

        // Start watchdog
        this.watchdogInterval = setInterval(() => this.checkExpirations(), 1000);
    }

    updateSettings(newSettings) {
        if (newSettings.minDuration) this.settings.minDuration = newSettings.minDuration * 60 * 1000;
        if (newSettings.maxDuration) this.settings.maxDuration = newSettings.maxDuration * 60 * 1000;
        console.log('[ProcessManager] Settings updated:', this.settings);
    }

    async launchTelegram(account) {
        // Enforce MAX 10 processes
        const MAX_PROCESSES = 10;

        // Cek if we need to free up space
        if (this.activeProcesses.size >= MAX_PROCESSES) {
            console.log(`[ProcessManager] Limit of ${MAX_PROCESSES} reached. Finding oldest process to kill...`);
            let oldestPid = null;
            let oldestTime = Infinity;

            for (const [pid, proc] of this.activeProcesses) {
                if (proc.startTime < oldestTime) {
                    oldestTime = proc.startTime;
                    oldestPid = pid;
                }
            }

            if (oldestPid) {
                console.log(`[ProcessManager] Killing oldest process PID ${oldestPid} (started at ${new Date(oldestTime).toISOString()}) to make room.`);
                this.killProcess(oldestPid);
                // Small delay to ensure cleanup
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Check if already running for this account
        for (const [pid, proc] of this.activeProcesses) {
            if (proc.accountId === account.id) {
                console.log(`[ProcessManager] Telegram already open for account ${account.phone_number} (PID: ${pid})`);
                return true; // Already running is considered success
            }
        }

        const exePath = account.exe_path || path.join(account.folder_path, 'Telegram.exe');

        if (!fs.existsSync(exePath)) {
            throw new Error(`Telegram.exe not found at ${exePath}`);
        }

        console.log(`[ProcessManager] Launching Telegram for ${account.phone_number}...`);

        try {
            // Spawn process
            // detached: true allows it to run independently, but we want to track it.
            // However, Telegram often launches a second process and kills the first (updater).
            // Tracking PID of Telegram is tricky. 
            // We will trust the spawned child PID for now, or monitor process list.

            const child = spawn(exePath, [], {
                cwd: path.dirname(exePath),
                detached: true,
                stdio: 'ignore'
            });

            if (!child.pid) {
                throw new Error('Failed to spawn process');
            }

            child.unref(); // Don't block parent

            const duration = Math.floor(Math.random() * (this.settings.maxDuration - this.settings.minDuration + 1) + this.settings.minDuration);

            const processInfo = {
                pid: child.pid,
                accountId: account.id,
                accountName: account.session_name,
                phoneNumber: account.phone_number,
                startTime: Date.now(),
                duration: duration,
                process: child
            };

            this.activeProcesses.set(child.pid, processInfo);

            console.log(`[ProcessManager] Started PID ${child.pid} for ${duration / 1000}s`);

            // Handle exit/close if it closes early
            child.on('exit', () => {
                if (this.activeProcesses.has(child.pid)) {
                    this.activeProcesses.delete(child.pid);
                    console.log(`[ProcessManager] PID ${child.pid} exited explicitly.`);
                }
            });

            return { success: true, pid: child.pid }; // Return object with PID for event emission
        } catch (err) {
            console.error('[ProcessManager] Launch error:', err);
            throw err;
        }
    }

    checkExpirations() {
        const now = Date.now();
        for (const [pid, proc] of this.activeProcesses) {
            if (now - proc.startTime > proc.duration) {
                console.log(`[ProcessManager] Time expired for PID ${pid}. Killing...`);
                this.killProcess(pid);
            }
        }
    }

    killProcess(pid) {
        if (!this.activeProcesses.has(pid)) return;

        try {
            process.kill(pid);
            // Also try taskkill for force
            exec(`taskkill /PID ${pid} /F`);
        } catch (e) {
            console.error(`[ProcessManager] Error killing ${pid}:`, e.message);
        }

        this.activeProcesses.delete(pid);
    }

    killAll() {
        const pids = Array.from(this.activeProcesses.keys());
        console.log(`[ProcessManager] Killing all ${pids.length} processes...`);
        pids.forEach(pid => this.killProcess(pid));
    }

    getActiveProcesses() {
        const now = Date.now();
        return Array.from(this.activeProcesses.values()).map(p => {
            const passed = now - p.startTime;
            const remaining = Math.max(0, p.duration - passed);

            // Format format MM:SS
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

            return {
                pid: p.pid,
                accountId: p.accountId,
                accountName: p.accountName,
                phoneNumber: p.phoneNumber,
                remainingMs: remaining,
                remainingTime: timeStr
            };
        });
    }

    getCount() {
        return this.activeProcesses.size;
    }
}

module.exports = new ProcessManager();
