const { ipcRenderer } = require('electron');

// ============ GLOBAL STATE ============
const state = {
    accounts: [],
    channels: [],
    workflows: [],
    currentWorkflow: null,
    selectedNode: null,
    nodes: [],
    edges: [],
    nodeIdCounter: 0,
    isDragging: false,
    isConnecting: false,
    connectionStart: null,
    tempLine: null,
    accountsFolder: null,
    theme: 'light',
    // Zoom ve Pan
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    // Clipboard
    copiedNode: null,
    copiedNodes: [], // Coklu kopyalama icin
    // Multi-select
    selectedNodes: [], // Coklu secim icin
    // Marquee selection
    isMarqueeSelecting: false,
    marqueeStart: { x: 0, y: 0 },
    marqueeEnd: { x: 0, y: 0 },
};

// ============ DOM ELEMENTS ============
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// ============ TOAST NOTIFICATION SYSTEM ============
// Kopyalanabilir bildirim sistemi
function showToast(message, type = 'info', duration = 5000) {
    // Container yoksa olustur
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
            <div class="toast-message" onclick="this.select ? this.select() : window.getSelection().selectAllChildren(this)">${message}</div>
            <button class="toast-copy" onclick="copyToastMessage(this)" title="Kopyala">
                <i class="fas fa-copy"></i>
            </button>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);

    // Animasyon
    setTimeout(() => toast.classList.add('show'), 10);

    // Otomatik kapanma (0 ise kapanmaz)
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    return toast;
}

// Kopyalama fonksiyonu
window.copyToastMessage = function(btn) {
    const message = btn.parentElement.querySelector('.toast-message').textContent;
    navigator.clipboard.writeText(message).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 1500);
    });
};

// Alert yerine kullanilacak fonksiyonlar
function showSuccess(message) {
    showToast(message, 'success');
}

function showError(message) {
    showToast(message, 'error', 0); // Hata bildirimleri otomatik kapanmaz
}

function showWarning(message) {
    showToast(message, 'warning', 8000);
}

function showInfo(message) {
    showToast(message, 'info');
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initNavigation();
    initModals();
    initWorkflowEditor();
    initAutomationControls();
    initAccountsPage();
    await loadInitialData();
    setupIpcListeners();
});

// ============ THEME ============
function initTheme() {
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    // Theme toggle click
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
        case 'channels':
            loadChannels();
            break;
        case 'workflow':
            loadWorkflows();
            break;
        case 'history':
            loadHistory();
            break;
        case 'logs':
            loadLogs();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// ============ MODALS ============
function initModals() {
    $$('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.remove('active');
        });
    });

    $$('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // Channel modals
    $('#add-channel-btn')?.addEventListener('click', () => {
        $('#add-channel-modal').classList.add('active');
        $('#channel-link').value = '';
        // Input'a focus ver
        setTimeout(() => $('#channel-link').focus(), 100);
    });

    $('#bulk-add-channels-btn')?.addEventListener('click', () => {
        $('#bulk-channels-modal').classList.add('active');
        $('#bulk-channels-input').value = '';
        // Textarea'ya focus ver
        setTimeout(() => $('#bulk-channels-input').focus(), 100);
    });

    $('#delete-all-channels-btn')?.addEventListener('click', deleteAllChannels);

    $('#save-channel-btn').addEventListener('click', saveChannel);
    $('#save-bulk-channels-btn').addEventListener('click', saveBulkChannels);

    // Workflow save modal
    $('#save-workflow-btn').addEventListener('click', () => {
        // Eger mevcut workflow varsa, modal basligini degistir
        if (state.currentWorkflow) {
            $('#save-workflow-modal-title').textContent = 'Workflow Guncelle';
            $('#workflow-name').value = state.currentWorkflow.name || '';
            $('#workflow-description').value = state.currentWorkflow.description || '';
        } else {
            $('#save-workflow-modal-title').textContent = 'Yeni Workflow Kaydet';
            $('#workflow-name').value = '';
            $('#workflow-description').value = '';
        }
        $('#save-workflow-modal').classList.add('active');
    });

    $('#confirm-save-workflow-btn').addEventListener('click', saveWorkflow);

    // Workflow duzenleme modali
    $('#edit-workflow-btn').addEventListener('click', () => {
        if (state.currentWorkflow) {
            $('#rename-workflow-name').value = state.currentWorkflow.name || '';
            $('#rename-workflow-description').value = state.currentWorkflow.description || '';
            $('#rename-workflow-modal').classList.add('active');
        }
    });

    $('#confirm-rename-workflow-btn').addEventListener('click', renameWorkflow);
    $('#delete-workflow-btn').addEventListener('click', deleteCurrentWorkflow);
}

function showModal(modalId) {
    $(`#${modalId}`).classList.add('active');
}

function hideModal(modalId) {
    $(`#${modalId}`).classList.remove('active');
}

// ============ ACCOUNTS PAGE ============
function initAccountsPage() {
    $('#select-accounts-folder-btn').addEventListener('click', selectAccountsFolder);
    $('#refresh-accounts-btn').addEventListener('click', refreshAccounts);

    // Load saved folder path
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
    await loadDefaultWorkflowOnStartup();
    await loadAutomationWorkflows();
}

// Varsayilan workflow'u acilista yukle
async function loadDefaultWorkflowOnStartup() {
    try {
        const result = await ipcRenderer.invoke('get-default-workflow');
        if (result.success && result.workflow) {
            console.log('[Startup] Varsayilan workflow yukleniyor:', result.workflow.name);
            state.currentWorkflow = result.workflow;

            // Workflow sayfasindaki select'i guncelle
            await loadWorkflows();

            // Varsayilan workflow'u sec
            const workflowSelect = $('#workflow-select');
            if (workflowSelect) {
                workflowSelect.value = result.workflow.id;
            }

            // Canvas'a yukle
            loadWorkflowToCanvas(result.workflow);

            // Edit butonunu goster
            $('#edit-workflow-btn').style.display = '';

            console.log('[Startup] Varsayilan workflow yuklendi');
        }
    } catch (error) {
        console.error('[Startup] Varsayilan workflow yuklenemedi:', error);
    }
}

// Otomasyon sayfasi icin workflow listesini yukle
async function loadAutomationWorkflows() {
    try {
        const workflows = await ipcRenderer.invoke('get-workflows');
        const select = $('#automation-workflow-select');
        const info = $('#automation-workflow-info');

        if (!select) return;

        // Secenekleri temizle
        select.innerHTML = '<option value="">-- Workflow Secin --</option>';

        // Workflow'lari ekle
        let defaultWorkflowId = null;
        for (const workflow of workflows) {
            const option = document.createElement('option');
            option.value = workflow.id;
            option.textContent = workflow.name + (workflow.is_default ? ' (Varsayilan)' : '');
            select.appendChild(option);

            if (workflow.is_default) {
                defaultWorkflowId = workflow.id;
            }
        }

        // Varsayilan workflow'u sec
        if (defaultWorkflowId) {
            select.value = defaultWorkflowId;
            info.textContent = 'Varsayilan workflow secili';
        } else {
            info.textContent = '';
        }

        // Secim degistiginde bilgi guncelle
        select.addEventListener('change', () => {
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption && selectedOption.value) {
                info.textContent = `"${selectedOption.textContent}" calistirilacak`;
            } else {
                info.textContent = '';
            }
        });
    } catch (error) {
        console.error('[Automation] Workflow listesi yuklenemedi:', error);
    }
}

async function loadDashboard() {
    const stats = await ipcRenderer.invoke('get-stats');

    $('#stat-accounts').textContent = stats.accountCount;
    $('#stat-channels').textContent = stats.channelCount;
    $('#stat-requests').textContent = stats.totalRequests;
    $('#stat-successful').textContent = stats.successfulRequests;

    const logs = await ipcRenderer.invoke('get-logs', 10);
    renderRecentActivities(logs);

    const screenSize = await ipcRenderer.invoke('get-screen-size');
    $('#screen-resolution').textContent = `${screenSize.width} x ${screenSize.height}`;
}

function renderRecentActivities(logs) {
    const container = $('#recent-activities');

    if (logs.length === 0) {
        container.innerHTML = '<p class="empty-state">Henuz aktivite yok</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="activity-item">
            <div class="activity-icon ${log.status}">
                <i class="fas fa-${getActivityIcon(log.status)}"></i>
            </div>
            <div class="activity-info">
                <span class="activity-message">${log.action}</span>
                <span class="activity-time">${formatDate(log.created_at)}</span>
            </div>
        </div>
    `).join('');
}

function getActivityIcon(status) {
    const icons = {
        success: 'check',
        error: 'times',
        warning: 'exclamation',
        info: 'info'
    };
    return icons[status] || 'circle';
}

// ============ ACCOUNTS ============
async function loadAccounts() {
    // Load from database
    const dbAccounts = await ipcRenderer.invoke('get-accounts');

    // If we have a folder, scan it
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

// ============ CHANNELS ============
async function loadChannels() {
    state.channels = await ipcRenderer.invoke('get-channels');
    renderChannelsTable();
}

function renderChannelsTable() {
    const tbody = $('#channels-table tbody');

    if (state.channels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Henuz kanal eklenmemis</td></tr>';
        return;
    }

    tbody.innerHTML = state.channels.map(channel => `
        <tr>
            <td><a href="${channel.link}" target="_blank">${channel.link}</a></td>
            <td>${formatDate(channel.created_at)}</td>
            <td>
                <span class="badge" style="background-color: ${channel.is_active ? 'var(--accent-success)' : 'var(--text-muted)'}">
                    ${channel.is_active ? 'Aktif' : 'Pasif'}
                </span>
            </td>
            <td class="actions">
                <button class="btn btn-icon btn-danger" onclick="deleteChannel(${channel.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function saveChannel() {
    const link = $('#channel-link').value.trim();

    if (!link) {
        showWarning('Lutfen kanal linkini girin');
        return;
    }

    const result = await ipcRenderer.invoke('add-channel', link);

    if (result.success) {
        hideModal('add-channel-modal');
        loadChannels();
    } else {
        showError('Hata: ' + result.error);
    }
}

async function saveBulkChannels() {
    const input = $('#bulk-channels-input').value.trim();

    if (!input) {
        showWarning('Lutfen kanal linklerini girin');
        return;
    }

    const links = input.split('\n').filter(link => link.trim());

    if (links.length === 0) {
        showWarning('Gecerli link bulunamadi');
        return;
    }

    const result = await ipcRenderer.invoke('add-channels-bulk', links);

    if (result.success) {
        hideModal('bulk-channels-modal');
        loadChannels();
        showSuccess(`${links.length} kanal eklendi`);
    } else {
        showError('Hata: ' + result.error);
    }
}

window.deleteChannel = async (id) => {
    if (confirm('Bu kanali silmek istediginizden emin misiniz?')) {
        await ipcRenderer.invoke('delete-channel', id);
        loadChannels();
    }
};

async function deleteAllChannels() {
    const channelCount = state.channels.length;

    if (channelCount === 0) {
        showWarning('Silinecek kanal yok');
        return;
    }

    if (confirm(`Tum kanallari (${channelCount} adet) silmek istediginizden emin misiniz?\n\nBu islem geri alinamaz!`)) {
        try {
            const result = await ipcRenderer.invoke('delete-all-channels');
            if (result.success) {
                loadChannels();
                showSuccess(`${channelCount} kanal silindi`);
            } else {
                showError('Hata: ' + result.error);
            }
        } catch (error) {
            showError('Silme hatasi: ' + error.message);
        }
    }
}

// ============ WORKFLOW EDITOR ============
function initWorkflowEditor() {
    const canvas = $('#workflow-canvas');
    const nodesContainer = $('#nodes-container');

    $$('.node-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('nodeType', item.dataset.type);
        });
        item.setAttribute('draggable', true);
    });

    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const nodeType = e.dataTransfer.getData('nodeType');
        if (nodeType) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            addNode(nodeType, x, y);
        }
    });

    // Marquee bitti flag'i - click event'inin secimi temizlemesini engellemek icin
    let justFinishedMarquee = false;

    canvas.addEventListener('click', (e) => {
        if (e.target === canvas || e.target === nodesContainer) {
            // Marquee az once bittiyse secimi temizleme
            if (justFinishedMarquee) {
                justFinishedMarquee = false;
                return;
            }
            if (!state.isMarqueeSelecting) {
                clearMultiSelection();
                selectNode(null);
            }
        }
    });

    // Marquee (alan) secimi - hem canvas hem nodesContainer icin
    // Marquee icin ayri state (screen koordinatlari)
    let marqueeScreenStart = { x: 0, y: 0 };

    function startMarqueeSelection(e) {
        // Sadece sol tik
        if (e.button !== 0) return;

        // Node veya handle uzerinde degilse marquee baslat
        const isOnNode = e.target.closest('.workflow-node');
        const isOnHandle = e.target.classList.contains('node-handle');
        if (isOnNode || isOnHandle) return;

        // Canvas icerisinde herhangi bir yere tiklandiginda marquee baslat
        const canvasRect = canvas.getBoundingClientRect();

        // Node koordinatlari (transform edilmis)
        const nodeX = (e.clientX - canvasRect.left - state.panX) / state.zoom;
        const nodeY = (e.clientY - canvasRect.top - state.panY) / state.zoom;

        // Screen koordinatlari (marquee gorseli icin)
        const screenX = e.clientX - canvasRect.left;
        const screenY = e.clientY - canvasRect.top;

        console.log('[Marquee] Basladi - nodeX:', nodeX, 'nodeY:', nodeY, 'screenX:', screenX, 'screenY:', screenY);

        state.isMarqueeSelecting = true;
        state.marqueeStart = { x: nodeX, y: nodeY };
        state.marqueeEnd = { x: nodeX, y: nodeY };
        marqueeScreenStart = { x: screenX, y: screenY };

        // Marquee elementi olustur veya guncelle - CANVAS icine ekle (nodesContainer degil)
        let marquee = $('#marquee-selection');
        if (!marquee) {
            marquee = document.createElement('div');
            marquee.id = 'marquee-selection';
            canvas.appendChild(marquee);
        }
        marquee.style.cssText = `
            display: block !important;
            position: absolute;
            left: ${screenX}px;
            top: ${screenY}px;
            width: 0px;
            height: 0px;
            border: 2px dashed #f59e0b;
            background-color: rgba(245, 158, 11, 0.2);
            pointer-events: none;
            z-index: 9999;
            border-radius: 4px;
        `;

        e.preventDefault();
    }

    canvas.addEventListener('mousedown', startMarqueeSelection);
    nodesContainer.addEventListener('mousedown', startMarqueeSelection);

    document.addEventListener('mousemove', (e) => {
        if (!state.isMarqueeSelecting) return;

        const canvasEl = $('#workflow-canvas');
        const canvasRect = canvasEl.getBoundingClientRect();

        // Node koordinatlari (secim hesaplamasi icin)
        const nodeX = (e.clientX - canvasRect.left - state.panX) / state.zoom;
        const nodeY = (e.clientY - canvasRect.top - state.panY) / state.zoom;

        // Screen koordinatlari (gorsel icin)
        const screenX = e.clientX - canvasRect.left;
        const screenY = e.clientY - canvasRect.top;

        state.marqueeEnd = { x: nodeX, y: nodeY };

        const marquee = $('#marquee-selection');
        if (marquee) {
            // Screen koordinatlari ile marquee ciz
            const left = Math.min(marqueeScreenStart.x, screenX);
            const top = Math.min(marqueeScreenStart.y, screenY);
            const width = Math.abs(screenX - marqueeScreenStart.x);
            const height = Math.abs(screenY - marqueeScreenStart.y);

            marquee.style.left = `${left}px`;
            marquee.style.top = `${top}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;

            // Tarama sirasinda node'lari gecici olarak vurgula
            highlightNodesInMarquee();
        }
    });

    // Tarama sirasinda node'lari gecici olarak vurgula
    function highlightNodesInMarquee() {
        const left = Math.min(state.marqueeStart.x, state.marqueeEnd.x);
        const top = Math.min(state.marqueeStart.y, state.marqueeEnd.y);
        const right = Math.max(state.marqueeStart.x, state.marqueeEnd.x);
        const bottom = Math.max(state.marqueeStart.y, state.marqueeEnd.y);

        state.nodes.forEach(node => {
            const nodeLeft = node.position.x;
            const nodeTop = node.position.y;
            const nodeRight = node.position.x + 180;
            const nodeBottom = node.position.y + 80;

            const nodeEl = $(`#${node.id}`);
            if (!nodeEl) return;

            // Node marquee icinde mi?
            if (nodeLeft < right && nodeRight > left && nodeTop < bottom && nodeBottom > top) {
                nodeEl.classList.add('marquee-hover');
            } else {
                nodeEl.classList.remove('marquee-hover');
            }
        });
    }

    document.addEventListener('mouseup', (e) => {
        if (!state.isMarqueeSelecting) return;

        const marquee = $('#marquee-selection');
        if (marquee) {
            marquee.style.display = 'none';
        }

        // Tum marquee-hover class'larini kaldir
        $$('.workflow-node.marquee-hover').forEach(el => el.classList.remove('marquee-hover'));

        // Marquee icindeki node'lari sec
        const left = Math.min(state.marqueeStart.x, state.marqueeEnd.x);
        const top = Math.min(state.marqueeStart.y, state.marqueeEnd.y);
        const right = Math.max(state.marqueeStart.x, state.marqueeEnd.x);
        const bottom = Math.max(state.marqueeStart.y, state.marqueeEnd.y);

        console.log('[Marquee] Secim alani:', { left, top, right, bottom });
        console.log('[Marquee] Node sayisi:', state.nodes.length);

        // Sadece belirli bir alan secildiyse node'lari sec (en az 5px - daha duyarli)
        if (right - left > 5 || bottom - top > 5) {
            clearMultiSelection();

            state.nodes.forEach(node => {
                const nodeLeft = node.position.x;
                const nodeTop = node.position.y;
                const nodeRight = node.position.x + 180;
                const nodeBottom = node.position.y + 80;

                // Node marquee icinde mi? (kesisim kontrolu)
                if (nodeLeft < right && nodeRight > left && nodeTop < bottom && nodeBottom > top) {
                    console.log('[Marquee] Node secildi:', node.id);
                    state.selectedNodes.push(node.id);
                    const nodeEl = document.getElementById(node.id);
                    if (nodeEl) {
                        nodeEl.classList.add('multi-selected');
                        console.log('[Marquee] Class eklendi:', nodeEl.className);
                    }
                }
            });

            updateSelectionToolbar();

            if (state.selectedNodes.length > 0) {
                console.log('[Marquee] Toplam ' + state.selectedNodes.length + ' node secildi');
                // Kullaniciya gorsel bildirim
                showSelectionNotification(state.selectedNodes.length);
            } else {
                console.log('[Marquee] Hicbir node secilemedi');
            }
        }

        state.isMarqueeSelecting = false;

        // Sadece gercek bir marquee secimi yapildiysa click'i engelle
        // (en az 5px surukleme ve en az 1 node secildiyse)
        if ((right - left > 5 || bottom - top > 5) && state.selectedNodes.length > 0) {
            justFinishedMarquee = true;
            setTimeout(() => { justFinishedMarquee = false; }, 100);
        }
    });

    // Secim bildirimi fonksiyonu
    function showSelectionNotification(count) {
        // Mevcut bildirimi kaldir
        const existing = document.querySelector('.selection-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'selection-notification';
        notification.innerHTML = `<i class="fas fa-check-circle"></i> ${count} node secildi`;
        document.body.appendChild(notification);

        // 2 saniye sonra kaldir
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    $('#workflow-select').addEventListener('change', async (e) => {
        const workflowId = e.target.value;
        console.log('[Workflow] Secilen ID:', workflowId);
        if (workflowId) {
            try {
                const workflow = await ipcRenderer.invoke('get-workflow', parseInt(workflowId));
                console.log('[Workflow] Veritabanindan gelen:', workflow);
                if (workflow) {
                    loadWorkflowToCanvas(workflow);
                    // Edit butonunu goster
                    $('#edit-workflow-btn').style.display = '';
                } else {
                    showWarning('Workflow bulunamadi');
                }
            } catch (error) {
                console.error('[Workflow] Yukleme hatasi:', error);
                showError('Workflow yuklenirken hata: ' + error.message);
            }
        } else {
            clearCanvas();
            // Edit butonunu gizle
            $('#edit-workflow-btn').style.display = 'none';
        }
    });

    $('#set-default-workflow-btn').addEventListener('click', async () => {
        const workflowId = $('#workflow-select').value;
        if (!workflowId) {
            showWarning('Lutfen bir workflow secin');
            return;
        }
        await ipcRenderer.invoke('set-default-workflow', parseInt(workflowId));
        showSuccess('Varsayilan workflow ayarlandi');
    });

    // Workflow Disari Aktar
    $('#export-workflow-btn').addEventListener('click', async () => {
        if (!state.currentWorkflow && state.nodes.length === 0) {
            showWarning('Disa aktarilacak workflow yok');
            return;
        }

        const workflowData = {
            name: state.currentWorkflow?.name || 'Isimsiz Workflow',
            description: state.currentWorkflow?.description || '',
            nodes: state.nodes,
            edges: state.edges
        };

        const result = await ipcRenderer.invoke('export-workflow', workflowData);
        if (result.success) {
            showSuccess('Workflow basariyla disa aktarildi');
        } else if (!result.canceled) {
            showError('Disa aktarma hatasi: ' + result.error);
        }
    });

    // Workflow Iceri Aktar
    $('#import-workflow-btn').addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('import-workflow');
        if (result.success) {
            // Yeni workflow olarak kaydet
            const workflow = result.workflow;

            // Canvas'i temizle ve workflow'u yukle
            clearCanvas();

            // Node'lari ekle
            for (const node of workflow.nodes) {
                state.nodes.push(node);
                if (node.id.startsWith('node-')) {
                    const idNum = parseInt(node.id.replace('node-', ''));
                    if (idNum >= state.nodeIdCounter) {
                        state.nodeIdCounter = idNum + 1;
                    }
                }
            }

            // Edge'leri ekle
            state.edges = workflow.edges || [];

            // Render et
            renderNodes();
            updateConnections();

            // Workflow bilgilerini guncelle
            $('#workflow-name').value = workflow.name || '';
            $('#workflow-description').value = workflow.description || '';

            showSuccess(`"${workflow.name}" workflow'u iceri aktarildi. Kaydetmek icin "Kaydet" butonuna basin.`);
        } else if (!result.canceled) {
            showError('Iceri aktarma hatasi: ' + result.error);
        }
    });

    // Akisi Test Et butonu
    $('#test-workflow-btn').addEventListener('click', testWorkflow);

    // Zoom kontrolleri
    $('#zoom-in-btn').addEventListener('click', () => zoomCanvas(0.1));
    $('#zoom-out-btn').addEventListener('click', () => zoomCanvas(-0.1));
    $('#zoom-reset-btn').addEventListener('click', resetCanvasView);
    $('#focus-nodes-btn').addEventListener('click', focusOnNodes);

    // Node duzenleme kontrolleri
    $('#arrange-nodes-btn').addEventListener('click', arrangeNodesVertically);
    $('#select-all-btn').addEventListener('click', selectAllNodes);
    $('#clear-selection-btn').addEventListener('click', clearMultiSelection);

    // Selection toolbar butonlari
    $('#copy-selected-btn').addEventListener('click', copySelectedNodes);
    $('#delete-selected-btn').addEventListener('click', deleteSelectedNodes);

    // Renk butonlari
    $$('#selection-toolbar .color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            applyColorToSelectedNodes(color);
        });
    });

    // Mouse wheel ile zoom ve pan
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        if (e.ctrlKey) {
            // Ctrl+Scroll: Zoom
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            zoomCanvas(delta);
        } else if (e.shiftKey) {
            // Shift+Scroll: Yatay pan
            state.panX -= e.deltaY;
            applyCanvasTransform();
        } else {
            // Normal Scroll: Dikey pan
            state.panY -= e.deltaY;
            applyCanvasTransform();
        }
    });

    // Middle mouse button ile pan
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 1) { // Middle mouse
            e.preventDefault();
            state.isPanning = true;
            state.panStartX = e.clientX - state.panX;
            state.panStartY = e.clientY - state.panY;
            canvas.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (state.isPanning) {
            state.panX = e.clientX - state.panStartX;
            state.panY = e.clientY - state.panStartY;
            applyCanvasTransform();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button === 1 && state.isPanning) {
            state.isPanning = false;
            canvas.style.cursor = '';
        }
    });

    // Klavye kısayolları - Kopyala/Yapıştır
    document.addEventListener('keydown', (e) => {
        // Sadece workflow sayfasında çalış
        if (!$('#page-workflow').classList.contains('active')) return;

        // Input/textarea içindeyse çalışmasın
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Ctrl+C - Kopyala (coklu veya tekli)
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            if (state.selectedNodes.length > 0) {
                copySelectedNodes();
            } else if (state.selectedNode) {
                copySelectedNode();
            }
        }

        // Ctrl+V - Yapıştır (coklu veya tekli)
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            if (state.copiedNodes.length > 0) {
                pasteSelectedNodes();
            } else if (state.copiedNode) {
                pasteNode();
            }
        }

        // Delete - Sil (coklu veya tekli)
        if (e.key === 'Delete') {
            if (state.selectedNodes.length > 0) {
                deleteSelectedNodes();
            } else if (state.selectedNode) {
                deleteNode(state.selectedNode);
            }
        }

        // Ctrl+D - Çoğalt (duplicate)
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            if (state.selectedNodes.length > 0) {
                copySelectedNodes();
                pasteSelectedNodes();
            } else if (state.selectedNode) {
                duplicateSelectedNode();
            }
        }

        // Ctrl+A - Tumunu sec
        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            selectAllNodes();
        }

        // Escape - Secimi temizle
        if (e.key === 'Escape') {
            clearMultiSelection();
            selectNode(null);
        }
    });
}

async function testWorkflow() {
    if (state.nodes.length === 0) {
        showWarning('Test edilecek node yok. Once node ekleyin.');
        return;
    }

    if (!confirm('Akis test edilecek. Devam etmek istiyor musunuz?')) {
        return;
    }

    try {
        // 3 saniye bekle - kullanici hazirlansin
        showInfo('3 saniye sonra akis basliyor. Pencereyi minimize edin veya test alanina tiklayin.');

        const result = await ipcRenderer.invoke('test-workflow', {
            nodes: state.nodes,
            edges: state.edges
        });

        if (result.success) {
            showSuccess('Akis testi basariyla tamamlandi!');
        } else {
            showError('Akis testi hatasi: ' + result.error);
        }
    } catch (error) {
        console.error('[Workflow Test] Hata:', error);
        showError('Akis testi sirasinda hata: ' + error.message);
    }
}

async function loadWorkflows() {
    state.workflows = await ipcRenderer.invoke('get-workflows');
    const select = $('#workflow-select');

    select.innerHTML = '<option value="">Yeni Workflow</option>' +
        state.workflows.map(w => `<option value="${w.id}">${w.name}${w.is_default ? ' (Varsayilan)' : ''}</option>`).join('');
}

function addNode(type, x, y) {
    const node = {
        id: `node_${++state.nodeIdCounter}`,
        type,
        position: { x, y },
        data: getDefaultNodeData(type)
    };

    state.nodes.push(node);
    renderNode(node);
    selectNode(node.id);
}

function getDefaultNodeData(type) {
    const defaults = {
        mouseClick: { x: 0, y: 0, button: 'left', delayBefore: 0, delayAfter: 0.5, label: '', color: '' },
        mouseDoubleClick: { x: 0, y: 0, delayBefore: 0, delayAfter: 0.5, label: '', color: '' },
        mouseMove: { x: 0, y: 0, delayBefore: 0, delayAfter: 0.3, label: '', color: '' },
        mouseScroll: { amount: 3, delayBefore: 0, delayAfter: 0.3, label: '', color: '' },
        mouseDrag: { startX: 0, startY: 0, endX: 100, endY: 100, duration: 500, delayBefore: 0, delayAfter: 0.5, label: '', color: '' },
        keyPress: { key: 'ENTER', delayBefore: 0, delayAfter: 0.3, label: '', color: '' },
        keyCombo: { keys: ['CTRL', 'V'], delayBefore: 0, delayAfter: 0.3, label: '', color: '' },
        typeText: { text: '', slow: false, charDelay: 50, delayBefore: 0, delayAfter: 0.5, label: '', color: '' },
        launchProgram: { exePath: '', useDynamic: true, waitAfterLaunch: 3, delayBefore: 0, delayAfter: 0, label: '', color: '' },
        closeProgram: { processName: 'Telegram.exe', usePid: true, delayBefore: 0, delayAfter: 0.5, label: '', color: '' },
        maximizeWindow: { delayBefore: 0.5, delayAfter: 0.5, label: '', color: '' },
        delay: { duration: 1, label: '', color: '' },
        randomDelay: { minDuration: 1, maxDuration: 3, label: '', color: '' },
        pasteChannelLinks: { delayBefore: 0, delayAfter: 0.5, channelCount: 5, label: '', color: '' }
    };
    return defaults[type] || { label: '', color: '' };
}

function getNodeLabel(type) {
    const labels = {
        mouseClick: 'Tiklama',
        mouseDoubleClick: 'Cift Tiklama',
        mouseMove: 'Mouse Hareket',
        mouseScroll: 'Scroll',
        mouseDrag: 'Surukle',
        keyPress: 'Tus Bas',
        keyCombo: 'Kombinasyon',
        typeText: 'Metin Yaz',
        launchProgram: 'Program Ac',
        closeProgram: 'Program Kapat',
        maximizeWindow: 'Tam Ekran',
        delay: 'Bekle',
        randomDelay: 'Rastgele Bekle',
        pasteChannelLinks: 'Kanal Link Yapistir'
    };
    return labels[type] || type;
}

function getNodeIcon(type) {
    const icons = {
        mouseClick: 'mouse-pointer',
        mouseDoubleClick: 'mouse',
        mouseMove: 'arrows-alt',
        mouseScroll: 'scroll',
        mouseDrag: 'hand-rock',
        keyPress: 'keyboard',
        keyCombo: 'layer-group',
        typeText: 'font',
        launchProgram: 'rocket',
        closeProgram: 'times-circle',
        maximizeWindow: 'expand',
        delay: 'clock',
        randomDelay: 'random',
        pasteChannelLinks: 'paste'
    };
    return icons[type] || 'circle';
}

function renderNode(node) {
    const container = $('#nodes-container');
    const nodeEl = document.createElement('div');
    nodeEl.className = 'workflow-node';
    nodeEl.id = node.id;
    nodeEl.style.left = `${node.position.x}px`;
    nodeEl.style.top = `${node.position.y}px`;

    // Renk desteği
    if (node.data.color) {
        nodeEl.dataset.color = node.data.color;
    }

    // Ozel baslik varsa onu goster, yoksa varsayilan etiketi goster
    const displayLabel = node.data.label || getNodeLabel(node.type);

    nodeEl.innerHTML = `
        <div class="node-handle input" data-handle="input"></div>
        <div class="node-header">
            <i class="fas fa-${getNodeIcon(node.type)}"></i>
            <span class="node-title">${displayLabel}</span>
        </div>
        <div class="node-body">${getNodeSummary(node)}</div>
        <div class="node-handle output" data-handle="output"></div>
    `;

    let isDragging = false;
    let hasDragged = false; // Gercekten suruklenip suruklenmedigi
    let startX, startY, initialX, initialY;
    let initialPositions = {}; // Coklu surukleme icin baslangic pozisyonlari

    nodeEl.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('node-handle')) return;

        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;
        initialX = node.position.x;
        initialY = node.position.y;
        nodeEl.style.zIndex = 1000;

        // Eger bu node coklu secimde ise, tum secili node'larin baslangic pozisyonlarini kaydet
        if (state.selectedNodes.includes(node.id) && state.selectedNodes.length > 0) {
            initialPositions = {};
            state.selectedNodes.forEach(nodeId => {
                const n = state.nodes.find(nd => nd.id === nodeId);
                if (n) {
                    initialPositions[nodeId] = { x: n.position.x, y: n.position.y };
                    const el = $(`#${nodeId}`);
                    if (el) el.style.zIndex = 1000;
                }
            });
            console.log('[MultiDrag] ' + state.selectedNodes.length + ' node suruklenmeye basladi');
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = (e.clientX - startX) / state.zoom;
        const dy = (e.clientY - startY) / state.zoom;

        // En az 3 piksel hareket edildiyse surukleme sayilir
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasDragged = true;
        }

        // Eger bu node coklu secimde ise, tum secili node'lari tasi
        if (state.selectedNodes.includes(node.id) && Object.keys(initialPositions).length > 0) {
            state.selectedNodes.forEach(nodeId => {
                const n = state.nodes.find(nd => nd.id === nodeId);
                if (n && initialPositions[nodeId]) {
                    n.position.x = initialPositions[nodeId].x + dx;
                    n.position.y = initialPositions[nodeId].y + dy;
                    const el = $(`#${nodeId}`);
                    if (el) {
                        el.style.left = `${n.position.x}px`;
                        el.style.top = `${n.position.y}px`;
                    }
                }
            });
        } else {
            // Tekli surukleme
            node.position.x = initialX + dx;
            node.position.y = initialY + dy;
            nodeEl.style.left = `${node.position.x}px`;
            nodeEl.style.top = `${node.position.y}px`;
        }
        updateConnections();
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            // Z-index'leri sifirla
            if (state.selectedNodes.includes(node.id)) {
                state.selectedNodes.forEach(nodeId => {
                    const el = $(`#${nodeId}`);
                    if (el) el.style.zIndex = '';
                });
            }
            initialPositions = {};
        }
        isDragging = false;
        nodeEl.style.zIndex = '';
    });

    nodeEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('node-handle')) {
            // Eger surukleme yapildiysa click'i ignore et
            if (hasDragged) {
                hasDragged = false;
                return;
            }

            // Ctrl+Click: Coklu secim
            if (e.ctrlKey) {
                toggleMultiSelect(node.id);
            } else {
                // Eger bu node zaten multi-selected ise ve baska secili node'lar varsa
                // secimi temizleme (toplu tasima yapilabilir)
                if (state.selectedNodes.includes(node.id) && state.selectedNodes.length > 1) {
                    // Secimi koru, sadece bu node'u ana secili yap
                    selectNode(node.id);
                    // multi-selected class'larini koru
                    state.selectedNodes.forEach(id => {
                        const el = $(`#${id}`);
                        if (el) el.classList.add('multi-selected');
                    });
                    updateSelectionToolbar();
                } else {
                    // Normal click: tekli secim, coklu secimi temizle
                    clearMultiSelection();
                    selectNode(node.id);
                }
            }
        }
    });

    const handles = nodeEl.querySelectorAll('.node-handle');
    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (handle.dataset.handle === 'output') {
                startConnection(node.id, e);
            }
        });

        handle.addEventListener('mouseup', (e) => {
            if (state.isConnecting && handle.dataset.handle === 'input') {
                finishConnection(node.id);
            }
        });
    });

    nodeEl.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' && state.selectedNode === node.id) {
            deleteNode(node.id);
        }
    });

    nodeEl.setAttribute('tabindex', '0');
    container.appendChild(nodeEl);
}

function getNodeSummary(node) {
    const { type, data } = node;

    switch (type) {
        case 'mouseClick':
        case 'mouseDoubleClick':
        case 'mouseMove':
            return `X: ${data.x}, Y: ${data.y}`;
        case 'keyPress':
            return `Tus: ${data.key}`;
        case 'keyCombo':
            return data.keys?.join(' + ') || '';
        case 'typeText':
            return data.text?.substring(0, 20) + (data.text?.length > 20 ? '...' : '') || 'Metin';
        case 'delay':
            return `${data.duration} saniye`;
        case 'randomDelay':
            return `${data.minDuration}-${data.maxDuration} saniye`;
        case 'launchProgram':
            return data.useDynamic ? 'Dinamik (Hesap)' : (data.exePath?.split('\\').pop() || 'Program');
        case 'closeProgram':
            return data.processName || 'Program';
        default:
            return '';
    }
}

function selectNode(nodeId) {
    $$('.workflow-node').forEach(n => n.classList.remove('selected'));

    state.selectedNode = nodeId;

    if (nodeId) {
        const nodeEl = $(`#${nodeId}`);
        if (nodeEl) {
            nodeEl.classList.add('selected');
            nodeEl.focus();
        }
        renderNodeProperties(nodeId);
    } else {
        renderEmptyProperties();
    }
}

function renderNodeProperties(nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const container = $('.properties-content');

    // Node baslik ve renk duzenleme alani - tum node'lar icin ortak
    const currentColor = node.data.color || '';
    let html = `
        <div class="form-group">
            <label>Node Basligi</label>
            <input type="text" class="form-input" id="prop-label" value="${node.data.label || ''}" placeholder="${getNodeLabel(node.type)}">
            <small>Bos birakirsaniz varsayilan baslik kullanilir</small>
        </div>
        <div class="form-group">
            <label>Node Rengi</label>
            <div class="node-color-picker">
                <button class="color-btn ${currentColor === '' ? 'active' : ''}" data-color="" style="background: var(--accent-primary);" title="Varsayilan"></button>
                <button class="color-btn ${currentColor === '#0ea5e9' ? 'active' : ''}" data-color="#0ea5e9" style="background: #0ea5e9;" title="Mavi"></button>
                <button class="color-btn ${currentColor === '#22c55e' ? 'active' : ''}" data-color="#22c55e" style="background: #22c55e;" title="Yesil"></button>
                <button class="color-btn ${currentColor === '#f59e0b' ? 'active' : ''}" data-color="#f59e0b" style="background: #f59e0b;" title="Turuncu"></button>
                <button class="color-btn ${currentColor === '#ef4444' ? 'active' : ''}" data-color="#ef4444" style="background: #ef4444;" title="Kirmizi"></button>
                <button class="color-btn ${currentColor === '#8b5cf6' ? 'active' : ''}" data-color="#8b5cf6" style="background: #8b5cf6;" title="Mor"></button>
                <button class="color-btn ${currentColor === '#ec4899' ? 'active' : ''}" data-color="#ec4899" style="background: #ec4899;" title="Pembe"></button>
                <button class="color-btn ${currentColor === '#6b7280' ? 'active' : ''}" data-color="#6b7280" style="background: #6b7280;" title="Gri"></button>
            </div>
        </div>
        <hr style="margin: 15px 0; border-color: var(--border-color);">
    `;

    switch (node.type) {
        case 'mouseClick':
        case 'mouseDoubleClick':
        case 'mouseMove':
            html += `
                <div class="form-group">
                    <label>X Koordinati</label>
                    <div class="input-with-button">
                        <input type="number" class="form-input" id="prop-x" value="${node.data.x}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Y Koordinati</label>
                    <div class="input-with-button">
                        <input type="number" class="form-input" id="prop-y" value="${node.data.y}">
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn-primary" onclick="pickBothCoordinates()">
                        <i class="fas fa-crosshairs"></i> Koordinat Sec
                    </button>
                </div>
                ${node.type === 'mouseClick' ? `
                <div class="form-group">
                    <label>Buton</label>
                    <select class="form-select" id="prop-button">
                        <option value="left" ${node.data.button === 'left' ? 'selected' : ''}>Sol</option>
                        <option value="right" ${node.data.button === 'right' ? 'selected' : ''}>Sag</option>
                        <option value="middle" ${node.data.button === 'middle' ? 'selected' : ''}>Orta</option>
                    </select>
                </div>
                ` : ''}
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'mouseScroll':
            html += `
                <div class="form-group">
                    <label>Scroll Miktari (pozitif=yukari, negatif=asagi)</label>
                    <input type="number" class="form-input" id="prop-amount" value="${node.data.amount}">
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'keyPress':
            html += `
                <div class="form-group">
                    <label>Tus</label>
                    <select class="form-select" id="prop-key">
                        ${getKeyOptions(node.data.key)}
                    </select>
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'keyCombo':
            html += `
                <div class="form-group">
                    <label>Tus Kombinasyonu</label>
                    <input type="text" class="form-input" id="prop-keys"
                           value="${node.data.keys?.join(', ') || ''}"
                           placeholder="CTRL, V">
                    <small>Virgulla ayirin: CTRL, SHIFT, A</small>
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'typeText':
            html += `
                <div class="form-group">
                    <label>Metin</label>
                    <textarea class="form-textarea" id="prop-text" rows="3">${node.data.text || ''}</textarea>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="prop-slow" ${node.data.slow ? 'checked' : ''}>
                        Yavas yazma (karakter karakter)
                    </label>
                </div>
                <div class="form-group" id="char-delay-group" style="${node.data.slow ? '' : 'display:none'}">
                    <label>Karakter Gecikmesi (ms)</label>
                    <input type="number" class="form-input" id="prop-charDelay" value="${node.data.charDelay || 50}">
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'launchProgram':
            html += `
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="prop-useDynamic" ${node.data.useDynamic ? 'checked' : ''}>
                        Dinamik exe yolu kullan (mevcut hesaptan)
                    </label>
                </div>
                <div class="form-group" id="exe-path-group" style="${node.data.useDynamic ? 'display:none' : ''}">
                    <label>Program Yolu</label>
                    <div class="input-with-button">
                        <input type="text" class="form-input" id="prop-exePath" value="${node.data.exePath || ''}">
                        <button class="btn btn-secondary" onclick="browseExe()">Sec</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Acilis Sonrasi Bekleme (saniye)</label>
                    <input type="number" class="form-input" id="prop-waitAfterLaunch"
                           value="${node.data.waitAfterLaunch || 3}" min="0" step="0.5">
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'closeProgram':
            html += `
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="prop-usePid" ${node.data.usePid ? 'checked' : ''}>
                        PID ile kapat (acilan process)
                    </label>
                </div>
                <div class="form-group" id="process-name-group" style="${node.data.usePid ? 'display:none' : ''}">
                    <label>Process Adi</label>
                    <input type="text" class="form-input" id="prop-processName"
                           value="${node.data.processName || 'Telegram.exe'}">
                </div>
                ${renderDelayFields(node.data)}
            `;
            break;

        case 'delay':
            html += `
                <div class="form-group">
                    <label>Bekleme Suresi (saniye)</label>
                    <input type="number" class="form-input" id="prop-duration"
                           value="${node.data.duration}" min="0" step="0.1">
                </div>
            `;
            break;

        case 'randomDelay':
            html += `
                <div class="form-group">
                    <label>Minimum Sure (saniye)</label>
                    <input type="number" class="form-input" id="prop-minDuration"
                           value="${node.data.minDuration}" min="0" step="0.1">
                </div>
                <div class="form-group">
                    <label>Maximum Sure (saniye)</label>
                    <input type="number" class="form-input" id="prop-maxDuration"
                           value="${node.data.maxDuration}" min="0" step="0.1">
                </div>
            `;
            break;

        case 'maximizeWindow':
            html += renderDelayFields(node.data);
            break;

        case 'pasteChannelLinks':
            html += `
                <div class="form-group">
                    <label>Yapistirılacak Kanal Sayisi</label>
                    <input type="number" class="form-input" id="prop-channelCount"
                           value="${node.data.channelCount || 5}" min="1" max="50">
                    <small>Rastgele secilecek kanal sayisi (varsayilan: 5)</small>
                </div>
            `;
            html += renderDelayFields(node.data);
            break;
    }

    html += `
        <div class="form-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border-color);">
            <button class="btn btn-secondary" onclick="testCurrentNode()">
                <i class="fas fa-play"></i> Test Et
            </button>
            <button class="btn btn-secondary" onclick="duplicateSelectedNode()" title="Ctrl+D">
                <i class="fas fa-copy"></i> Kopyala
            </button>
            <button class="btn btn-danger" onclick="deleteSelectedNode()">
                <i class="fas fa-trash"></i> Sil
            </button>
        </div>
    `;

    container.innerHTML = html;
    setupPropertyListeners(node);
}

function renderDelayFields(data) {
    return `
        <div class="form-group">
            <label>Oncesi Bekleme (saniye)</label>
            <input type="number" class="form-input" id="prop-delayBefore"
                   value="${data.delayBefore || 0}" min="0" step="0.1">
        </div>
        <div class="form-group">
            <label>Sonrasi Bekleme (saniye)</label>
            <input type="number" class="form-input" id="prop-delayAfter"
                   value="${data.delayAfter || 0}" min="0" step="0.1">
        </div>
    `;
}

function getKeyOptions(selectedKey) {
    const keys = [
        'ENTER', 'TAB', 'SPACE', 'BACKSPACE', 'DELETE', 'ESCAPE',
        'UP', 'DOWN', 'LEFT', 'RIGHT',
        'HOME', 'END', 'PAGE_UP', 'PAGE_DOWN',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
        'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ];
    return keys.map(k => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${k}</option>`).join('');
}

function setupPropertyListeners(node) {
    const updateNode = () => {
        const nodeEl = $(`#${node.id}`);
        if (nodeEl) {
            nodeEl.querySelector('.node-body').textContent = getNodeSummary(node);
        }
    };

    const updateNodeTitle = () => {
        const nodeEl = $(`#${node.id}`);
        if (nodeEl) {
            const displayLabel = node.data.label || getNodeLabel(node.type);
            nodeEl.querySelector('.node-title').textContent = displayLabel;
        }
    };

    // Label listener
    const labelEl = $('#prop-label');
    if (labelEl) {
        labelEl.addEventListener('change', () => {
            node.data.label = labelEl.value.trim();
            updateNodeTitle();
        });
        labelEl.addEventListener('input', () => {
            node.data.label = labelEl.value.trim();
            updateNodeTitle();
        });
    }

    const handleInput = (id, prop, transform = v => v) => {
        const el = $(`#${id}`);
        if (el) {
            el.addEventListener('change', () => {
                node.data[prop] = transform(el.type === 'checkbox' ? el.checked : el.value);
                updateNode();
            });
        }
    };

    handleInput('prop-x', 'x', v => parseInt(v) || 0);
    handleInput('prop-y', 'y', v => parseInt(v) || 0);
    handleInput('prop-button', 'button');
    handleInput('prop-amount', 'amount', v => parseInt(v) || 0);
    handleInput('prop-key', 'key');
    handleInput('prop-keys', 'keys', v => v.split(',').map(k => k.trim().toUpperCase()));
    handleInput('prop-text', 'text');
    handleInput('prop-slow', 'slow');
    handleInput('prop-charDelay', 'charDelay', v => parseInt(v) || 50);
    handleInput('prop-useDynamic', 'useDynamic');
    handleInput('prop-exePath', 'exePath');
    handleInput('prop-waitAfterLaunch', 'waitAfterLaunch', v => parseFloat(v) || 3);
    handleInput('prop-usePid', 'usePid');
    handleInput('prop-processName', 'processName');
    handleInput('prop-duration', 'duration', v => parseFloat(v) || 1);
    handleInput('prop-minDuration', 'minDuration', v => parseFloat(v) || 1);
    handleInput('prop-maxDuration', 'maxDuration', v => parseFloat(v) || 3);
    handleInput('prop-delayBefore', 'delayBefore', v => parseFloat(v) || 0);
    handleInput('prop-delayAfter', 'delayAfter', v => parseFloat(v) || 0);
    handleInput('prop-channelCount', 'channelCount', v => parseInt(v) || 5);

    const slowCheck = $('#prop-slow');
    if (slowCheck) {
        slowCheck.addEventListener('change', () => {
            $('#char-delay-group').style.display = slowCheck.checked ? '' : 'none';
        });
    }

    const useDynamic = $('#prop-useDynamic');
    if (useDynamic) {
        useDynamic.addEventListener('change', () => {
            $('#exe-path-group').style.display = useDynamic.checked ? 'none' : '';
        });
    }

    const usePid = $('#prop-usePid');
    if (usePid) {
        usePid.addEventListener('change', () => {
            $('#process-name-group').style.display = usePid.checked ? 'none' : '';
        });
    }

    // Renk butonlari
    $$('.node-color-picker .color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            node.data.color = color;

            // Tum butonlardan active sil, tiklanana ekle
            $$('.node-color-picker .color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Node element'ini guncelle
            const nodeEl = $(`#${node.id}`);
            if (nodeEl) {
                if (color) {
                    nodeEl.dataset.color = color;
                } else {
                    delete nodeEl.dataset.color;
                }
            }
        });
    });
}

function renderEmptyProperties() {
    $('.properties-content').innerHTML = '<p class="empty-state">Bir node secin</p>';
}

function startConnection(sourceId, e) {
    state.isConnecting = true;
    state.connectionStart = sourceId;

    const svg = $('#connections-svg');
    const sourceNode = state.nodes.find(n => n.id === sourceId);
    if (!sourceNode) return;

    const nodeWidth = 180;
    const nodeHeight = 80;

    const startX = sourceNode.position.x + nodeWidth / 2;
    const startY = sourceNode.position.y + nodeHeight;

    state.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    state.tempLine.classList.add('connection-line', 'temp');
    state.tempLine.setAttribute('d', `M${startX},${startY} L${startX},${startY}`);
    svg.appendChild(state.tempLine);

    const mouseMoveHandler = (e) => {
        if (!state.isConnecting) return;
        const canvas = $('#workflow-canvas');
        const canvasRect = canvas.getBoundingClientRect();

        // Mouse pozisyonunu canvas koordinatina cevir (transform'u hesaba kat)
        const mouseX = (e.clientX - canvasRect.left - state.panX) / state.zoom;
        const mouseY = (e.clientY - canvasRect.top - state.panY) / state.zoom;

        state.tempLine.setAttribute('d', `M${startX},${startY} C${startX},${startY + 50} ${mouseX},${mouseY - 50} ${mouseX},${mouseY}`);
    };

    const mouseUpHandler = () => {
        state.isConnecting = false;
        if (state.tempLine) {
            state.tempLine.remove();
            state.tempLine = null;
        }
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
}

function finishConnection(targetId) {
    if (state.connectionStart && state.connectionStart !== targetId) {
        const exists = state.edges.some(e =>
            e.source === state.connectionStart && e.target === targetId
        );

        if (!exists) {
            state.edges.push({
                id: `edge_${state.connectionStart}_${targetId}`,
                source: state.connectionStart,
                target: targetId
            });
            updateConnections();
        }
    }
}

function updateConnections() {
    const svg = $('#connections-svg');

    svg.querySelectorAll('.connection-line:not(.temp)').forEach(el => el.remove());

    for (const edge of state.edges) {
        const sourceNode = state.nodes.find(n => n.id === edge.source);
        const targetNode = state.nodes.find(n => n.id === edge.target);

        if (!sourceNode || !targetNode) continue;

        // Node pozisyonlarini dogrudan kullan (transform'dan bagimsiz)
        const nodeWidth = 180;
        const nodeHeight = 80;

        const startX = sourceNode.position.x + nodeWidth / 2;
        const startY = sourceNode.position.y + nodeHeight;
        const endX = targetNode.position.x + nodeWidth / 2;
        const endY = targetNode.position.y;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('connection-line');
        path.setAttribute('d', `M${startX},${startY} C${startX},${startY + 50} ${endX},${endY - 50} ${endX},${endY}`);
        path.dataset.edgeId = edge.id;
        svg.appendChild(path);
    }
}

function deleteNode(nodeId) {
    state.nodes = state.nodes.filter(n => n.id !== nodeId);
    state.edges = state.edges.filter(e => e.source !== nodeId && e.target !== nodeId);

    const nodeEl = $(`#${nodeId}`);
    if (nodeEl) nodeEl.remove();

    updateConnections();

    if (state.selectedNode === nodeId) {
        selectNode(null);
    }
}

function clearCanvas() {
    state.nodes = [];
    state.edges = [];
    state.nodeIdCounter = 0;
    $('#nodes-container').innerHTML = '';
    $('#connections-svg').innerHTML = '';
    selectNode(null);
}

function loadWorkflowToCanvas(workflow) {
    try {
        console.log('[Workflow] Yukleniyor:', workflow);
        clearCanvas();

        state.currentWorkflow = workflow;
        state.nodes = workflow.nodes || [];
        state.edges = workflow.edges || [];

        console.log('[Workflow] Node sayisi:', state.nodes.length);
        console.log('[Workflow] Edge sayisi:', state.edges.length);

        state.nodeIdCounter = state.nodes.reduce((max, n) => {
            const num = parseInt(n.id.replace('node_', '')) || 0;
            return Math.max(max, num);
        }, 0);

        for (const node of state.nodes) {
            console.log('[Workflow] Node render ediliyor:', node.id, node.type);
            renderNode(node);
        }

        updateConnections();
        console.log('[Workflow] Basariyla yuklendi');
    } catch (error) {
        console.error('[Workflow] Yukleme hatasi:', error);
        showError('Workflow yuklenirken hata: ' + error.message);
    }
}

async function saveWorkflow() {
    try {
        const name = $('#workflow-name').value.trim();

        if (!name) {
            showWarning('Lutfen workflow adini girin');
            return;
        }

        if (state.nodes.length === 0) {
            showWarning('Workflow bos olamaz');
            return;
        }

        const description = $('#workflow-description').value.trim();

        console.log('[Workflow] Kaydediliyor:', { name, nodes: state.nodes, edges: state.edges });

        let result;

        // Eger mevcut workflow varsa guncelle, yoksa yeni olustur
        if (state.currentWorkflow && state.currentWorkflow.id) {
            console.log('[Workflow] Mevcut workflow guncelleniyor, ID:', state.currentWorkflow.id);

            // Onece workflow node/edge'lerini guncelle
            result = await ipcRenderer.invoke('update-workflow', {
                id: state.currentWorkflow.id,
                nodes: state.nodes,
                edges: state.edges
            });

            // Sonra isim/aciklamayi guncelle
            if (result.success) {
                await ipcRenderer.invoke('rename-workflow', {
                    id: state.currentWorkflow.id,
                    name,
                    description
                });
                // State'i guncelle
                state.currentWorkflow.name = name;
                state.currentWorkflow.description = description;
            }
        } else {
            result = await ipcRenderer.invoke('save-workflow', {
                name,
                nodes: state.nodes,
                edges: state.edges,
                description
            });

            // Yeni workflow kaydedildiyse current workflow'u ayarla
            if (result.success && result.id) {
                state.currentWorkflow = { id: result.id, name, description };
            }
        }

        console.log('[Workflow] Kaydetme sonucu:', result);

        if (result.success) {
            hideModal('save-workflow-modal');
            await loadWorkflows();

            // Secili workflow'u koru
            if (state.currentWorkflow && state.currentWorkflow.id) {
                $('#workflow-select').value = state.currentWorkflow.id;
                $('#edit-workflow-btn').style.display = '';
            }

            showSuccess('Workflow kaydedildi');
        } else {
            showError('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('[Workflow] Kaydetme hatasi:', error);
        showError('Workflow kaydedilirken hata: ' + error.message);
    }
}

async function renameWorkflow() {
    try {
        if (!state.currentWorkflow || !state.currentWorkflow.id) {
            showWarning('Duzenlenecek workflow secilmedi');
            return;
        }

        const name = $('#rename-workflow-name').value.trim();
        if (!name) {
            showWarning('Lutfen workflow adini girin');
            return;
        }

        const description = $('#rename-workflow-description').value.trim();

        const result = await ipcRenderer.invoke('rename-workflow', {
            id: state.currentWorkflow.id,
            name,
            description
        });

        if (result.success) {
            state.currentWorkflow.name = name;
            state.currentWorkflow.description = description;
            hideModal('rename-workflow-modal');
            await loadWorkflows();
            $('#workflow-select').value = state.currentWorkflow.id;
            showSuccess('Workflow guncellendi');
        } else {
            showError('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('[Workflow] Yeniden adlandirma hatasi:', error);
        showError('Workflow guncellenirken hata: ' + error.message);
    }
}

async function deleteCurrentWorkflow() {
    try {
        if (!state.currentWorkflow || !state.currentWorkflow.id) {
            showWarning('Silinecek workflow secilmedi');
            return;
        }

        if (!confirm(`"${state.currentWorkflow.name}" workflow'unu silmek istediginizden emin misiniz?`)) {
            return;
        }

        const result = await ipcRenderer.invoke('delete-workflow', state.currentWorkflow.id);

        if (result.success) {
            hideModal('rename-workflow-modal');
            clearCanvas();
            state.currentWorkflow = null;
            $('#edit-workflow-btn').style.display = 'none';
            await loadWorkflows();
            showSuccess('Workflow silindi');
        } else {
            showError('Hata: ' + result.error);
        }
    } catch (error) {
        console.error('[Workflow] Silme hatasi:', error);
        showError('Workflow silinirken hata: ' + error.message);
    }
}

window.pickBothCoordinates = async () => {
    showInfo('Pencere minimize edilecek. Koordinat secmek icin istediginiz yere tiklayin.');
    await ipcRenderer.invoke('minimize-window');

    setTimeout(async () => {
        const coord = await ipcRenderer.invoke('pick-coordinate');
        await ipcRenderer.invoke('restore-window');

        if (coord) {
            $('#prop-x').value = coord.x;
            $('#prop-y').value = coord.y;
            const node = state.nodes.find(n => n.id === state.selectedNode);
            if (node) {
                node.data.x = coord.x;
                node.data.y = coord.y;
                const nodeEl = $(`#${node.id}`);
                if (nodeEl) {
                    nodeEl.querySelector('.node-body').textContent = getNodeSummary(node);
                }
            }
        }
    }, 500);
};

window.browseExe = async () => {
    const exe = await ipcRenderer.invoke('browse-exe');
    if (exe) {
        $('#prop-exePath').value = exe;
        const node = state.nodes.find(n => n.id === state.selectedNode);
        if (node) {
            node.data.exePath = exe;
        }
    }
};

window.testCurrentNode = async () => {
    const node = state.nodes.find(n => n.id === state.selectedNode);
    if (!node) {
        console.error('[Test] Node bulunamadi');
        return;
    }

    console.log('[Test] Node test ediliyor:', node.type, node.data);

    try {
        const result = await ipcRenderer.invoke('test-action', {
            type: node.type,
            data: node.data
        });

        console.log('[Test] Sonuc:', result);

        if (!result.success) {
            console.error('[Test] Hata:', result.error);
            showError('Hata: ' + result.error);
        } else {
            console.log('[Test] Basarili');
        }
    } catch (error) {
        console.error('[Test] Exception:', error);
        showError('Test hatasi: ' + error.message);
    }
};

window.deleteSelectedNode = () => {
    if (state.selectedNode) {
        if (confirm('Bu node\'u silmek istediginizden emin misiniz?')) {
            deleteNode(state.selectedNode);
        }
    }
};

// ============ AUTOMATION CONTROLS ============
function initAutomationControls() {
    $('#start-automation-btn').addEventListener('click', startAutomation);
    $('#pause-automation-btn').addEventListener('click', pauseAutomation);
    $('#stop-automation-btn').addEventListener('click', stopAutomation);
    $('#quick-start-btn')?.addEventListener('click', startAutomation);
    $('#clear-logs-btn')?.addEventListener('click', clearLogs);
}

async function startAutomation() {
    // Secili workflow'u kontrol et
    const workflowSelect = $('#automation-workflow-select');
    const workflowId = workflowSelect?.value;

    if (!workflowId) {
        showWarning('Lutfen calistirilacak bir workflow secin');
        return;
    }

    const channelsPerAccount = parseInt($('#channels-per-account')?.value) || 5;
    const excludeRequested = $('#exclude-requested')?.checked !== false;

    const result = await ipcRenderer.invoke('start-automation', {
        workflowId: parseInt(workflowId),
        channelsPerAccount,
        excludeRequested
    });

    if (result.success) {
        updateAutomationUI(true);
        showSuccess('Otomasyon baslatildi');
    } else {
        showError('Hata: ' + result.error);
    }
}

async function pauseAutomation() {
    const status = await ipcRenderer.invoke('get-automation-status');

    if (status.isPaused) {
        await ipcRenderer.invoke('resume-automation');
        $('#pause-automation-btn').innerHTML = '<i class="fas fa-pause"></i> Duraklat';
    } else {
        await ipcRenderer.invoke('pause-automation');
        $('#pause-automation-btn').innerHTML = '<i class="fas fa-play"></i> Devam';
    }
}

async function stopAutomation() {
    if (confirm('Otomasyonu durdurmak istediginizden emin misiniz?')) {
        await ipcRenderer.invoke('stop-automation');
        updateAutomationUI(false);
    }
}

function updateAutomationUI(running) {
    $('#start-automation-btn').disabled = running;
    $('#pause-automation-btn').disabled = !running;
    $('#stop-automation-btn').disabled = !running;

    const statusDot = $('.status-dot');
    const statusText = $('.status-text');

    if (running) {
        statusDot.classList.add('running');
        statusText.textContent = 'Calisiyor';
        $('#live-status').textContent = 'Calisiyor';
    } else {
        statusDot.classList.remove('running', 'paused');
        statusText.textContent = 'Beklemede';
        $('#live-status').textContent = 'Beklemede';
        $('#pause-automation-btn').innerHTML = '<i class="fas fa-pause"></i> Duraklat';
    }
}

// ============ LOGS ============
async function loadLogs() {
    const logs = await ipcRenderer.invoke('get-logs', 500);
    renderLogs(logs);
}

function renderLogs(logs) {
    const container = $('#system-log-viewer');

    if (logs.length === 0) {
        container.innerHTML = '<p class="empty-state">Henuz log yok</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="log-entry ${log.status}">
            <span class="time">${formatDateTime(log.created_at)}</span>
            <span class="message">${log.action}${log.phone_number ? ` [${log.phone_number}]` : ''}</span>
        </div>
    `).join('');
}

async function clearLogs() {
    if (confirm('Tum loglari silmek istediginizden emin misiniz?')) {
        await ipcRenderer.invoke('clear-logs');
        loadLogs();
    }
}

// ============ HISTORY ============
async function loadHistory() {
    // Hesaplari yukle (filtre icin)
    await loadHistoryAccountFilter();

    // Gecmisi yukle
    const selectedAccountId = $('#history-account-filter')?.value;
    await refreshHistory(selectedAccountId || null);

    // Event listener'lari ekle
    initHistoryControls();
}

async function loadHistoryAccountFilter() {
    const accounts = await ipcRenderer.invoke('get-accounts');
    const select = $('#history-account-filter');

    if (!select) return;

    // Mevcut secimi koru
    const currentValue = select.value;

    select.innerHTML = '<option value="">Tum Hesaplar</option>';
    accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.id;
        option.textContent = acc.phone_number;
        select.appendChild(option);
    });

    // Onceki secimi geri yukle
    if (currentValue) {
        select.value = currentValue;
    }
}

async function refreshHistory(accountId = null) {
    let result;

    if (accountId) {
        result = await ipcRenderer.invoke('get-join-request-history-by-account', parseInt(accountId));
    } else {
        result = await ipcRenderer.invoke('get-join-request-history', 500);
    }

    if (!result.success) {
        showError('Gecmis yuklenemedi: ' + result.error);
        return;
    }

    const history = result.history || [];
    renderHistoryTable(history);
    updateHistoryStats(history);
}

function renderHistoryTable(history) {
    const tbody = $('#history-table-body');
    const badge = $('#history-count-badge');

    if (!tbody) return;

    if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Henuz istek gecmisi yok</td></tr>';
        if (badge) badge.textContent = '0 kayit';
        return;
    }

    if (badge) badge.textContent = `${history.length} kayit`;

    tbody.innerHTML = history.map(item => {
        const statusClass = item.status === 'success' ? 'success' :
                           item.status === 'failed' ? 'danger' :
                           item.status === 'sent' ? 'info' : 'warning';
        const statusText = item.status === 'success' ? 'Basarili' :
                          item.status === 'failed' ? 'Basarisiz' :
                          item.status === 'sent' ? 'Gonderildi' : 'Beklemede';

        return `
            <tr>
                <td>${item.phone_number || 'Bilinmiyor'}</td>
                <td class="channel-link">${item.channel_link || 'Silinmis kanal'}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${formatDateTime(item.requested_at)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteHistoryItem(${item.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateHistoryStats(history) {
    const total = history.length;
    const success = history.filter(h => h.status === 'success').length;
    const pending = history.filter(h => h.status === 'pending' || h.status === 'sent').length;
    const failed = history.filter(h => h.status === 'failed').length;

    const totalEl = $('#history-total-requests');
    const successEl = $('#history-success-requests');
    const pendingEl = $('#history-pending-requests');
    const failedEl = $('#history-failed-requests');

    if (totalEl) totalEl.textContent = total;
    if (successEl) successEl.textContent = success;
    if (pendingEl) pendingEl.textContent = pending;
    if (failedEl) failedEl.textContent = failed;
}

function initHistoryControls() {
    // Filtre degisikligi
    const filter = $('#history-account-filter');
    if (filter && !filter.dataset.initialized) {
        filter.addEventListener('change', () => {
            refreshHistory(filter.value || null);
        });
        filter.dataset.initialized = 'true';
    }

    // Yenile butonu
    const refreshBtn = $('#refresh-history-btn');
    if (refreshBtn && !refreshBtn.dataset.initialized) {
        refreshBtn.addEventListener('click', () => {
            const accountId = $('#history-account-filter')?.value;
            refreshHistory(accountId || null);
            showInfo('Gecmis yenilendi');
        });
        refreshBtn.dataset.initialized = 'true';
    }

    // Temizle butonu
    const clearBtn = $('#clear-history-btn');
    if (clearBtn && !clearBtn.dataset.initialized) {
        clearBtn.addEventListener('click', clearHistory);
        clearBtn.dataset.initialized = 'true';
    }
}

async function clearHistory() {
    const accountId = $('#history-account-filter')?.value;

    const message = accountId
        ? 'Bu hesabin tum istek gecmisini silmek istediginizden emin misiniz?'
        : 'TUM istek gecmisini silmek istediginizden emin misiniz?';

    if (!confirm(message)) return;

    let result;
    if (accountId) {
        result = await ipcRenderer.invoke('clear-join-requests-for-account', parseInt(accountId));
    } else {
        result = await ipcRenderer.invoke('clear-all-join-requests');
    }

    if (result.success) {
        showSuccess('Istek gecmisi temizlendi');
        refreshHistory(accountId || null);
    } else {
        showError('Hata: ' + result.error);
    }
}

async function deleteHistoryItem(id) {
    const result = await ipcRenderer.invoke('delete-join-request', id);

    if (result.success) {
        const accountId = $('#history-account-filter')?.value;
        refreshHistory(accountId || null);
    } else {
        showError('Silinemedi: ' + result.error);
    }
}

// ============ SETTINGS ============
async function loadSettings() {
    const settings = await ipcRenderer.invoke('get-settings');

    if (settings.defaultDelay !== undefined) {
        $('#default-delay').value = settings.defaultDelay;
    }
    if (settings.telegramLaunchDelay !== undefined) {
        $('#telegram-launch-delay').value = settings.telegramLaunchDelay;
    }
    if (settings.keepScreenAlive !== undefined) {
        $('#keep-screen-alive').checked = settings.keepScreenAlive;
    }
    if (settings.preventSleep !== undefined) {
        $('#prevent-sleep').checked = settings.preventSleep;
    }

    ['default-delay', 'telegram-launch-delay'].forEach(id => {
        $(`#${id}`).addEventListener('change', async (e) => {
            const key = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            await ipcRenderer.invoke('set-setting', { key, value: parseFloat(e.target.value) });
        });
    });

    ['keep-screen-alive', 'prevent-sleep'].forEach(id => {
        $(`#${id}`).addEventListener('change', async (e) => {
            const key = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            await ipcRenderer.invoke('set-setting', { key, value: e.target.checked });
        });
    });
}

// ============ IPC LISTENERS ============
function setupIpcListeners() {
    ipcRenderer.on('automation-event', (event, { event: eventName, data }) => {
        handleAutomationEvent(eventName, data);
    });
}

function handleAutomationEvent(eventName, data) {
    switch (eventName) {
        case 'automation_started':
            updateAutomationUI(true);
            addAutomationLog('Otomasyon baslatildi', 'info');
            break;

        case 'automation_stopped':
            updateAutomationUI(false);
            addAutomationLog('Otomasyon durduruldu', 'info');
            break;

        case 'automation_stopping':
            updateAutomationUI(false);
            addAutomationLog('Otomasyon durduruluyor...', 'warning');
            break;

        case 'automation_paused':
            $('.status-dot').classList.add('paused');
            $('.status-dot').classList.remove('running');
            $('#live-status').textContent = 'Duraklatildi';
            addAutomationLog('Otomasyon duraklatildi', 'warning');
            break;

        case 'automation_resumed':
            $('.status-dot').classList.remove('paused');
            $('.status-dot').classList.add('running');
            $('#live-status').textContent = 'Calisiyor';
            addAutomationLog('Otomasyon devam ediyor', 'info');
            break;

        case 'account_started':
            $('#live-account').textContent = data.phone;
            addAutomationLog(`Hesap aciliyor: ${data.phone}`, 'info');
            break;

        case 'account_completed':
            $('#live-processed').textContent = parseInt($('#live-processed').textContent) + 1;
            addAutomationLog(`Hesap tamamlandi: ${data.phone}`, 'success');
            break;

        case 'account_error':
            addAutomationLog(`Hesap hatasi: ${data.phone} - ${data.error}`, 'error');
            break;

        case 'sending_requests':
            $('#live-requests').textContent = parseInt($('#live-requests').textContent) + data.channels.length;
            addAutomationLog(`${data.channels.length} kanala istek gonderiliyor`, 'info');
            break;

        case 'loop_started':
            $('#live-loop').textContent = data.loop;
            addAutomationLog(`Loop ${data.loop} basladi (${data.accountCount} hesap)`, 'info');
            break;

        case 'all_completed':
            addAutomationLog('Tum hesaplar tum kanallara istek gonderdi!', 'success');
            break;

        case 'workflow_log':
            addAutomationLog(`[Workflow] ${data.message}`, 'info');
            break;
    }

    loadDashboard();
}

function addAutomationLog(message, status = 'info') {
    const container = $('#automation-log-viewer');
    const isEmpty = container.querySelector('.empty-state');
    if (isEmpty) {
        container.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${status}`;
    entry.innerHTML = `
        <span class="time">${formatTime(new Date())}</span>
        <span class="message">${message}</span>
    `;

    container.insertBefore(entry, container.firstChild);

    while (container.children.length > 100) {
        container.removeChild(container.lastChild);
    }
}

// ============ UTILITY FUNCTIONS ============
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR');
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('tr-TR');
}

function formatTime(date) {
    return date.toLocaleTimeString('tr-TR');
}

function truncatePath(path, maxLength = 40) {
    if (!path || path.length <= maxLength) return path;
    return '...' + path.substring(path.length - maxLength);
}

// ============ ZOOM & PAN FUNCTIONS ============
function zoomCanvas(delta) {
    const newZoom = Math.min(2, Math.max(0.25, state.zoom + delta));
    state.zoom = newZoom;
    applyCanvasTransform();
    $('#zoom-level').textContent = Math.round(state.zoom * 100) + '%';
}

function resetCanvasView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyCanvasTransform();
    $('#zoom-level').textContent = '100%';
}

function applyCanvasTransform() {
    const nodesContainer = $('#nodes-container');
    const svg = $('#connections-svg');

    nodesContainer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    nodesContainer.style.transformOrigin = '0 0';
    svg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    svg.style.transformOrigin = '0 0';
}

function focusOnNodes() {
    if (state.nodes.length === 0) {
        showWarning('Odaklanacak node yok');
        return;
    }

    // Node'ların bounding box'ını hesapla
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const node of state.nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + 180); // Node genişliği ~180px
        maxY = Math.max(maxY, node.position.y + 80);  // Node yüksekliği ~80px
    }

    // Canvas boyutlarını al
    const canvas = $('#workflow-canvas');
    const canvasRect = canvas.getBoundingClientRect();

    // Merkez noktayı hesapla
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Node'ları merkeze al
    state.panX = canvasRect.width / 2 - centerX;
    state.panY = canvasRect.height / 2 - centerY;

    // Tüm node'lar görünür olsun diye zoom'u ayarla
    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;
    const scaleX = canvasRect.width / contentWidth;
    const scaleY = canvasRect.height / contentHeight;
    const newZoom = Math.min(1.5, Math.max(0.3, Math.min(scaleX, scaleY) * 0.8));

    state.zoom = newZoom;
    applyCanvasTransform();
    $('#zoom-level').textContent = Math.round(state.zoom * 100) + '%';
}

// ============ COPY/PASTE FUNCTIONS ============
function copySelectedNode() {
    const node = state.nodes.find(n => n.id === state.selectedNode);
    if (node) {
        state.copiedNode = JSON.parse(JSON.stringify(node));
        console.log('[Copy] Node kopyalandi:', node.type);
    }
}

function pasteNode() {
    if (!state.copiedNode) return;

    const newNode = {
        id: `node_${++state.nodeIdCounter}`,
        type: state.copiedNode.type,
        position: {
            x: state.copiedNode.position.x + 30,
            y: state.copiedNode.position.y + 30
        },
        data: JSON.parse(JSON.stringify(state.copiedNode.data))
    };

    state.nodes.push(newNode);
    renderNode(newNode);
    selectNode(newNode.id);

    // Sonraki yapıştırma için offset ekle
    state.copiedNode.position.x += 30;
    state.copiedNode.position.y += 30;

    console.log('[Paste] Node yapistiridi:', newNode.type);
}

function duplicateSelectedNode() {
    const node = state.nodes.find(n => n.id === state.selectedNode);
    if (!node) return;

    const newNode = {
        id: `node_${++state.nodeIdCounter}`,
        type: node.type,
        position: {
            x: node.position.x + 30,
            y: node.position.y + 30
        },
        data: JSON.parse(JSON.stringify(node.data))
    };

    state.nodes.push(newNode);
    renderNode(newNode);
    selectNode(newNode.id);

    console.log('[Duplicate] Node cogaltildi:', newNode.type);
}

// ============ MULTI-SELECT FUNCTIONS ============
function toggleMultiSelect(nodeId) {
    const index = state.selectedNodes.indexOf(nodeId);
    if (index > -1) {
        // Zaten secili, kaldir
        state.selectedNodes.splice(index, 1);
        const nodeEl = $(`#${nodeId}`);
        if (nodeEl) nodeEl.classList.remove('multi-selected');
    } else {
        // Ekle
        state.selectedNodes.push(nodeId);
        const nodeEl = $(`#${nodeId}`);
        if (nodeEl) nodeEl.classList.add('multi-selected');
    }
    updateSelectionToolbar();
}

function selectAllNodes() {
    clearMultiSelection();
    state.selectedNodes = state.nodes.map(n => n.id);
    state.selectedNodes.forEach(id => {
        const nodeEl = $(`#${id}`);
        if (nodeEl) nodeEl.classList.add('multi-selected');
    });
    updateSelectionToolbar();
}

function clearMultiSelection() {
    state.selectedNodes.forEach(id => {
        const nodeEl = $(`#${id}`);
        if (nodeEl) nodeEl.classList.remove('multi-selected');
    });
    state.selectedNodes = [];
    updateSelectionToolbar();
}

function updateSelectionToolbar() {
    const toolbar = $('#selection-toolbar');
    const count = state.selectedNodes.length;

    if (count > 1) {
        toolbar.style.display = 'flex';
        $('#selected-count').textContent = count;
    } else {
        toolbar.style.display = 'none';
    }
}

function applyColorToSelectedNodes(color) {
    state.selectedNodes.forEach(nodeId => {
        const node = state.nodes.find(n => n.id === nodeId);
        if (node) {
            node.data.color = color;
            const nodeEl = $(`#${nodeId}`);
            if (nodeEl) {
                if (color) {
                    nodeEl.dataset.color = color;
                } else {
                    delete nodeEl.dataset.color;
                }
            }
        }
    });
}

function copySelectedNodes() {
    if (state.selectedNodes.length === 0) return;

    state.copiedNodes = state.selectedNodes.map(nodeId => {
        const node = state.nodes.find(n => n.id === nodeId);
        return JSON.parse(JSON.stringify(node));
    });

    console.log('[Copy] ' + state.copiedNodes.length + ' node kopyalandi');
}

function pasteSelectedNodes() {
    if (state.copiedNodes.length === 0) return;

    const newNodes = [];
    let offsetX = 30;
    let offsetY = 30;

    state.copiedNodes.forEach((copiedNode, index) => {
        const newNode = {
            id: `node_${++state.nodeIdCounter}`,
            type: copiedNode.type,
            position: {
                x: copiedNode.position.x + offsetX,
                y: copiedNode.position.y + offsetY
            },
            data: JSON.parse(JSON.stringify(copiedNode.data))
        };
        newNodes.push(newNode);
        state.nodes.push(newNode);
        renderNode(newNode);
    });

    // Yeni node'lari sec
    clearMultiSelection();
    newNodes.forEach(n => {
        state.selectedNodes.push(n.id);
        const nodeEl = $(`#${n.id}`);
        if (nodeEl) nodeEl.classList.add('multi-selected');
    });
    updateSelectionToolbar();

    console.log('[Paste] ' + newNodes.length + ' node yapistiridi');
}

function deleteSelectedNodes() {
    if (state.selectedNodes.length === 0) return;

    if (!confirm(`${state.selectedNodes.length} node'u silmek istediginizden emin misiniz?`)) {
        return;
    }

    state.selectedNodes.forEach(nodeId => {
        deleteNode(nodeId);
    });

    state.selectedNodes = [];
    updateSelectionToolbar();
}

// ============ NODE ARRANGEMENT FUNCTIONS ============
function arrangeNodesVertically() {
    if (state.nodes.length === 0) {
        showWarning('Duzenlecek node yok');
        return;
    }

    // Baglantilara gore siralama yap
    const orderedNodes = getNodesInExecutionOrder();

    // Dikey olarak diz
    const startX = 300;
    const startY = 50;
    const verticalGap = 100;

    orderedNodes.forEach((node, index) => {
        node.position.x = startX;
        node.position.y = startY + (index * verticalGap);

        const nodeEl = $(`#${node.id}`);
        if (nodeEl) {
            nodeEl.style.left = `${node.position.x}px`;
            nodeEl.style.top = `${node.position.y}px`;
        }
    });

    updateConnections();
    focusOnNodes();
}

function getNodesInExecutionOrder() {
    // Baglantilara gore siralama
    const ordered = [];
    const visited = new Set();

    // Giris node'larini bul (hicbir edge'in target'i olmayan)
    const targetIds = new Set(state.edges.map(e => e.target));
    const startNodes = state.nodes.filter(n => !targetIds.has(n.id));

    function traverse(nodeId) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = state.nodes.find(n => n.id === nodeId);
        if (node) {
            ordered.push(node);
        }

        // Bu node'dan cikan edge'leri bul
        const outgoingEdges = state.edges.filter(e => e.source === nodeId);
        outgoingEdges.forEach(edge => {
            traverse(edge.target);
        });
    }

    // Baslangic node'larindan baslayarak traverse et
    if (startNodes.length > 0) {
        startNodes.forEach(n => traverse(n.id));
    }

    // Baglanti olmayan node'lari da ekle
    state.nodes.forEach(n => {
        if (!visited.has(n.id)) {
            ordered.push(n);
        }
    });

    return ordered;
}
