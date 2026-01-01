const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Veritabanı ve servis modülleri
const DatabaseManager = require('../database/schema');
const socketClient = require('./services/socketClient');
const processManager = require('./services/processManager');

// Data klasörünü oluştur
const dataPath = path.join(__dirname, '../../data');
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

// Global değişkenler
let mainWindow = null;
let db = null;
let streamInterval = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: path.join(__dirname, '../renderer/assets/icon.png'),
        title: 'Telegram Macro Server',
        backgroundColor: '#f5f7fa'
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Veritabanını başlat
async function initDatabase() {
    db = new DatabaseManager(path.join(dataPath, 'telegram_automation.db'));
    await db.init();

    // Socket client handlerlarını ayarla
    socketClient.setHandlers({
        onSettingsUpdate: (settings) => {
            if (processManager) processManager.updateSettings(settings);
        },
        onCommand: async (command) => {
            switch (command.type) {
                case 'open_telegram':
                    console.log('[VDS] Received open_telegram command:', JSON.stringify(command));
                    try {
                        let account = null;

                        if (command.phoneNumber) {
                            account = db.getAccountByPhone(command.phoneNumber);
                            console.log(`[VDS] Lookup by phone ${command.phoneNumber}: ${account ? 'Found' : 'Not Found'}`);
                        }

                        if (!account && command.accountId) {
                            account = db.getAccountById(command.accountId);
                            console.log(`[VDS] Lookup by ID ${command.accountId}: ${account ? 'Found' : 'Not Found'}`);
                        }

                        if (!account) {
                            const accounts = db.getAccounts(false);
                            account = accounts.find(a => a.phone_number == command.phoneNumber || a.id == command.accountId);
                        }

                        console.log('[VDS] Account search result:', account ? `Found: ${account.phone_number} (ID: ${account.id})` : 'NOT FOUND');

                        if (account) {
                            const result = await processManager.launchTelegram(account);
                            socketClient.sendLog(`Telegram başlatıldı: ${account.phone_number}`, 'success');

                            if (typeof result === 'object' && result.pid) {
                                socketClient.socket.emit('macro:process_started', {
                                    socketId: socketClient.socket.id,
                                    accountId: account.id,
                                    pid: result.pid,
                                    phoneNumber: account.phone_number
                                });
                            } else if (result === true) {
                                socketClient.socket.emit('macro:process_started', {
                                    socketId: socketClient.socket.id,
                                    accountId: account.id,
                                    phoneNumber: account.phone_number,
                                    status: 'already_running'
                                });
                            }
                        } else {
                            socketClient.sendLog('Hesap bulunamadı.', 'error');
                        }
                    } catch (e) {
                        socketClient.sendLog(`Telegram başlatma hatası: ${e.message}`, 'error');
                        if (socketClient.socket) {
                            socketClient.socket.emit('macro:process_failed', {
                                errorMessage: e.message
                            });
                        }
                    }
                    break;
                case 'kill_all_telegram':
                    if (processManager) processManager.killAll();
                    socketClient.sendLog('Tüm Telegram süreçleri sonlandırıldı.', 'success');
                    break;
                case 'minimize_all':
                    const { exec } = require('child_process');
                    exec('powershell -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"');
                    break;
                case 'cleanup_vds_folders':
                    console.log('[VDS] Received cleanup_vds_folders command');
                    const validSessions = command.validSessions || [];
                    const deletedCount = await cleanupFolders(validSessions);
                    socketClient.sendLog(`Temizleme işlemi tamamlandı: ${deletedCount} adet geçersiz hesap klasörü silindi.`, 'success');
                    break;
                default:
                    console.log('Bilinmeyen komut:', command.type);
            }
        },
        onGetStats: async () => {
            try {
                const accounts = db.getAccounts(false);
                return {
                    accountCount: accounts.length,
                    activeAccountCount: accounts.filter(a => a.is_active).length,
                    telegramCount: processManager ? processManager.getCount() : 0
                };
            } catch (e) {
                return {};
            }
        },
        onGetDetails: async () => {
            try {
                return {
                    accounts: db.getAccounts(false),
                    activeProcesses: processManager ? processManager.getActiveProcesses() : [],
                    disk: await socketClient.getDiskInfo()
                };
            } catch (e) {
                return {};
            }
        },
        onGetScreenshot: async () => {
            try {
                const { desktopCapturer } = require('electron');
                const screenSize = screen.getPrimaryDisplay().size;
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: screenSize
                });
                if (sources.length > 0) {
                    const buffer = sources[0].thumbnail.toJPEG(60);
                    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
                }
                return null;
            } catch (e) {
                return null;
            }
        },
        onStartStream: () => {
            if (streamInterval) clearInterval(streamInterval);
            const { desktopCapturer } = require('electron');
            streamInterval = setInterval(async () => {
                try {
                    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: 540 } });
                    if (sources.length > 0) {
                        const buffer = sources[0].thumbnail.toJPEG(40);
                        const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                        socketClient.sendStreamFrame(b64);
                    }
                } catch (e) {
                    // Fail silently
                }
            }, 300);
        },
        onStopStream: () => {
            if (streamInterval) {
                clearInterval(streamInterval);
                streamInterval = null;
            }
        },
        onRemoteInput: async (data) => {
            // Remote input handling if needed
        },
        onGetSessions: async () => {
            console.log('Retrieving sessions from DB...');
            try {
                const accounts = db.getAccounts(false);
                const sessions = accounts.map(a => a.session_file || a.session_name || a.phone_number);
                console.log(`Found ${sessions.length} sessions.`);
                return sessions;
            } catch (error) {
                console.error('Error getting sessions:', error);
                throw error;
            }
        }
    });
}

// App hazır olduğunda
app.whenReady().then(async () => {
    app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden']
    });

    await initDatabase();
    createWindow();

    // Connect to Manager
    socketClient.connect();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (db) db.close();
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ============ IPC HANDLERs ============

// Hesap işlemleri
ipcMain.handle('get-accounts', () => {
    return db.getAccounts(false);
});

ipcMain.handle('delete-account', (event, id) => {
    try {
        db.deleteAccount(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-account', (event, { id, isActive }) => {
    try {
        db.toggleAccountActive(id, isActive);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('browse-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Telegram Klasörünü Seçin'
    });
    return result.canceled ? null : result.filePaths[0];
});

// İstatistikler
ipcMain.handle('get-stats', () => {
    return db.getStats();
});

// Ayarlar
ipcMain.handle('get-settings', () => {
    return db.getAllSettings();
});

ipcMain.handle('set-setting', (event, { key, value }) => {
    db.setSetting(key, value);
    if (key === 'manager_url') {
        socketClient.connect(value);
    }
    return { success: true };
});

// Ekran boyutu
ipcMain.handle('get-screen-size', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.size;
});

// Bağlantı durumu
ipcMain.handle('get-connection-status', () => {
    return { connected: socketClient.isConnected() };
});

// Hesaplar klasörünü tara
ipcMain.handle('scan-accounts-folder', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Klasör bulunamadı' };
        }

        const accounts = [];
        const subfolders = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const dirent of subfolders) {
            if (dirent.isDirectory()) {
                const folderName = dirent.name;
                const subfolderPath = path.join(folderPath, folderName);

                const telegramExePath = path.join(subfolderPath, 'Telegram.exe');
                const telegramExeAltPath = path.join(subfolderPath, 'Telegram', 'Telegram.exe');

                let exePath = null;
                if (fs.existsSync(telegramExePath)) {
                    exePath = telegramExePath;
                } else if (fs.existsSync(telegramExeAltPath)) {
                    exePath = telegramExeAltPath;
                }

                if (exePath) {
                    let phoneNumber = folderName.replace(/[^0-9+]/g, '');
                    if (!phoneNumber || phoneNumber.length === 0) {
                        phoneNumber = folderName;
                    }

                    accounts.push({
                        phone_number: phoneNumber,
                        folder_path: subfolderPath,
                        exe_path: exePath,
                        folder_name: folderName,
                        is_active: 1,
                        last_used: null
                    });
                }
            }
        }

        // Veritabanını temizle ve yeni hesapları ekle
        if (accounts.length > 0) {
            const existingAccounts = db.getAccounts(false);
            for (const acc of existingAccounts) {
                db.deleteAccount(acc.id);
            }

            for (const acc of accounts) {
                db.addAccount(acc.phone_number, acc.folder_path, acc.exe_path);
            }
        }

        const savedAccounts = db.getAccounts(false);

        return {
            success: true,
            accounts: savedAccounts,
            count: savedAccounts.length
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Telegram hesabını test et (aç)
ipcMain.handle('test-launch-telegram', async (event, exePath) => {
    const { exec } = require('child_process');
    try {
        exec(`"${exePath}"`);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Pencere döngüsü kontrolü
ipcMain.handle('set-rotation-enabled', (event, enabled) => {
    if (processManager) {
        processManager.setRotationEnabled(enabled);
    }
    return { success: true };
});

// Açık Telegram sayısı
ipcMain.handle('get-telegram-count', () => {
    return processManager ? processManager.getCount() : 0;
});

/**
 * Valid listede olmayan hesap klasörlerini temizler
 */
async function cleanupFolders(validSessionNames) {
    const accounts = db.getAccounts(false);
    const validSet = new Set(validSessionNames.map(n => n.toLowerCase()));
    let deletedCount = 0;

    for (const account of accounts) {
        const phone = account.phone_number.toString().toLowerCase();
        // Eğer phone number validSet içinde yoksa sil
        if (!validSet.has(phone)) {
            console.log(`[VDS Cleanup] Deleting invalid account: ${account.phone_number}`);

            // Klasörü sil
            if (account.folder_path && fs.existsSync(account.folder_path)) {
                try {
                    // Node.js 14+ için rmSync
                    if (fs.rmSync) {
                        fs.rmSync(account.folder_path, { recursive: true, force: true });
                    } else {
                        // Geriye dönük uyumluluk
                        fs.rmdirSync(account.folder_path, { recursive: true });
                    }
                } catch (e) {
                    console.error(`Error deleting folder ${account.folder_path}:`, e.message);
                }
            }

            // DB'den sil
            db.deleteAccount(account.id);
            deletedCount++;
        }
    }
    return deletedCount;
}
