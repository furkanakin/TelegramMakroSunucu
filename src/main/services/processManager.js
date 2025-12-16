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
        this.rotationInterval = setInterval(() => this.rotateWindows(), 3000);
        this.lastFocusedPid = null;

        // Start expiration check service
        this.expirationInterval = setInterval(() => this.checkExpirations(), 5000);
    }

    // ... (rest of methods)



    updateSettings(newSettings) {
        if (newSettings.minDuration) this.settings.minDuration = newSettings.minDuration * 60 * 1000;
        if (newSettings.maxDuration) this.settings.maxDuration = newSettings.maxDuration * 60 * 1000;
        console.log('[ProcessManager] Settings updated:', this.settings);
    }

    async verifyProcessRunning(exePath) {
        if (!exePath) return false;
        const safePath = exePath.replace(/'/g, "''");
        const psCommand = `powershell -command "Get-WmiObject Win32_Process | Where-Object { $_.ExecutablePath -eq '${safePath}' } | Measure-Object | Select-Object -ExpandProperty Count"`;

        return new Promise((resolve) => {
            exec(psCommand, (err, stdout) => {
                if (err || !stdout) {
                    resolve(false);
                    return;
                }
                const count = parseInt(stdout.trim());
                resolve(count > 0);
            });
        });
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
                // Verify if it is ACTUALLY running
                const isRunning = await this.verifyProcessRunning(proc.exePath);

                if (isRunning) {
                    // Update ID if needed
                    proc.accountId = account.id;
                    console.log(`[ProcessManager] Telegram already open for account ${account.phone_number} (PID: ${pid})`);

                    // Return existing PID object so main.js can emit started event correctly
                    return { success: true, pid: pid };
                } else {
                    console.log(`[ProcessManager] Stale process detected for ${account.phone_number} (PID: ${pid}). Removing and relaunching...`);
                    this.activeProcesses.delete(pid);
                }
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

    // Cycle through all active Telegram windows to keep them 'Online'
    async rotateWindows() {
        try {
            // Get all running Telegram PIDs dynamically from OS
            // Use Sort-Object to ensure consistent rotation order
            exec('powershell -command "Get-Process Telegram -ErrorAction SilentlyContinue | Sort-Object Id | Select-Object -ExpandProperty Id"', (err, stdout) => {
                if (err || !stdout) return;

                const pids = stdout.trim().split(/\s+/).map(p => parseInt(p)).filter(n => !isNaN(n));

                if (pids.length === 0) return;

                // Robust rotation: Find index of last focused, go to next
                let nextIndex = 0;
                if (this.lastFocusedPid) {
                    const lastIndex = pids.indexOf(this.lastFocusedPid);
                    if (lastIndex !== -1) {
                        nextIndex = (lastIndex + 1) % pids.length;
                    }
                }

                const targetPid = pids[nextIndex];
                this.lastFocusedPid = targetPid;

                // Force State Change: Minimize (6) -> Sleep -> Maximize (3) -> SwitchToThisWindow
                // Plus Click at (41, 53) to ensure online status interaction
                const focusCmd = `powershell -command "$code = '[DllImport(\\"user32.dll\\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\\"user32.dll\\")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab); [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);'; $type = Add-Type -MemberDefinition $code -Name Win32WindowOps -Namespace Win32Functions -PassThru; $p = Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue; if ($p) { $type::ShowWindowAsync($p.MainWindowHandle, 6); Start-Sleep -Milliseconds 250; $type::ShowWindowAsync($p.MainWindowHandle, 3); $type::SwitchToThisWindow($p.MainWindowHandle, $true); Start-Sleep -Milliseconds 150; $type::SetCursorPos(41, 53); $type::mouse_event(0x02, 0, 0, 0, 0); $type::mouse_event(0x04, 0, 0, 0, 0); }"`;
                exec(focusCmd);
            });
        } catch (e) {
            console.error('[ProcessManager] Rotation error:', e.message);
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

            // Critical: Kill by Exact EXE PATH using PowerShell
            // This handles the case where Telegram updated/restarted and changed PID.
            if (exePath) {
                // Use PowerShell to find process by path and kill it
                // We escape ' as '' for PowerShell string
                const safePath = exePath.replace(/'/g, "''");
                const psCommand = `powershell -command "Get-WmiObject Win32_Process | Where-Object { $_.ExecutablePath -eq '${safePath}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;

                exec(psCommand, (error, stdout, stderr) => {
                    if (error) console.log(`[ProcessManager] PowerShell Kill Error: ${error.message}`);
                    else console.log(`[ProcessManager] Killed process at ${exePath}`);
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
