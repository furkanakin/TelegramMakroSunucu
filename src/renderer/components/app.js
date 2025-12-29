const { ipcRenderer } = require('electron');

// ============ GLOBAL STATE ============
const state = {
    accounts: [],
    accountsFolder: null,
    theme: 'light',
};

// ============ DOM ELEMENTS ============
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// ============ TOAST NOTIFICATION SYSTEM ============
function showToast(message, type = 'info', duration = 5000) {
    let container = $('#toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: 'check-circle',
        error: 'times-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };

    toast.innerHTML = `
        <div class="toast-icon"><i class="fas fa-${icons[type] || 'info-circle'}"></i></div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    if (duration > 0) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    return toast;
}

function showSuccess(message) { showToast(message, 'success'); }
function showError(message) { showToast(message, 'error', 0); }
function showWarning(message) { showToast(message, 'warning', 8000); }
function showInfo(message) { showToast(message, 'info'); }

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initNavigation();
    initAccountsPage();
    initRotationToggle();
    await loadInitialData();
    setupIpcListeners();
});

// ============ THEME ============
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    $('#theme-toggle').addEventListener('click', () => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    });
}

function setTheme(theme) {
    state.theme = theme;
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${theme}-theme`);

    const icon = $('#theme-toggle i');
    const text = $('#theme-toggle span');

    if (theme === 'dark') {
        icon.className = 'fas fa-moon';
        text.textContent = 'Koyu Tema';
    } else {
        icon.className = 'fas fa-sun';
        text.textContent = 'Acik Tema';
    }
}

// ============ NAVIGATION ============
function initNavigation() {
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            switchPage(page);
        });
    });
}

function switchPage(pageName) {
    $$('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    $$('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    switch (pageName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'accounts':
            loadAccounts();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// ============ ROTATION TOGGLE ============
function initRotationToggle() {
    const toggle = $('#rotation-enabled');
    const statusLabel = $('#rotation-status');

    if (!toggle) return;

    // Varsayılan olarak deaktif
    toggle.checked = false;
    updateRotationStatus(false);

    toggle.addEventListener('change', async () => {
        const enabled = toggle.checked;
        updateRotationStatus(enabled);

        // Backend'e bildir
        await ipcRenderer.invoke('set-rotation-enabled', enabled);

        if (enabled) {
            showSuccess('Pencere döngüsü aktif edildi');
        } else {
            showWarning('Pencere döngüsü devre dışı bırakıldı');
        }
    });
}

function updateRotationStatus(enabled) {
    const statusLabel = $('#rotation-status');
    if (statusLabel) {
        statusLabel.textContent = enabled ? 'Aktif' : 'Devre Dışı';
        statusLabel.style.color = enabled ? 'var(--accent-success)' : 'var(--text-muted)';
    }
}

// ============ ACCOUNTS PAGE ============
function initAccountsPage() {
    $('#select-accounts-folder-btn').addEventListener('click', selectAccountsFolder);
    $('#refresh-accounts-btn').addEventListener('click', refreshAccounts);

    const savedFolder = localStorage.getItem('accountsFolder');
    if (savedFolder) {
        state.accountsFolder = savedFolder;
        updateFolderDisplay(savedFolder);
        scanAccountsFolder(savedFolder);
    }
}

async function selectAccountsFolder() {
    const folder = await ipcRenderer.invoke('browse-folder');
    if (folder) {
        state.accountsFolder = folder;
        localStorage.setItem('accountsFolder', folder);
        updateFolderDisplay(folder);
        await scanAccountsFolder(folder);
    }
}

function updateFolderDisplay(folderPath) {
    const container = $('#selected-accounts-folder');
    const pathSpan = $('#accounts-folder-path');

    if (folderPath) {
        container.classList.add('has-folder');
        pathSpan.textContent = folderPath;
    } else {
        container.classList.remove('has-folder');
        pathSpan.textContent = 'Klasor secilmedi';
    }
}

async function scanAccountsFolder(folderPath) {
    if (!folderPath) return;

    try {
        const result = await ipcRenderer.invoke('scan-accounts-folder', folderPath);

        if (result.success) {
            state.accounts = result.accounts;
            renderAccountsTable();
            $('#accounts-count').textContent = result.accounts.length;
        } else {
            showError('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('Klasor tarama hatasi:', error);
    }
}

async function refreshAccounts() {
    if (state.accountsFolder) {
        await scanAccountsFolder(state.accountsFolder);
    } else {
        showWarning('Lutfen once bir klasor secin');
    }
}

// ============ DATA LOADING ============
async function loadInitialData() {
    await loadDashboard();
}

async function loadDashboard() {
    try {
        const stats = await ipcRenderer.invoke('get-stats');
        $('#stat-accounts').textContent = stats.accountCount || 0;
        $('#stat-active-accounts').textContent = stats.activeAccountCount || 0;

        // Connection status
        const connectionStatus = $('#connection-status');
        if (connectionStatus) {
            ipcRenderer.invoke('get-connection-status').then(status => {
                connectionStatus.textContent = status.connected ? 'Bagli' : 'Bagli degil';
                connectionStatus.style.color = status.connected ? 'var(--accent-success)' : 'var(--accent-danger)';
            }).catch(() => {
                connectionStatus.textContent = 'Bilinmiyor';
            });
        }

        // Open Telegram count
        const telegramCount = $('#open-telegram-count');
        if (telegramCount) {
            ipcRenderer.invoke('get-telegram-count').then(count => {
                telegramCount.textContent = count || 0;
            }).catch(() => {
                telegramCount.textContent = '0';
            });
        }

        const screenSize = await ipcRenderer.invoke('get-screen-size');
        const screenRes = $('#screen-resolution');
        if (screenRes) {
            screenRes.textContent = `${screenSize.width} x ${screenSize.height}`;
        }
    } catch (error) {
        console.error('Dashboard yukleme hatasi:', error);
    }
}

// ============ ACCOUNTS ============
async function loadAccounts() {
    const dbAccounts = await ipcRenderer.invoke('get-accounts');

    if (state.accountsFolder) {
        await scanAccountsFolder(state.accountsFolder);
    } else {
        state.accounts = dbAccounts;
        renderAccountsTable();
    }
}

function renderAccountsTable() {
    const tbody = $('#accounts-table tbody');

    if (state.accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Henuz hesap bulunamadi. Ana klasoru secin.</td></tr>';
        return;
    }

    tbody.innerHTML = state.accounts.map(account => `
        <tr>
            <td><strong>${account.phone_number || account.folder_name}</strong></td>
            <td title="${account.exe_path}">${truncatePath(account.exe_path, 50)}</td>
            <td>${account.last_used ? formatDate(account.last_used) : '-'}</td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" ${account.is_active ? 'checked' : ''}
                           onchange="toggleAccount(${account.id}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="actions">
                <button class="btn btn-icon btn-secondary" onclick="testLaunchAccount(${account.id})" title="Test Et">
                    <i class="fas fa-play"></i>
                </button>
                <button class="btn btn-icon btn-danger" onclick="deleteAccount(${account.id})" title="Sil">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');

    $('#accounts-count').textContent = state.accounts.length;
}

window.toggleAccount = async (id, isActive) => {
    await ipcRenderer.invoke('toggle-account', { id, isActive });
};

window.deleteAccount = async (id) => {
    if (confirm('Bu hesabi silmek istediginizden emin misiniz?')) {
        await ipcRenderer.invoke('delete-account', id);
        loadAccounts();
    }
};

window.testLaunchAccount = async (id) => {
    const account = state.accounts.find(a => a.id === id);
    if (account) {
        const result = await ipcRenderer.invoke('test-launch-telegram', account.exe_path);
        if (!result.success) {
            showError('Hata: ' + result.error);
        }
    }
};

// ============ SETTINGS ============
async function loadSettings() {
    try {
        const settings = await ipcRenderer.invoke('get-settings');

        if (settings.manager_url) {
            $('#manager-url').value = settings.manager_url;
        }
        if (settings.default_delay) {
            $('#default-delay').value = settings.default_delay;
        }
        if (settings.telegram_launch_delay) {
            $('#telegram-launch-delay').value = settings.telegram_launch_delay;
        }

        // Checkboxlar
        const keepScreen = $('#keep-screen-alive');
        if (keepScreen) {
            keepScreen.checked = settings.keep_screen_alive !== 'false';
        }
        const preventSleep = $('#prevent-sleep');
        if (preventSleep) {
            preventSleep.checked = settings.prevent_sleep !== 'false';
        }

        // Event listeners for settings save
        setupSettingsListeners();

        const screenSize = await ipcRenderer.invoke('get-screen-size');
        $('#screen-resolution').textContent = `${screenSize.width} x ${screenSize.height}`;
    } catch (error) {
        console.error('Ayarlar yukleme hatasi:', error);
    }
}

function setupSettingsListeners() {
    // Settings auto-save
    const settingInputs = [
        { id: 'manager-url', key: 'manager_url' },
        { id: 'default-delay', key: 'default_delay' },
        { id: 'telegram-launch-delay', key: 'telegram_launch_delay' }
    ];

    settingInputs.forEach(({ id, key }) => {
        const el = $(`#${id}`);
        if (el && !el.dataset.listenerAdded) {
            el.dataset.listenerAdded = 'true';
            el.addEventListener('change', async () => {
                await ipcRenderer.invoke('set-setting', { key, value: el.value });
                showSuccess('Ayar kaydedildi');
            });
        }
    });

    const checkboxSettings = [
        { id: 'keep-screen-alive', key: 'keep_screen_alive' },
        { id: 'prevent-sleep', key: 'prevent_sleep' }
    ];

    checkboxSettings.forEach(({ id, key }) => {
        const el = $(`#${id}`);
        if (el && !el.dataset.listenerAdded) {
            el.dataset.listenerAdded = 'true';
            el.addEventListener('change', async () => {
                await ipcRenderer.invoke('set-setting', { key, value: el.checked.toString() });
                showSuccess('Ayar kaydedildi');
            });
        }
    });
}

// ============ IPC LISTENERS ============
function setupIpcListeners() {
    // Manager sunucusu baglanti durumu
    ipcRenderer.on('socket-connected', () => {
        const el = $('#connection-status');
        if (el) {
            el.textContent = 'Bagli';
            el.style.color = 'var(--accent-success)';
        }
        showSuccess('Manager sunucusuna baglandi');
    });

    ipcRenderer.on('socket-disconnected', () => {
        const el = $('#connection-status');
        if (el) {
            el.textContent = 'Bagli degil';
            el.style.color = 'var(--accent-danger)';
        }
        showWarning('Manager sunucusu baglantisi kesildi');
    });

    // Accounts updated from remote
    ipcRenderer.on('accounts-updated', () => {
        loadAccounts();
        loadDashboard();
    });
}

// ============ UTILITIES ============
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function truncatePath(path, maxLength) {
    if (!path) return '-';
    if (path.length <= maxLength) return path;
    return '...' + path.slice(-(maxLength - 3));
}
