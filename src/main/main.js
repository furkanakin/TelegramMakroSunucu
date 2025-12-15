const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Veritabanı ve otomasyon modülleri
const DatabaseManager = require('../database/schema');
const TelegramAutomation = require('../automation/telegram-automation');
const AutomationEngine = require('../automation/automation-engine');
const ScreenKeeper = require('../automation/screen-keeper');
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
let automation = null;
let coordinatePickerActive = false;
let coordinateResolve = null;
let streamInterval = null;
let screenKeeper = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: path.join(__dirname, '../renderer/assets/icon.png'),
        title: 'Telegram Macro Automation',
        backgroundColor: '#f5f7fa'
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Development modunda DevTools aç
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

    try {
        const toaPath = path.join(__dirname, '../../TOA.json');
        if (fs.existsSync(toaPath)) {
            console.log('Found TOA.json, checking for import...');
            const toaContent = fs.readFileSync(toaPath, 'utf8');
            const toaData = JSON.parse(toaContent);

            // Handle structure { workflow: { ... } } or direct { nodes: ... }
            const wfData = toaData.workflow || toaData;
            const nodes = wfData.nodes || [];
            const edges = wfData.edges || [];
            const name = wfData.name || "TOA";
            const desc = wfData.description || "Auto Imported Default Workflow";

            if (nodes.length > 0) {
                // Check if already exists
                const workflows = db.getWorkflows();
                const existing = workflows.find(w => w.name === name);

                let wfId;
                if (existing) {
                    try {
                        // Update existing logic
                        console.log(`Updating existing default workflow: ${name}`);
                        db.updateWorkflow(existing.id, nodes, edges);
                        // Ensure it is default
                        db.setDefaultWorkflow(existing.id);
                        wfId = existing.id;
                    } catch (e) {
                        console.error('Error updating workflow:', e);
                    }
                } else {
                    console.log(`Importing new default workflow: ${name}`);
                    wfId = db.saveWorkflow(name, nodes, edges, desc);
                    db.setDefaultWorkflow(wfId);
                }
                console.log(`Default workflow set to ID: ${wfId}`);
            }
        }
    } catch (err) {
        console.error('Error auto-importing TOA.json:', err);
    }

    automation = new TelegramAutomation(db);
    screenKeeper = new ScreenKeeper();

    // Check Admin & Start Protection
    screenKeeper.checkAdmin().then(isAdmin => {
        if (!isAdmin) {
            console.warn("UYARI: Yönetici yetkisi yok! VDS koruması tam çalışmayabilir.");
        } else {
            console.log("Yönetici yetkisi doğrulandı.");
        }
        // Start basic protection (prevent sleep)
        screenKeeper.startKeepAlive();
    });

    // Otomasyon eventlerini UI'a ilet
    automation.onEvent((event, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('automation-event', { event, data });
        }
    });

    // Socket client handlerlarını ayarla
    // Socket client handlerlarını ayarla
    socketClient.setHandlers({
        onAddChannel: async (link) => {
            db.addChannel(link);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('channel-added-remotely', link);
            }
            return true;
        },
        onSettingsUpdate: (settings) => {
            if (processManager) processManager.updateSettings(settings);
        },
        onCommand: async (command) => {
            switch (command.type) {
                case 'start':
                    await automation.start(command.options || {});
                    break;
                case 'stop':
                    await automation.stop();
                    break;
                case 'pause':
                    automation.pause();
                    break;
                case 'resume':
                    automation.resume();
                    break;
                case 'kill_telegram': // Old generic kill
                    exec('taskkill /F /IM telegram.exe /T', (error) => {
                        if (processManager) processManager.killAll(); // Also clear our manager
                    });
                    socketClient.sendLog('Telegramlar kapatıldı.', 'success');
                    break;
                case 'kill_all_telegram': // New specific kill
                    if (processManager) processManager.killAll();
                    socketClient.sendLog('Tüm Telegram süreçleri sonlandırıldı.', 'success');
                    break;
                case 'clear_channels':
                    try {
                        db.deleteAllChannels();
                        socketClient.sendLog('Tüm kanallar başarıyla silindi.', 'success');
                    } catch (err) {
                        socketClient.sendLog(`Kanal silme hatası: ${err.message}`, 'error');
                    }
                    break;
                case 'delete_channel':
                    if (command.id) db.deleteChannel(command.id);
                    break;
                case 'delete_account':
                    if (command.id) db.deleteAccount(command.id);
                    break;
                case 'keep_cloud_active':
                    if (screenKeeper) {
                        socketClient.sendLog('VDS ekranı açık tutuluyor (TSCON)...', 'info');
                        screenKeeper.performTscon();
                    }
                    break;
                case 'minimize_all':
                    if (automation && automation.engine) {
                        await automation.engine.runPowerShell('(New-Object -ComObject Shell.Application).MinimizeAll()');
                    }
                    break;
                case 'open_telegram':
                    console.log('[VDS] Received open_telegram command:', JSON.stringify(command));
                    // command.accountId or command.phoneNumber
                    try {
                        let account = null;
                        if (command.accountId) account = db.getAccountById(command.accountId);
                        if (!account && command.phoneNumber) account = db.getAccountByPhone(command.phoneNumber);

                        if (!account) {
                            // Fallback: search in all accounts with loose equality
                            const accounts = db.getAccounts(false);
                            account = accounts.find(a => a.id == command.accountId || a.phone_number == command.phoneNumber);
                        }

                        if (account) {
                            const result = await processManager.launchTelegram(account);
                            // result can be true (already running) or object { success: true, pid: 123 }
                            // If just true, we assume it's running but we should probably still emit confirmation or find PID

                            // Let's ensure processManager.launchTelegram returns PID if already running too or handle it
                            // For now, if result is object, emit event.

                            socketClient.sendLog(`Telegram başlatıldı: ${account.phone_number}`, 'success');

                            if (typeof result === 'object' && result.pid) {
                                socketClient.socket.emit('macro:process_started', {
                                    socketId: socketClient.socket.id,
                                    accountId: account.id,
                                    pid: result.pid,
                                    phoneNumber: account.phone_number
                                });
                            } else if (result === true) {
                                // Already running case
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
                default:
                    throw new Error('Bilinmeyen komut');
            }
        },
        onGetStats: async () => {
            try {
                const accounts = db.getAccounts(false);
                const channels = db.getChannels(false);
                return {
                    accountCount: accounts.length,
                    activeAccountCount: accounts.filter(a => a.is_active).length,
                    channelCount: channels.length,
                    activeChannelCount: channels.filter(c => c.status === 'active' || c.status === 'pending').length,
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
                    channels: db.getChannels(false),
                    automationStatus: automation.getStatus(),
                    activeProcesses: processManager ? processManager.getActiveProcesses() : []
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
            let noSourceCount = 0;
            streamInterval = setInterval(async () => {
                try {
                    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: 540 } });
                    if (sources.length > 0) {
                        const buffer = sources[0].thumbnail.toJPEG(40);
                        const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                        socketClient.sendStreamFrame(b64);
                        noSourceCount = 0;
                    }
                } catch (e) {
                    // Fail silently mostly
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
            if (data.type === 'click' && automation?.engine) await automation.engine.performRemoteClick(data.x, data.y);
            else if (data.type === 'keydown' && automation?.engine) await automation.engine.performRemoteKey(data.key);
            else if (data.type === 'right-click' && automation?.engine) await automation.engine.performRemoteRightClick(data.x, data.y);
            else if (data.type === 'scroll' && automation?.engine) await automation.engine.performRemoteScroll(data.delta);
        },
        onGetSessions: async () => {
            console.log('Retrieving sessions from DB...');
            try {
                const accounts = db.getAccounts(false);
                if (accounts.length > 0) {
                    console.log('First account object keys:', Object.keys(accounts[0]));
                    console.log('First account sample:', accounts[0]);
                }
                // Try to find the correct property
                const sessions = accounts.map(a => a.session_file || a.session_name || a.phone_number);
                console.log(`Found ${sessions.length} sessions.`);
                if (sessions.length > 0) {
                    console.log('Sample VDS session names:', sessions.slice(0, 5));
                }
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
        args: ['--hidden'] // Optional: start hidden if desired, but user didn't ask. Just ensure it starts.
    });

    await initDatabase();
    createWindow();

    // Connect to Manager
    socketClient.connect();

    // Koordinat seçici için global kısayol
    globalShortcut.register('Escape', () => {
        if (coordinatePickerActive) {
            coordinatePickerActive = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
            if (coordinateResolve) {
                coordinateResolve(null);
                coordinateResolve = null;
            }
        }
    });
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

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// ============ IPC HANDLERs ============

// Hesap işlemleri
ipcMain.handle('get-accounts', () => {
    return db.getAccounts(false);
});

ipcMain.handle('add-account', (event, { phoneNumber, folderPath, exePath }) => {
    try {
        db.addAccount(phoneNumber, folderPath, exePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
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

ipcMain.handle('browse-exe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Executable', extensions: ['exe'] }],
        title: 'Telegram.exe Dosyasını Seçin'
    });
    return result.canceled ? null : result.filePaths[0];
});

// Kanal işlemleri
ipcMain.handle('get-channels', () => {
    return db.getChannels(false);
});

ipcMain.handle('add-channel', (event, link) => {
    try {
        db.addChannel(link);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('add-channels-bulk', (event, links) => {
    try {
        db.addChannelsBulk(links);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-channel', (event, id) => {
    try {
        db.deleteChannel(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-all-channels', () => {
    try {
        db.deleteAllChannels();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Istek gecmisi islemleri
ipcMain.handle('get-join-request-history', (event, limit = 500) => {
    try {
        const history = db.getJoinRequestHistory(limit);
        return { success: true, history };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-join-request-history-by-account', (event, accountId) => {
    try {
        const history = db.getJoinRequestHistoryByAccount(accountId);
        return { success: true, history };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-all-join-requests', () => {
    try {
        db.clearAllJoinRequests();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-join-requests-for-account', (event, accountId) => {
    try {
        db.clearJoinRequestsForAccount(accountId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-join-request', (event, id) => {
    try {
        db.deleteJoinRequest(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-join-request-stats', () => {
    try {
        const stats = db.getJoinRequestStats();
        return { success: true, stats };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Workflow işlemleri
ipcMain.handle('get-workflows', () => {
    return db.getWorkflows();
});

ipcMain.handle('get-workflow', (event, id) => {
    return db.getWorkflow(id);
});

ipcMain.handle('save-workflow', (event, { name, nodes, edges, description }) => {
    try {
        const id = db.saveWorkflow(name, nodes, edges, description);
        return { success: true, id };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-workflow', (event, { id, nodes, edges }) => {
    try {
        db.updateWorkflow(id, nodes, edges);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-workflow', (event, id) => {
    try {
        db.deleteWorkflow(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-default-workflow', (event, id) => {
    try {
        db.setDefaultWorkflow(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-default-workflow', () => {
    try {
        const workflow = db.getDefaultWorkflow();
        return { success: true, workflow };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('rename-workflow', (event, { id, name, description }) => {
    try {
        db.renameWorkflow(id, name, description);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Otomasyon kontrolü
ipcMain.handle('start-automation', async (event, options) => {
    try {
        automation.start(options);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pause-automation', () => {
    automation.pause();
    return { success: true };
});

ipcMain.handle('resume-automation', () => {
    automation.resume();
    return { success: true };
});

ipcMain.handle('stop-automation', async () => {
    await automation.stop();
    return { success: true };
});

ipcMain.handle('get-automation-status', () => {
    return automation.getStatus();
});

// Koordinat seçici
ipcMain.handle('pick-coordinate', async () => {
    return new Promise((resolve) => {
        coordinateResolve = resolve;
        coordinatePickerActive = true;

        // Ana pencereyi gizle
        if (mainWindow) {
            mainWindow.hide();
        }

        // PowerShell script dosyasını kullan
        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '../automation/pick-coordinate.ps1');

        const ps = spawn('powershell', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], { windowsHide: true });

        let output = '';

        ps.stdout.on('data', (data) => {
            output += data.toString();
        });

        ps.stderr.on('data', (data) => {
            console.error('[CoordinatePicker] Error:', data.toString());
        });

        ps.on('close', (code) => {
            coordinatePickerActive = false;

            // Ana pencereyi göster
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }

            const trimmed = output.trim();
            if (code === 0 && trimmed) {
                const parts = trimmed.split(',');
                if (parts.length === 2) {
                    const x = parseInt(parts[0], 10);
                    const y = parseInt(parts[1], 10);
                    if (!isNaN(x) && !isNaN(y)) {
                        console.log(`[CoordinatePicker] Koordinat secildi: ${x}, ${y}`);
                        resolve({ x, y });
                        coordinateResolve = null;
                        return;
                    }
                }
            }

            console.log('[CoordinatePicker] Koordinat secilemedi');
            resolve(null);
            coordinateResolve = null;
        });

        // 60 saniye sonra timeout
        setTimeout(() => {
            if (coordinatePickerActive) {
                ps.kill();
                coordinatePickerActive = false;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                }
                resolve(null);
                coordinateResolve = null;
            }
        }, 60000);
    });
});

// Mouse tıklama kontrolü için yardımcı fonksiyon (opsiyonel native)
function checkMouseClick() {
    try {
        const ffi = require('ffi-napi');
        const user32 = ffi.Library('user32', {
            'GetAsyncKeyState': ['short', ['int']]
        });
        // VK_LBUTTON = 0x01
        return (user32.GetAsyncKeyState(0x01) & 0x8000) !== 0;
    } catch (e) {
        return false;
    }
}

// İstatistikler
ipcMain.handle('get-stats', () => {
    return db.getStats();
});

ipcMain.handle('get-join-stats', () => {
    return db.getJoinRequestStats();
});

// Loglar
ipcMain.handle('get-logs', (event, limit) => {
    return db.getLogs(limit);
});

ipcMain.handle('clear-logs', () => {
    db.clearLogs();
    return { success: true };
});

// Ayarlar
ipcMain.handle('get-settings', () => {
    return db.getAllSettings();
});

ipcMain.handle('set-setting', (event, { key, value }) => {
    db.setSetting(key, value);
    // If manager URL is updated, reconnect
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

// Test - Tek bir aksiyonu çalıştır
ipcMain.handle('test-action', async (event, action) => {
    const engine = new AutomationEngine();
    try {
        // Test için örnek context oluştur
        let testContext = {};

        // Eğer launchProgram ise ve dinamik kullanılıyorsa, ilk hesabı al
        if (action.type === 'launchProgram' && action.data.useDynamic) {
            const accounts = db.getAccounts(true);
            if (accounts.length > 0) {
                testContext.currentExePath = accounts[0].exe_path;
                testContext.currentAccountId = accounts[0].id;
            } else {
                return { success: false, error: 'Test için aktif hesap bulunamadı. Önce hesap ekleyin.' };
            }
        }

        await engine.executeNode({ type: action.type, data: action.data }, testContext);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tüm workflow'u test et
ipcMain.handle('test-workflow', async (event, { nodes, edges }) => {
    const engine = new AutomationEngine();
    try {
        // Test için context oluştur
        let testContext = {};

        // İlk hesabı al (launchProgram için)
        const accounts = db.getAccounts(true);
        if (accounts.length > 0) {
            testContext.currentExePath = accounts[0].exe_path;
            testContext.currentAccountId = accounts[0].id;
        }

        // Kanalları al (pasteChannelLinks için)
        const channels = db.getChannels(true);
        testContext.channelLinks = channels.map(c => c.link);

        // 3 saniye bekle
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Workflow'u çalıştır
        const result = await engine.executeWorkflow(nodes, edges, testContext);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Minimize ana pencere (koordinat seçimi için)
ipcMain.handle('minimize-window', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
    return { success: true };
});

ipcMain.handle('restore-window', () => {
    if (mainWindow) {
        mainWindow.restore();
        mainWindow.focus();
    }
    return { success: true };
});

// Workflow dışarı aktar (export)
ipcMain.handle('export-workflow', async (event, workflow) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Workflow\'u Dışarı Aktar',
            defaultPath: `${workflow.name || 'workflow'}.json`,
            filters: [
                { name: 'JSON Dosyası', extensions: ['json'] }
            ]
        });

        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }

        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            workflow: {
                name: workflow.name,
                description: workflow.description,
                nodes: workflow.nodes,
                edges: workflow.edges
            }
        };

        fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
        return { success: true, filePath: result.filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Workflow içeri aktar (import)
ipcMain.handle('import-workflow', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Workflow İçeri Aktar',
            filters: [
                { name: 'JSON Dosyası', extensions: ['json'] }
            ],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const filePath = result.filePaths[0];
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const importData = JSON.parse(fileContent);

        // Versiyon ve format kontrolü
        if (!importData.workflow || !importData.workflow.nodes) {
            return { success: false, error: 'Geçersiz workflow dosyası' };
        }

        return {
            success: true,
            workflow: importData.workflow,
            filePath: filePath
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Ana klasör seçimi için dialog
ipcMain.handle('select-accounts-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Telegram Hesaplarının Bulunduğu Ana Klasörü Seçin'
    });
    return result.canceled ? null : result.filePaths[0];
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

                // Telegram.exe ara
                const telegramExePath = path.join(subfolderPath, 'Telegram.exe');
                const telegramExeAltPath = path.join(subfolderPath, 'Telegram', 'Telegram.exe');

                let exePath = null;
                if (fs.existsSync(telegramExePath)) {
                    exePath = telegramExePath;
                } else if (fs.existsSync(telegramExeAltPath)) {
                    exePath = telegramExeAltPath;
                }

                if (exePath) {
                    // Telefon numarası klasör adından al - boşsa klasör adını kullan
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
            // Mevcut hesapları sil
            const existingAccounts = db.getAccounts(false);
            for (const acc of existingAccounts) {
                db.deleteAccount(acc.id);
            }

            // Yeni hesapları ekle
            for (const acc of accounts) {
                db.addAccount(acc.phone_number, acc.folder_path, acc.exe_path);
            }
        }

        // Veritabanından güncel listeyi çek (id'ler dahil)
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
    const engine = new AutomationEngine();
    try {
        await engine.launchProgram(exePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
