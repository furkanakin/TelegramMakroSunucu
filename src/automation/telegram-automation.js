/**
 * Telegram Otomasyon Yöneticisi
 * Hesapları döngüsel olarak açıp kanallara istek gönderir
 */

const AutomationEngine = require('./automation-engine');
const ScreenKeeper = require('./screen-keeper');
const path = require('path');

class TelegramAutomation {
    constructor(database) {
        this.db = database;
        this.engine = new AutomationEngine();
        this.screenKeeper = new ScreenKeeper();
        this.isRunning = false;
        this.isPaused = false;
        this.shouldStop = false;
        this.currentAccountIndex = 0;
        this.channelsPerAccount = 5;
        this.excludeRequested = true;
        this.eventCallback = null;
        this.currentAccount = null;
        this.stats = {
            processedAccounts: 0,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            currentLoop: 1
        };
    }

    /**
     * Event callback'i ayarla (UI güncellemeleri için)
     */
    onEvent(callback) {
        this.eventCallback = callback;
    }

    /**
     * Event gönder
     */
    emit(event, data) {
        if (this.eventCallback) {
            this.eventCallback(event, data);
        }
        this.db.addLog(event, JSON.stringify(data), data.accountId || null, data.status || 'info');
    }

    /**
     * Ana otomasyon döngüsü
     */
    async start(options = {}) {
        if (this.isRunning) {
            throw new Error('Otomasyon zaten çalışıyor');
        }

        this.isRunning = true;
        this.isPaused = false;
        this.shouldStop = false;
        this.channelsPerAccount = options.channelsPerAccount || 5;
        this.excludeRequested = options.excludeRequested !== false;

        // Ekran korumasını başlat
        await this.screenKeeper.startAll();

        this.emit('automation_started', { timestamp: new Date().toISOString() });

        try {
            await this.runMainLoop();
        } catch (error) {
            this.emit('automation_error', { error: error.message });
        } finally {
            this.isRunning = false;
            this.screenKeeper.stop();
            this.emit('automation_stopped', { stats: this.stats });
        }
    }

    /**
     * Ana döngü
     */
    async runMainLoop() {
        let allChannelsCompleted = false;

        while (!this.shouldStop && !allChannelsCompleted) {
            // Tüm hesapları karıştırılmış sırada al
            const accounts = this.shuffleArray(this.db.getAccounts(true));

            if (accounts.length === 0) {
                this.emit('no_accounts', { message: 'Aktif hesap bulunamadı' });
                break;
            }

            this.emit('loop_started', { loop: this.stats.currentLoop, accountCount: accounts.length });

            for (const account of accounts) {
                if (this.shouldStop) break;

                // Pause kontrolü
                while (this.isPaused && !this.shouldStop) {
                    await this.engine.sleep(100);
                }

                if (this.shouldStop) break;

                // Bu hesap için işlenmemiş kanalları al
                const channels = this.excludeRequested
                    ? this.db.getUnrequestedChannels(account.id, this.channelsPerAccount)
                    : this.shuffleArray(this.db.getChannels(true)).slice(0, this.channelsPerAccount);

                if (channels.length === 0) {
                    this.emit('account_skipped', {
                        accountId: account.id,
                        phone: account.phone_number,
                        reason: 'Tüm kanallara zaten istek gönderilmiş'
                    });
                    continue;
                }

                // Hesabı işle
                await this.processAccount(account, channels);
                this.stats.processedAccounts++;
            }

            // Tüm hesaplar tüm kanallara istek attı mı kontrol et
            if (this.excludeRequested) {
                allChannelsCompleted = this.db.isAllChannelsRequested();
                if (allChannelsCompleted) {
                    this.emit('all_completed', { message: 'Tüm hesaplar tüm kanallara istek gönderdi' });
                }
            }

            this.stats.currentLoop++;
        }
    }

    /**
     * Tek bir hesabı işle
     */
    async processAccount(account, channels) {
        this.currentAccount = account;

        this.emit('account_started', {
            accountId: account.id,
            phone: account.phone_number,
            channelCount: channels.length
        });

        try {
            // Varsayılan workflow'u al
            const workflow = this.db.getDefaultWorkflow();

            if (!workflow) {
                // Workflow yoksa basit bir akış kullan
                await this.runSimpleFlow(account, channels);
            } else {
                // Workflow'u çalıştır
                await this.runWorkflow(workflow, account, channels);
            }

            this.emit('account_completed', {
                accountId: account.id,
                phone: account.phone_number,
                success: true
            });

            // Hesabın son kullanım zamanını güncelle
            this.db.updateAccountLastUsed(account.id);

        } catch (error) {
            this.emit('account_error', {
                accountId: account.id,
                phone: account.phone_number,
                error: error.message
            });
        }

        this.currentAccount = null;
    }

    /**
     * Workflow olmadan basit akış
     */
    async runSimpleFlow(account, channels) {
        // Telegram'ı aç
        this.emit('launching_telegram', { phone: account.phone_number, exePath: account.exe_path });

        await this.engine.launchTelegram(account.exe_path);
        await this.engine.sleep(3000);

        // Pencereyi tam ekran yap
        const hwnd = this.engine.getForegroundWindow();
        this.engine.maximizeWindow(hwnd);
        await this.engine.sleep(1000);

        // Her kanal için istek gönder
        const channelLinks = channels.map(c => c.link);

        this.emit('sending_requests', {
            phone: account.phone_number,
            channels: channelLinks
        });

        // Kanal linklerini kaydet
        for (const channel of channels) {
            this.db.recordJoinRequest(account.id, channel.id, 'sent');
            this.stats.totalRequests++;
        }

        // Telegram'ı kapat
        await this.engine.killProcessByName('Telegram.exe');
        await this.engine.sleep(1000);
    }

    /**
     * Workflow ile akış
     */
    async runWorkflow(workflow, account, channels) {
        const context = {
            currentExePath: account.exe_path,
            currentAccountId: account.id,
            currentPhone: account.phone_number,
            channelLinks: channels.map(c => c.link),
            channels: channels,
            logCallback: (message) => {
                this.emit('workflow_log', { message, phone: account.phone_number });
            }
        };

        const result = await this.engine.executeWorkflow(workflow.nodes, workflow.edges, context);

        if (result.success) {
            // Kanal isteklerini kaydet
            for (const channel of channels) {
                this.db.recordJoinRequest(account.id, channel.id, 'success');
                this.stats.successfulRequests++;
            }
        } else {
            for (const channel of channels) {
                this.db.recordJoinRequest(account.id, channel.id, 'failed');
                this.stats.failedRequests++;
            }
            throw new Error(result.error);
        }
    }

    /**
     * Diziyi karıştır (Fisher-Yates shuffle)
     */
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Duraklatma
     */
    pause() {
        this.isPaused = true;
        this.engine.pause();
        this.emit('automation_paused', { timestamp: new Date().toISOString() });
    }

    /**
     * Devam ettirme
     */
    resume() {
        this.isPaused = false;
        this.engine.resume();
        this.emit('automation_resumed', { timestamp: new Date().toISOString() });
    }

    /**
     * Durdurma
     */
    async stop() {
        this.shouldStop = true;
        this.engine.abort();
        this.emit('automation_stopping', { timestamp: new Date().toISOString() });

        // Tum Telegram processlerini kapat
        try {
            await this.engine.killAllTelegram();
            console.log('[TelegramAutomation] Tum Telegram processleri kapatildi');
        } catch (err) {
            console.error('[TelegramAutomation] Telegram kapatma hatasi:', err);
        }

        this.isRunning = false;
        this.emit('automation_stopped', { stats: this.stats });
    }

    /**
     * Durum bilgisi
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            currentAccount: this.currentAccount ? {
                id: this.currentAccount.id,
                phone: this.currentAccount.phone_number
            } : null,
            stats: this.stats,
            screenKeeperStatus: this.screenKeeper.getStatus()
        };
    }

    /**
     * İstatistikleri sıfırla
     */
    resetStats() {
        this.stats = {
            processedAccounts: 0,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            currentLoop: 1
        };
    }
}

module.exports = TelegramAutomation;
