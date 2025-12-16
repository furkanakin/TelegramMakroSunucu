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

        // Start rotation service for online status
        this.rotationInterval = setInterval(() => this.rotateWindows(), 5000);
        this.currentRotationIndex = 0;
    }

    // ... (rest of methods)

    // Cycle through all active Telegram windows to keep them 'Online'
    async rotateWindows() {
        try {
            // Get all running Telegram PIDs dynamically from OS
            // We verify against OS because our internal map might be stale due to updater restarts
            exec('powershell -command "Get-Process Telegram -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"', (err, stdout) => {
                if (err || !stdout) return;

                const pids = stdout.trim().split(/\s+/).map(p => parseInt(p)).filter(n => !isNaN(n));

                if (pids.length === 0) return;

                // Circular rotation
                this.currentRotationIndex = (this.currentRotationIndex + 1) % pids.length;
                const targetPid = pids[this.currentRotationIndex];

                // Bring to front using WScript.Shell AppActivate
                // This is lightweight and works for focusing windows
                const focusCmd = `powershell -command "(New-Object -ComObject WScript.Shell).AppActivate(${targetPid})"`;
                exec(focusCmd, (e) => {
                    if (!e) {
                        // console.log(`[ProcessManager] Rotated focus to PID ${targetPid}`);
                    }
                });
            });
        } catch (e) {
            console.error('[ProcessManager] Rotation error:', e.message);
        }
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

        // Check if already running for this account (check by PHONE NUMBER as IDs may vary)
        for (const [pid, proc] of this.activeProcesses) {
            if (proc.phoneNumber === account.phone_number) {
                // Update ID if needed
                proc.accountId = account.id;
                console.log(`[ProcessManager] Telegram already open for account ${account.phone_number} (PID: ${pid})`);

                // Return existing PID object so main.js can emit started event correctly
                return { success: true, pid: pid };
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
                exePath: exePath, // Store path for reliable killing
                startTime: Date.now(),
                duration: duration,
                process: child
            };

            this.activeProcesses.set(child.pid, processInfo);

            console.log(`[ProcessManager] Started PID ${child.pid} for ${duration / 1000}s`);

            // Handle exit/close if it closes early
            // Telegram updater often exits after launching main process.
            // If we remove it from map immediately, we lose track of the 'slot' and concurrency limit fails.
            // We will trust the time-based duration or explicit kill instead.
            child.on('exit', (code) => {
                console.log(`[ProcessManager] PID ${child.pid} exited with code ${code}.`);
                // Do NOT simple delete from map here, because Telegram might have just restarted itself.
                // We will let the duration expire or FIFO kill handle the 'slot' removal.
                // Ideally we should find the new PID, but for slot-counting purpose, this phantom entry is enough.
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

        const proc = this.activeProcesses.get(pid);
        const { exePath } = proc;

        try {
            console.log(`[ProcessManager] Killing process PID ${pid} (Path: ${exePath})`);

            // Try standard kill first
            try { process.kill(pid); } catch (e) { }

            // Critical: Also kill by EXE PATH using WMIC to catch restarted/updater processes
            // wmic process where "ExecutablePath='C:\\...\\Telegram.exe'" call terminate
            if (exePath) {
                // Escape backslashes for WQL
                const escapedPath = exePath.replace(/\\/g, '\\\\');
                const cmd = `wmic process where "ExecutablePath='${escapedPath}'" call terminate`;
                exec(cmd, (error, stdout, stderr) => {
                    if (error) console.log(`[ProcessManager] WMIC kill result: ${error.message}`);
                });
            } else {
                exec(`taskkill /PID ${pid} /F`);
            }

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
