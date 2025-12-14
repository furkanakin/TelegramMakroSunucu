/**
 * Otomasyon Motoru - PowerShell tabanlı
 * Windows API işlemlerini PowerShell üzerinden gerçekleştirir
 */

const { exec, spawn } = require('child_process');
const path = require('path');

// Virtual Key Codes
const VK_CODES = {
    'BACKSPACE': 0x08,
    'TAB': 0x09,
    'ENTER': 0x0D,
    'SHIFT': 0x10,
    'CTRL': 0x11,
    'ALT': 0x12,
    'PAUSE': 0x13,
    'CAPS_LOCK': 0x14,
    'ESCAPE': 0x1B,
    'SPACE': 0x20,
    'PAGE_UP': 0x21,
    'PAGE_DOWN': 0x22,
    'END': 0x23,
    'HOME': 0x24,
    'LEFT': 0x25,
    'UP': 0x26,
    'RIGHT': 0x27,
    'DOWN': 0x28,
    'INSERT': 0x2D,
    'DELETE': 0x2E,
    '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
    '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
    'A': 0x41, 'B': 0x42, 'C': 0x43, 'D': 0x44, 'E': 0x45,
    'F': 0x46, 'G': 0x47, 'H': 0x48, 'I': 0x49, 'J': 0x4A,
    'K': 0x4B, 'L': 0x4C, 'M': 0x4D, 'N': 0x4E, 'O': 0x4F,
    'P': 0x50, 'Q': 0x51, 'R': 0x52, 'S': 0x53, 'T': 0x54,
    'U': 0x55, 'V': 0x56, 'W': 0x57, 'X': 0x58, 'Y': 0x59,
    'Z': 0x5A,
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
    'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
    'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
};

class AutomationEngine {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.currentProcess = null;
        this.abortController = null;
        this.screenWidth = 1920;
        this.screenHeight = 1080;

        // Ekran boyutunu al
        this.getScreenSizeAsync();
    }

    async getScreenSizeAsync() {
        try {
            const size = await this.runPowerShell(`
                Add-Type -AssemblyName System.Windows.Forms
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                Write-Output "$($screen.Width),$($screen.Height)"
            `);
            const [w, h] = size.split(',').map(Number);
            if (w && h) {
                this.screenWidth = w;
                this.screenHeight = h;
            }
        } catch (e) {
            console.log('[AutomationEngine] Ekran boyutu alınamadı, varsayılan kullanılıyor');
        }
    }

    async performRemoteClick(normalizedX, normalizedY) {
        // Ekran boyutunu al
        const x = Math.round(normalizedX * this.screenWidth);
        const y = Math.round(normalizedY * this.screenHeight);

        // Tek seferde tasi ve tikla (Hiz icin)
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'RemoteClick').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RemoteClick { 
                    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); 
                    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
                }'
            }
            [RemoteClick]::SetCursorPos(${x}, ${y})
            Start-Sleep -Milliseconds 20
            [RemoteClick]::mouse_event(0x0002, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 20
            [RemoteClick]::mouse_event(0x0004, 0, 0, 0, 0)
        `);
    }

    async performRemoteRightClick(normalizedX, normalizedY) {
        console.log('Performing Right Click', normalizedX, normalizedY);
        const x = Math.round(normalizedX * this.screenWidth);
        const y = Math.round(normalizedY * this.screenHeight);

        await this.runPowerShell(`
        if (-not ([System.Management.Automation.PSTypeName]'RemoteClick').Type) {
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RemoteClick { 
                [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); 
                [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int d, int e);
            }'
        }
        [RemoteClick]::SetCursorPos(${x}, ${y})
        [RemoteClick]::mouse_event(8, 0, 0, 0, 0)
        [RemoteClick]::mouse_event(16, 0, 0, 0, 0)
        `);
    }

    async performRemoteScroll(delta) {
        console.log('Performing Scroll', delta);
        // Larger scroll amount for better feel
        const scrollAmount = delta > 0 ? -240 : 240;

        await this.runPowerShell(`
        if (-not ([System.Management.Automation.PSTypeName]'RemoteClick').Type) {
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RemoteClick { 
                [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int d, int e);
            }'
        }
        [RemoteClick]::mouse_event(2048, 0, 0, ${scrollAmount}, 0)
        `);
    }

    async performRemoteKey(key) {
        // Map keys to SendKeys format
        const map = {
            'Enter': '{ENTER}',
            'Backspace': '{BS}',
            'Delete': '{DEL}',
            'Escape': '{ESC}',
            'ArrowUp': '{UP}',
            'ArrowDown': '{DOWN}',
            'ArrowLeft': '{LEFT}',
            'ArrowRight': '{RIGHT}',
            'Tab': '{TAB}',
            'Home': '{HOME}',
            'End': '{END}',
            'PageUp': '{PGUP}',
            'PageDown': '{PGDN}',
            'Space': ' '
        };

        let sendKey = map[key];
        if (!sendKey) {
            if (key.length === 1) {
                // Escape special chars for SendKeys
                if ("+^%~{}[]".includes(key)) {
                    sendKey = `{${key}}`;
                } else {
                    sendKey = key;
                }
            }
        }

        if (sendKey) {
            await this.runPowerShell(`
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')
            `);
        }
    }

    // PowerShell komutu çalıştır (Base64 encoded)
    runPowerShell(script) {
        return new Promise((resolve, reject) => {
            // Script'i temizle ve Base64'e encode et
            const cleanScript = script.trim();
            const encodedCommand = Buffer.from(cleanScript, 'utf16le').toString('base64');

            exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`,
                { windowsHide: true, timeout: 30000 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(stderr || error.message));
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    }

    // ============ MOUSE İŞLEMLERİ ============

    async moveMouse(x, y) {
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MouseMove').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseMove { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'
            }
            [MouseMove]::SetCursorPos(${x}, ${y})
        `);
    }

    async getMousePosition() {
        const result = await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MousePos').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MousePos { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P pt); }'
            }
            $pt = New-Object MousePos+P
            [MousePos]::GetCursorPos([ref]$pt) | Out-Null
            Write-Output "$($pt.X),$($pt.Y)"
        `);
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

        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MouseClick').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseClick { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e); }'
            }
            [MouseClick]::mouse_event(${downFlag}, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 50
            [MouseClick]::mouse_event(${upFlag}, 0, 0, 0, 0)
        `);
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
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MouseScroll').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseScroll { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e); }'
            }
            [MouseScroll]::mouse_event(0x0800, 0, 0, ${amount * 120}, 0)
        `);
    }

    async drag(startX, startY, endX, endY, duration = 500) {
        await this.moveMouse(startX, startY);
        await this.sleep(100);

        // Mouse down
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MouseDrag').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseDrag { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e); }'
            }
            [MouseDrag]::mouse_event(0x0002, 0, 0, 0, 0)
        `);

        // Hareket
        const steps = Math.max(10, Math.floor(duration / 50));
        const dx = (endX - startX) / steps;
        const dy = (endY - startY) / steps;

        for (let i = 1; i <= steps; i++) {
            await this.moveMouse(
                Math.round(startX + dx * i),
                Math.round(startY + dy * i)
            );
            await this.sleep(duration / steps);
        }

        // Mouse up
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'MouseDrag').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseDrag { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e); }'
            }
            [MouseDrag]::mouse_event(0x0004, 0, 0, 0, 0)
        `);
    }

    // ============ KLAVYE İŞLEMLERİ ============

    async pressKey(key) {
        const sendKey = this.convertKeyToSendKeys(key);
        await this.runPowerShell(`
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')
        `);
    }

    async keyCombo(...keys) {
        let combo = '';
        for (const key of keys) {
            const upper = key.toUpperCase();
            if (upper === 'CTRL') combo += '^';
            else if (upper === 'ALT') combo += '%';
            else if (upper === 'SHIFT') combo += '+';
            else combo += key.toLowerCase();
        }

        await this.runPowerShell(`
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${combo}')
        `);
    }

    async typeText(text) {
        // Clipboard üzerinden yapıştır (daha güvenilir)
        const escapedText = text.replace(/'/g, "''").replace(/`/g, "``");
        await this.runPowerShell(`
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Clipboard]::SetText('${escapedText}')
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait('^v')
        `);
    }

    async typeTextSlow(text, delay = 50) {
        for (const char of text) {
            if (char === '\n') {
                await this.pressKey('ENTER');
            } else {
                const escaped = char.replace(/[+^%~(){}[\]]/, '{$&}');
                await this.runPowerShell(`
                    Add-Type -AssemblyName System.Windows.Forms
                    [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
                `);
            }
            await this.sleep(delay);
        }
    }

    convertKeyToSendKeys(key) {
        const keyMap = {
            'ENTER': '{ENTER}',
            'TAB': '{TAB}',
            'ESCAPE': '{ESC}',
            'BACKSPACE': '{BACKSPACE}',
            'DELETE': '{DELETE}',
            'INSERT': '{INSERT}',
            'HOME': '{HOME}',
            'END': '{END}',
            'PAGE_UP': '{PGUP}',
            'PAGE_DOWN': '{PGDN}',
            'UP': '{UP}',
            'DOWN': '{DOWN}',
            'LEFT': '{LEFT}',
            'RIGHT': '{RIGHT}',
            'SPACE': ' ',
            'F1': '{F1}', 'F2': '{F2}', 'F3': '{F3}', 'F4': '{F4}',
            'F5': '{F5}', 'F6': '{F6}', 'F7': '{F7}', 'F8': '{F8}',
            'F9': '{F9}', 'F10': '{F10}', 'F11': '{F11}', 'F12': '{F12}'
        };
        return keyMap[key.toUpperCase()] || key;
    }

    // ============ PENCERE İŞLEMLERİ ============

    async launchProgram(exePath, args = []) {
        return new Promise((resolve, reject) => {
            try {
                const process = spawn(exePath, args, {
                    detached: true,
                    stdio: 'ignore',
                    cwd: path.dirname(exePath)
                });

                process.unref();
                this.currentProcess = process;

                setTimeout(() => {
                    resolve(process.pid);
                }, 2000);
            } catch (error) {
                reject(error);
            }
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
            // Tum eslesen process'leri oldur
            exec(`taskkill /IM "${name}" /F /T`, { windowsHide: true }, (error, stdout, stderr) => {
                console.log(`[KillProcess] ${name} - stdout: ${stdout}, stderr: ${stderr}`);
                // Hata olsa bile devam et
                resolve(true);
            });
        });
    }

    // Tum Telegram.exe'leri kapat (birden fazla yontem)
    async killAllTelegram() {
        console.log('[KillAllTelegram] Tum Telegram processleri kapatiliyor...');

        // Yontem 1: taskkill ile
        await new Promise((resolve) => {
            exec('taskkill /IM "Telegram.exe" /F /T', { windowsHide: true }, () => resolve());
        });

        // Kisa bekle
        await this.sleep(500);

        // Yontem 2: PowerShell ile tum Telegram processlerini bul ve oldur
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
        await this.runPowerShell(`
            if (-not ([System.Management.Automation.PSTypeName]'WinMax').Type) {
                Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinMax { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'
            }
            $h = [WinMax]::GetForegroundWindow()
            [WinMax]::ShowWindow($h, 3)
        `);
    }

    async focusProcessWindow(pid) {
        await this.runPowerShell(`
            $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
            if ($p -and $p.MainWindowHandle -ne 0) {
                 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }'
                 [WinFocus]::ShowWindow($p.MainWindowHandle, 9) # SW_RESTORE
                 [WinFocus]::SetForegroundWindow($p.MainWindowHandle)
            }
        `);
    }

    // ============ YARDIMCI FONKSİYONLAR ============

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    randomSleep(minMs, maxMs) {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return this.sleep(delay);
    }

    getScreenSize() {
        return {
            width: this.screenWidth,
            height: this.screenHeight
        };
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
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.click(data.x, data.y, data.button || 'left');
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'mouseDoubleClick':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.doubleClick(data.x, data.y);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'mouseMove':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.moveMouse(data.x, data.y);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'mouseDrag':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.drag(data.startX, data.startY, data.endX, data.endY, data.duration || 500);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'mouseScroll':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.scroll(data.amount);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'keyPress':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.pressKey(data.key);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'keyCombo':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.keyCombo(...data.keys);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'typeText':
                await this.sleep((data.delayBefore || 0) * 1000);
                if (data.slow) {
                    await this.typeTextSlow(data.text, data.charDelay || 50);
                } else {
                    await this.typeText(data.text);
                }
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'pasteChannelLinks':
                await this.sleep((data.delayBefore || 0) * 1000);
                let links = context.channelLinks || [];
                // Kanal sayısı limiti (varsayılan 5, node'dan gelebilir)
                const channelCount = data.channelCount || 5;
                // Rastgele seçim
                if (links.length > channelCount) {
                    // Fisher-Yates shuffle ve ilk N tanesini al
                    const shuffled = [...links].sort(() => Math.random() - 0.5);
                    links = shuffled.slice(0, channelCount);
                }
                const linkText = links.join('\n');
                await this.typeText(linkText);
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'launchProgram':
                await this.sleep((data.delayBefore || 0) * 1000);
                const exePath = data.useDynamic ? context.currentExePath : data.exePath;
                const pid = await this.launchProgram(exePath);
                context.currentPid = pid;
                await this.sleep((data.waitAfterLaunch || 2) * 1000);

                if (pid) {
                    await this.focusProcessWindow(pid);
                }

                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'closeProgram':
                await this.sleep((data.delayBefore || 0) * 1000);
                const processName = data.processName || 'Telegram.exe';

                // Telegram.exe icin ozel fonksiyon kullan
                if (processName.toLowerCase().includes('telegram')) {
                    console.log('[CloseProgram] Tum Telegram processleri kapatiliyor');
                    await this.killAllTelegram();
                } else if (data.usePid && context.currentPid) {
                    console.log('[CloseProgram] PID ile kapatiliyor:', context.currentPid);
                    await this.killProcess(context.currentPid);
                } else {
                    console.log('[CloseProgram] Process adi ile kapatiliyor:', processName);
                    await this.killProcessByName(processName);
                }
                await this.sleep((data.delayAfter || 0) * 1000);
                break;

            case 'maximizeWindow':
                await this.sleep((data.delayBefore || 0) * 1000);
                await this.maximizeActiveWindow();
                await this.sleep((data.delayAfter || 0) * 1000);
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

module.exports = AutomationEngine;
module.exports.VK_CODES = VK_CODES;
