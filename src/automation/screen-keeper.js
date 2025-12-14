/**
 * VDS/RDP için ekran kilidi önleme sistemi
 * RDP bağlantısı kesilse bile otomasyon devam edebilir
 */

const { exec, spawn } = require('child_process');
const path = require('path');

class ScreenKeeper {
    constructor() {
        this.isActive = false;
        this.keepAliveInterval = null;
        this.originalScreensaverState = false;
    }

    /**
     * Administrator yetkisi kontrolü
     */
    async checkAdmin() {
        return new Promise(resolve => {
            exec('net session', { windowsHide: true }, (err, stdout, stderr) => {
                resolve(err ? false : true);
            });
        });
    }

    /**
     * TSCON ile oturumu konsola yönlendir (Ekran açık kalır)
     */
    async performTscon() {
        console.log('[ScreenKeeper] TSCON işlemi başlatılıyor...');
        try {
            const isAdmin = await this.checkAdmin();
            if (!isAdmin) {
                console.error('[ScreenKeeper] HATA: Administrator yetkisi yok! TSCON çalışmayabilir.');
                return { success: false, error: 'Administrator yetkisi gerekli. Lütfen programı yönetici olarak açın.' };
            }

            // Mevcut session ID'yi alıp konsola yönlendiren komut
            const psCommand = `
                $id = (Get-Process -Id $PID).SessionId
                $tscon = "$env:SystemRoot\\System32\\tscon.exe"
                & $tscon $id /dest:console
            `;

            return new Promise((resolve) => {
                exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, { windowsHide: true }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[ScreenKeeper] TSCON Hatası: ${error.message}`);
                        // stderr de önemli olabilir
                        if (stderr) console.error(`[ScreenKeeper] TSCON Stderr: ${stderr}`);
                        resolve({ success: false, error: error.message });
                    } else {
                        console.log('[ScreenKeeper] TSCON komutu başarıyla gönderildi (RDP kesilebilir).');
                        resolve({ success: true });
                    }
                });
            });

        } catch (e) {
            console.error('[ScreenKeeper] Beklenmeyen hata:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * Ekranı aktif tut - temel yöntem
     */
    startKeepAlive() {
        if (this.isActive) return;

        this.isActive = true;

        // Sürekli olarak sistemi uyanık tut
        this.keepAliveInterval = setInterval(() => {
            this.preventSleep();
        }, 30000); // Her 30 saniyede bir

        // İlk çağrı
        this.preventSleep();
        this.disableScreensaver();

        console.log('[ScreenKeeper] Ekran koruma başlatıldı (Prevent Sleep)');
    }

    /**
     * Uyku modunu engelle - PowerShell ile
     */
    preventSleep() {
        const script = `
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SK { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }'
            [SK]::SetThreadExecutionState(0x80000003)
        `.replace(/\r?\n/g, ' ');

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`, { windowsHide: true });
    }

    /**
     * Ekran koruyucuyu devre dışı bırak
     */
    disableScreensaver() {
        exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path \'HKCU:\\Control Panel\\Desktop\' -Name ScreenSaveActive -Value 0"', { windowsHide: true });
    }

    /**
     * Ekran koruyucuyu eski haline getir
     */
    restoreScreensaver() {
        if (this.originalScreensaverState) {
            exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path \'HKCU:\\Control Panel\\Desktop\' -Name ScreenSaveActive -Value 1"', { windowsHide: true });
        }
    }

    /**
     * Sanal ekran ayarları (RDP)
     */
    async setupVirtualDisplay() {
        return new Promise((resolve, reject) => {
            const commands = [
                'reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services" /v fDisableCpm /t REG_DWORD /d 0 /f',
                'reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services" /v MaxIdleTime /t REG_DWORD /d 0 /f',
                'reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services" /v MaxDisconnectionTime /t REG_DWORD /d 0 /f',
            ];

            let completed = 0;
            for (const cmd of commands) {
                exec(cmd, { windowsHide: true }, (error) => {
                    completed++;
                    if (completed === commands.length) {
                        resolve(true);
                    }
                });
            }
        });
    }

    /**
     * Güç planını yüksek performansa ayarla
     */
    async setHighPerformancePowerPlan() {
        // ... Mevcut kodun basitleştirilmiş hali ...
        const cmd = 'powercfg /change monitor-timeout-ac 0'; // Sadece monitör zaman aşımını kapat yeterli
        exec(cmd, { windowsHide: true });
    }

    /**
     * Tüm koruma sistemlerini başlat
     */
    async startAll() {
        console.log('[ScreenKeeper] Tüm koruma sistemleri başlatılıyor...');
        this.startKeepAlive();
        await this.setupVirtualDisplay();
        this.setHighPerformancePowerPlan();
        console.log('[ScreenKeeper] Tüm koruma sistemleri aktif');
    }

    /**
     * Durdur ve temizle
     */
    stop() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }

        this.restoreScreensaver();
        this.isActive = false;
        console.log('[ScreenKeeper] Ekran koruma durduruldu');
    }

    /**
     * Durum bilgisi
     */
    getStatus() {
        return {
            isActive: this.isActive,
            hasKeepAliveInterval: this.keepAliveInterval !== null
        };
    }
}

module.exports = ScreenKeeper;
