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

        console.log('[ScreenKeeper] Ekran koruma başlatıldı');
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
        console.log('[ScreenKeeper] Ekran koruyucu devre dışı bırakıldı');
    }

    /**
     * Ekran koruyucuyu eski haline getir
     */
    restoreScreensaver() {
        if (this.originalScreensaverState) {
            exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -Path \'HKCU:\\Control Panel\\Desktop\' -Name ScreenSaveActive -Value 1"', { windowsHide: true });
            console.log('[ScreenKeeper] Ekran koruyucu geri yüklendi');
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
                        console.log('[ScreenKeeper] Sanal ekran ayarları yapılandırıldı');
                        resolve(true);
                    }
                });
            }
        });
    }

    /**
     * Session koruma
     */
    async keepSessionAlive() {
        return new Promise((resolve) => {
            exec('query session', { windowsHide: true }, (error, stdout) => {
                if (error) {
                    console.error('[ScreenKeeper] Session sorgulanamadı');
                    resolve(false);
                    return;
                }

                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('Active') || line.includes('Aktif')) {
                        const match = line.match(/\s+(\d+)\s+/);
                        if (match) {
                            console.log(`[ScreenKeeper] Aktif session ID: ${match[1]}`);
                            resolve(true);
                            return;
                        }
                    }
                }
                resolve(false);
            });
        });
    }

    /**
     * Güç planını yüksek performansa ayarla
     */
    async setHighPerformancePowerPlan() {
        return new Promise((resolve) => {
            exec('powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', { windowsHide: true }, (error) => {
                if (error) {
                    const commands = [
                        'powercfg /change monitor-timeout-ac 0',
                        'powercfg /change monitor-timeout-dc 0',
                        'powercfg /change standby-timeout-ac 0',
                        'powercfg /change standby-timeout-dc 0',
                        'powercfg /change hibernate-timeout-ac 0',
                        'powercfg /change hibernate-timeout-dc 0',
                    ];

                    let completed = 0;
                    for (const cmd of commands) {
                        exec(cmd, { windowsHide: true }, () => {
                            completed++;
                            if (completed === commands.length) {
                                resolve(true);
                            }
                        });
                    }
                } else {
                    console.log('[ScreenKeeper] Yüksek performans güç planı aktifleştirildi');
                    resolve(true);
                }
            });
        });
    }

    /**
     * Tüm koruma sistemlerini başlat
     */
    async startAll() {
        console.log('[ScreenKeeper] Tüm koruma sistemleri başlatılıyor...');

        this.startKeepAlive();
        await this.setupVirtualDisplay();
        await this.keepSessionAlive();
        await this.setHighPerformancePowerPlan();

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
