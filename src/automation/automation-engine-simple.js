/**
 * Basitleştirilmiş Otomasyon Motoru
 * Native modül sorunları yaşanırsa bu kullanılabilir
 * PowerShell ve Windows komutları kullanır
 */

const { exec, spawn } = require('child_process');
const path = require('path');

class AutomationEngineSimple {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.abortController = null;
    }

    // PowerShell komutu çalıştır
    runPowerShell(script) {
        return new Promise((resolve, reject) => {
            const ps = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', script
            ], { windowsHide: true });

            let output = '';
            let error = '';

            ps.stdout.on('data', (data) => { output += data.toString(); });
            ps.stderr.on('data', (data) => { error += data.toString(); });

            ps.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    reject(new Error(error || `PowerShell exited with code ${code}`));
                }
            });
        });
    }

    // ============ MOUSE İŞLEMLERİ ============

    async moveMouse(x, y) {
        const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
}
"@
[Mouse]::SetCursorPos(${x}, ${y})
`;
        await this.runPowerShell(script);
    }

    async getMousePosition() {
        const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT pt);
}
"@
$pt = New-Object Mouse+POINT
[Mouse]::GetCursorPos([ref]$pt)
Write-Output "$($pt.X),$($pt.Y)"
`;
        const result = await this.runPowerShell(script);
        const [x, y] = result.split(',').map(Number);
        return { x, y };
    }

    async click(x, y, button = 'left') {
        if (x !== undefined && y !== undefined) {
            await this.moveMouse(x, y);
            await this.sleep(50);
        }

        const downFlag = button === 'right' ? '0x0008' : '0x0002';
        const upFlag = button === 'right' ? '0x0010' : '0x0004';

        const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
[Mouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[Mouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
`;
        await this.runPowerShell(script);
    }

    async doubleClick(x, y) {
        await this.click(x, y);
        await this.sleep(100);
        await this.click(x, y);
    }

    async rightClick(x, y) {
        await this.click(x, y, 'right');
    }

    async scroll(amount) {
        const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
[Mouse]::mouse_event(0x0800, 0, 0, ${amount * 120}, 0)
`;
        await this.runPowerShell(script);
    }

    // ============ KLAVYE İŞLEMLERİ ============

    async pressKey(key) {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('{${this.convertKey(key)}}')
`;
        await this.runPowerShell(script);
    }

    async keyCombo(...keys) {
        // SendKeys formatına çevir
        let combo = '';
        for (const key of keys) {
            const upper = key.toUpperCase();
            if (upper === 'CTRL') combo += '^';
            else if (upper === 'ALT') combo += '%';
            else if (upper === 'SHIFT') combo += '+';
            else combo += key.toLowerCase();
        }

        const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${combo}')
`;
        await this.runPowerShell(script);
    }

    async typeText(text) {
        // Clipboard kullan
        const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${text.replace(/'/g, "''")}')
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait('^v')
`;
        await this.runPowerShell(script);
    }

    async typeTextSlow(text, delay = 50) {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
$text = '${text.replace(/'/g, "''")}'
foreach ($char in $text.ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait($char.ToString())
    Start-Sleep -Milliseconds ${delay}
}
`;
        await this.runPowerShell(script);
    }

    convertKey(key) {
        const keyMap = {
            'ENTER': 'ENTER',
            'TAB': 'TAB',
            'ESCAPE': 'ESC',
            'BACKSPACE': 'BACKSPACE',
            'DELETE': 'DELETE',
            'INSERT': 'INSERT',
            'HOME': 'HOME',
            'END': 'END',
            'PAGE_UP': 'PGUP',
            'PAGE_DOWN': 'PGDN',
            'UP': 'UP',
            'DOWN': 'DOWN',
            'LEFT': 'LEFT',
            'RIGHT': 'RIGHT',
            'SPACE': ' ',
            'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
            'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
            'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12'
        };
        return keyMap[key.toUpperCase()] || key;
    }

    // ============ PENCERE İŞLEMLERİ ============

    async launchProgram(exePath, args = []) {
        return new Promise((resolve, reject) => {
            const process = spawn(exePath, args, {
                detached: true,
                stdio: 'ignore',
                cwd: path.dirname(exePath)
            });

            process.unref();

            setTimeout(() => {
                resolve(process.pid);
            }, 2000);
        });
    }

    async killProcess(pid) {
        return new Promise((resolve) => {
            exec(`taskkill /PID ${pid} /F`, { windowsHide: true }, (error) => {
                resolve(!error);
            });
        });
    }

    async killProcessByName(name) {
        return new Promise((resolve) => {
            exec(`taskkill /IM "${name}" /F /T`, { windowsHide: true }, (error, stdout, stderr) => {
                console.log(`[KillProcess] ${name} - stdout: ${stdout}, stderr: ${stderr}`);
                resolve(true);
            });
        });
    }

    // Tum Telegram.exe'leri kapat
    async killAllTelegram() {
        console.log('[KillAllTelegram] Tum Telegram processleri kapatiliyor...');

        await new Promise((resolve) => {
            exec('taskkill /IM "Telegram.exe" /F /T', { windowsHide: true }, () => resolve());
        });

        await this.sleep(500);

        await new Promise((resolve) => {
            exec('powershell -Command "Get-Process | Where-Object {$_.ProcessName -like \'*Telegram*\'} | Stop-Process -Force -ErrorAction SilentlyContinue"',
                { windowsHide: true },
                () => resolve()
            );
        });

        console.log('[KillAllTelegram] Tamamlandi');
        return true;
    }

    async maximizeActiveWindow() {
        const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Window {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$hwnd = [Window]::GetForegroundWindow()
[Window]::ShowWindow($hwnd, 3)
`;
        await this.runPowerShell(script);
    }

    async getScreenSize() {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "$($screen.Width),$($screen.Height)"
`;
        const result = await this.runPowerShell(script);
        const [width, height] = result.split(',').map(Number);
        return { width, height };
    }

    // ============ YARDIMCI FONKSİYONLAR ============

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    randomSleep(minMs, maxMs) {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return this.sleep(delay);
    }

    // ============ WORKFLOW ÇALIŞTIRICI ============

    async executeWorkflow(nodes, edges, context = {}) {
        if (this.isRunning) {
            throw new Error('Otomasyon zaten çalışıyor');
        }

        this.isRunning = true;
        this.isPaused = false;
        this.abortController = { aborted: false };

        try {
            const sortedNodes = this.sortNodesByEdges(nodes, edges);

            for (const node of sortedNodes) {
                if (this.abortController.aborted) {
                    throw new Error('Otomasyon iptal edildi');
                }

                while (this.isPaused) {
                    await this.sleep(100);
                    if (this.abortController.aborted) {
                        throw new Error('Otomasyon iptal edildi');
                    }
                }

                await this.executeNode(node, context);
            }

            return { success: true, context };
        } catch (error) {
            return { success: false, error: error.message, context };
        } finally {
            this.isRunning = false;
        }
    }

    sortNodesByEdges(nodes, edges) {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const inDegree = new Map(nodes.map(n => [n.id, 0]));
        const adjacency = new Map(nodes.map(n => [n.id, []]));

        for (const edge of edges) {
            adjacency.get(edge.source)?.push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }

        const queue = [];
        for (const [nodeId, degree] of inDegree) {
            if (degree === 0) {
                queue.push(nodeId);
            }
        }

        const sorted = [];
        while (queue.length > 0) {
            const nodeId = queue.shift();
            const node = nodeMap.get(nodeId);
            if (node) {
                sorted.push(node);
            }

            for (const neighbor of (adjacency.get(nodeId) || [])) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            }
        }

        return sorted;
    }

    async executeNode(node, context) {
        const { type, data } = node;

        switch (type) {
            case 'delay':
                await this.sleep(data.duration * 1000);
                break;

            case 'randomDelay':
                await this.randomSleep(data.minDuration * 1000, data.maxDuration * 1000);
                break;

            case 'mouseClick':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.click(data.x, data.y, data.button || 'left');
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'mouseDoubleClick':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.doubleClick(data.x, data.y);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'mouseMove':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.moveMouse(data.x, data.y);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'mouseScroll':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.scroll(data.amount);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'keyPress':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.pressKey(data.key);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'keyCombo':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.keyCombo(...data.keys);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'typeText':
                await this.sleep(data.delayBefore * 1000 || 0);
                if (data.slow) {
                    await this.typeTextSlow(data.text, data.charDelay || 50);
                } else {
                    await this.typeText(data.text);
                }
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'pasteChannelLinks':
                await this.sleep(data.delayBefore * 1000 || 0);
                const links = context.channelLinks || [];
                const linkText = links.join('\n');
                await this.typeText(linkText);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'launchProgram':
                await this.sleep(data.delayBefore * 1000 || 0);
                const exePath = data.useDynamic ? context.currentExePath : data.exePath;
                const pid = await this.launchProgram(exePath);
                context.currentPid = pid;
                await this.sleep(data.waitAfterLaunch * 1000 || 2000);
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'closeProgram':
                await this.sleep(data.delayBefore * 1000 || 0);
                const processName = data.processName || 'Telegram.exe';
                // Telegram ise ozel kapatma kullan
                if (processName.toLowerCase().includes('telegram')) {
                    console.log('[CloseProgram] Telegram tespit edildi, killAllTelegram kullaniliyor');
                    await this.killAllTelegram();
                } else if (data.usePid && context.currentPid) {
                    console.log('[CloseProgram] PID ile kapatiliyor:', context.currentPid);
                    await this.killProcess(context.currentPid);
                } else {
                    console.log('[CloseProgram] Process adi ile kapatiliyor:', processName);
                    await this.killProcessByName(processName);
                }
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            case 'maximizeWindow':
                await this.sleep(data.delayBefore * 1000 || 0);
                await this.maximizeActiveWindow();
                await this.sleep(data.delayAfter * 1000 || 0);
                break;

            default:
                console.warn(`Bilinmeyen node tipi: ${type}`);
        }
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    abort() {
        if (this.abortController) {
            this.abortController.aborted = true;
        }
        this.isRunning = false;
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused
        };
    }
}

module.exports = AutomationEngineSimple;
