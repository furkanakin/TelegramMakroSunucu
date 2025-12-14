const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class DatabaseManager {
    constructor(dbPath) {
        this.dbPath = dbPath || path.join(__dirname, '../../data/telegram_automation.db');
        this.db = null;
        this.SQL = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        this.SQL = await initSqlJs();

        // Mevcut veritabanını yükle veya yeni oluştur
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        if (fs.existsSync(this.dbPath)) {
            const buffer = fs.readFileSync(this.dbPath);
            this.db = new this.SQL.Database(buffer);
        } else {
            this.db = new this.SQL.Database();
        }

        this.createTables();
        this.initialized = true;
    }

    createTables() {
        // Telegram hesapları tablosu
        this.db.run(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                folder_path TEXT NOT NULL,
                exe_path TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                last_used TEXT
            )
        `);

        // Kanal linkleri tablosu
        this.db.run(`
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                link TEXT UNIQUE NOT NULL,
                name TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // Hangi hesap hangi kanala istek attı
        this.db.run(`
            CREATE TABLE IF NOT EXISTS join_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                channel_id INTEGER NOT NULL,
                requested_at TEXT DEFAULT (datetime('now')),
                status TEXT DEFAULT 'pending',
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                FOREIGN KEY (channel_id) REFERENCES channels(id),
                UNIQUE(account_id, channel_id)
            )
        `);

        // Workflow'lar
        this.db.run(`
            CREATE TABLE IF NOT EXISTS workflows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                is_default INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // Workflow node detayları
        this.db.run(`
            CREATE TABLE IF NOT EXISTS workflow_nodes (
                id TEXT PRIMARY KEY,
                workflow_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                position_x REAL NOT NULL,
                position_y REAL NOT NULL,
                data TEXT NOT NULL,
                original_id TEXT,
                FOREIGN KEY (workflow_id) REFERENCES workflows(id)
            )
        `);

        // original_id sütunu yoksa ekle (mevcut veritabanları için)
        try {
            this.db.run('ALTER TABLE workflow_nodes ADD COLUMN original_id TEXT');
        } catch (e) {
            // Sütun zaten var, hata yoksay
        }

        // Workflow bağlantıları
        this.db.run(`
            CREATE TABLE IF NOT EXISTS workflow_edges (
                id TEXT PRIMARY KEY,
                workflow_id INTEGER NOT NULL,
                source_node_id TEXT NOT NULL,
                target_node_id TEXT NOT NULL,
                FOREIGN KEY (workflow_id) REFERENCES workflows(id)
            )
        `);

        // Uygulama ayarları
        this.db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Otomasyon logları
        this.db.run(`
            CREATE TABLE IF NOT EXISTS automation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'info',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            )
        `);

        this.save();
    }

    save() {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }

    // Helper: tek satır çek
    getOne(sql, params = []) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    }

    // Helper: tüm satırları çek
    getAll(sql, params = []) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    }

    // Helper: çalıştır
    run(sql, params = []) {
        this.db.run(sql, params);
        this.save();
        return { lastInsertRowid: this.db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
    }

    // ============ HESAP İŞLEMLERİ ============
    addAccount(phoneNumber, folderPath, exePath) {
        return this.run(
            'INSERT INTO accounts (phone_number, folder_path, exe_path) VALUES (?, ?, ?)',
            [phoneNumber, folderPath, exePath]
        );
    }

    getAccounts(activeOnly = true) {
        const sql = activeOnly
            ? 'SELECT * FROM accounts WHERE is_active = 1 ORDER BY id'
            : 'SELECT * FROM accounts ORDER BY id';
        return this.getAll(sql);
    }

    getAccountById(id) {
        return this.getOne('SELECT * FROM accounts WHERE id = ?', [id]);
    }

    updateAccountLastUsed(id) {
        return this.run("UPDATE accounts SET last_used = datetime('now') WHERE id = ?", [id]);
    }

    deleteAccount(id) {
        return this.run('DELETE FROM accounts WHERE id = ?', [id]);
    }

    toggleAccountActive(id, isActive) {
        return this.run('UPDATE accounts SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
    }

    // ============ KANAL İŞLEMLERİ ============
    addChannel(link, name = null) {
        return this.run('INSERT OR IGNORE INTO channels (link, name) VALUES (?, ?)', [link, name]);
    }

    addChannelsBulk(links) {
        for (const link of links) {
            this.db.run('INSERT OR IGNORE INTO channels (link) VALUES (?)', [link.trim()]);
        }
        this.save();
    }

    getChannels(activeOnly = true) {
        const sql = activeOnly
            ? 'SELECT * FROM channels WHERE is_active = 1 ORDER BY id'
            : 'SELECT * FROM channels ORDER BY id';
        return this.getAll(sql);
    }

    deleteChannel(id) {
        return this.run('DELETE FROM channels WHERE id = ?', [id]);
    }

    deleteAllChannels() {
        return this.run('DELETE FROM channels');
    }

    // ============ İSTEK TAKİBİ ============
    recordJoinRequest(accountId, channelId, status = 'pending') {
        return this.run(
            "INSERT OR REPLACE INTO join_requests (account_id, channel_id, status, requested_at) VALUES (?, ?, ?, datetime('now'))",
            [accountId, channelId, status]
        );
    }

    getRequestedChannels(accountId) {
        return this.getAll('SELECT channel_id FROM join_requests WHERE account_id = ?', [accountId])
            .map(r => r.channel_id);
    }

    getUnrequestedChannels(accountId, limit = 5) {
        return this.getAll(`
            SELECT c.* FROM channels c
            WHERE c.is_active = 1
            AND c.id NOT IN (
                SELECT channel_id FROM join_requests WHERE account_id = ?
            )
            ORDER BY RANDOM()
            LIMIT ?
        `, [accountId, limit]);
    }

    getAllChannelsForAccount(accountId, excludeRequested = false) {
        if (excludeRequested) {
            return this.getUnrequestedChannels(accountId, 999999);
        }
        return this.getChannels(true);
    }

    getJoinRequestStats() {
        return this.getAll(`
            SELECT
                a.phone_number,
                COUNT(jr.id) as total_requests,
                SUM(CASE WHEN jr.status = 'success' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN jr.status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM accounts a
            LEFT JOIN join_requests jr ON a.id = jr.account_id
            GROUP BY a.id
        `);
    }

    isAllChannelsRequested() {
        const result = this.getOne(`
            SELECT COUNT(*) as remaining FROM (
                SELECT a.id as account_id, c.id as channel_id
                FROM accounts a, channels c
                WHERE a.is_active = 1 AND c.is_active = 1
                AND NOT EXISTS (
                    SELECT 1 FROM join_requests jr
                    WHERE jr.account_id = a.id AND jr.channel_id = c.id
                )
            )
        `);
        return result.remaining === 0;
    }

    // Detayli istek gecmisi
    getJoinRequestHistory(limit = 500) {
        return this.getAll(`
            SELECT
                jr.id,
                jr.account_id,
                jr.channel_id,
                jr.status,
                jr.requested_at,
                a.phone_number,
                c.link as channel_link,
                c.name as channel_name
            FROM join_requests jr
            LEFT JOIN accounts a ON jr.account_id = a.id
            LEFT JOIN channels c ON jr.channel_id = c.id
            ORDER BY jr.requested_at DESC
            LIMIT ?
        `, [limit]);
    }

    // Hesap bazli istek gecmisi
    getJoinRequestHistoryByAccount(accountId) {
        return this.getAll(`
            SELECT
                jr.id,
                jr.channel_id,
                jr.status,
                jr.requested_at,
                c.link as channel_link,
                c.name as channel_name
            FROM join_requests jr
            LEFT JOIN channels c ON jr.channel_id = c.id
            WHERE jr.account_id = ?
            ORDER BY jr.requested_at DESC
        `, [accountId]);
    }

    // Tum istek gecmisini temizle
    clearAllJoinRequests() {
        return this.run('DELETE FROM join_requests');
    }

    // Belirli hesabin istek gecmisini temizle
    clearJoinRequestsForAccount(accountId) {
        return this.run('DELETE FROM join_requests WHERE account_id = ?', [accountId]);
    }

    // Belirli bir istegi sil
    deleteJoinRequest(id) {
        return this.run('DELETE FROM join_requests WHERE id = ?', [id]);
    }

    // ============ WORKFLOW İŞLEMLERİ ============
    saveWorkflow(name, nodes, edges, description = '') {
        // Önce workflow'u ekle
        this.db.run('INSERT INTO workflows (name, description) VALUES (?, ?)', [name, description]);

        // last_insert_rowid'yi hemen al (save'den önce)
        const rowIdResult = this.db.exec("SELECT last_insert_rowid()");
        const workflowId = rowIdResult[0]?.values[0][0];

        console.log('[DB] Yeni workflow ID:', workflowId);

        for (const node of nodes) {
            // Node ID'yi workflow_id ile benzersiz yap
            const uniqueNodeId = `${workflowId}_${node.id}`;
            this.db.run(
                'INSERT INTO workflow_nodes (id, workflow_id, type, position_x, position_y, data, original_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [uniqueNodeId, workflowId, node.type, node.position.x, node.position.y, JSON.stringify(node.data), node.id]
            );
        }

        for (const edge of edges) {
            // Edge ID'yi de benzersiz yap
            const uniqueEdgeId = `${workflowId}_${edge.id}`;
            this.db.run(
                'INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)',
                [uniqueEdgeId, workflowId, edge.source, edge.target]
            );
        }

        this.save();
        return workflowId;
    }

    updateWorkflow(workflowId, nodes, edges) {
        this.db.run('DELETE FROM workflow_nodes WHERE workflow_id = ?', [workflowId]);
        this.db.run('DELETE FROM workflow_edges WHERE workflow_id = ?', [workflowId]);

        for (const node of nodes) {
            const uniqueNodeId = `${workflowId}_${node.id}`;
            this.db.run(
                'INSERT INTO workflow_nodes (id, workflow_id, type, position_x, position_y, data, original_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [uniqueNodeId, workflowId, node.type, node.position.x, node.position.y, JSON.stringify(node.data), node.id]
            );
        }

        for (const edge of edges) {
            const uniqueEdgeId = `${workflowId}_${edge.id}`;
            this.db.run(
                'INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)',
                [uniqueEdgeId, workflowId, edge.source, edge.target]
            );
        }

        this.db.run("UPDATE workflows SET updated_at = datetime('now') WHERE id = ?", [workflowId]);
        this.save();
    }

    getWorkflow(workflowId) {
        const workflow = this.getOne('SELECT * FROM workflows WHERE id = ?', [workflowId]);
        if (!workflow) return null;

        const nodes = this.getAll('SELECT * FROM workflow_nodes WHERE workflow_id = ?', [workflowId]);
        const edges = this.getAll('SELECT * FROM workflow_edges WHERE workflow_id = ?', [workflowId]);

        return {
            ...workflow,
            nodes: nodes.map(n => ({
                id: n.original_id || n.id,  // Orijinal ID'yi kullan
                type: n.type,
                position: { x: n.position_x, y: n.position_y },
                data: JSON.parse(n.data)
            })),
            edges: edges.map(e => ({
                id: e.id.includes('_') ? e.id.split('_').slice(1).join('_') : e.id,  // Orijinal edge ID
                source: e.source_node_id,
                target: e.target_node_id
            }))
        };
    }

    getWorkflows() {
        return this.getAll('SELECT * FROM workflows ORDER BY updated_at DESC');
    }

    deleteWorkflow(workflowId) {
        this.db.run('DELETE FROM workflow_nodes WHERE workflow_id = ?', [workflowId]);
        this.db.run('DELETE FROM workflow_edges WHERE workflow_id = ?', [workflowId]);
        this.db.run('DELETE FROM workflows WHERE id = ?', [workflowId]);
        this.save();
    }

    setDefaultWorkflow(workflowId) {
        this.db.run('UPDATE workflows SET is_default = 0');
        this.db.run('UPDATE workflows SET is_default = 1 WHERE id = ?', [workflowId]);
        this.save();
    }

    renameWorkflow(workflowId, newName, newDescription = null) {
        if (newDescription !== null) {
            this.db.run("UPDATE workflows SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?", [newName, newDescription, workflowId]);
        } else {
            this.db.run("UPDATE workflows SET name = ?, updated_at = datetime('now') WHERE id = ?", [newName, workflowId]);
        }
        this.save();
    }

    getDefaultWorkflow() {
        const workflow = this.getOne('SELECT * FROM workflows WHERE is_default = 1');
        if (!workflow) return null;
        return this.getWorkflow(workflow.id);
    }

    // ============ AYARLAR ============
    setSetting(key, value) {
        this.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    }

    getSetting(key, defaultValue = null) {
        const row = this.getOne('SELECT value FROM settings WHERE key = ?', [key]);
        return row ? JSON.parse(row.value) : defaultValue;
    }

    getAllSettings() {
        const rows = this.getAll('SELECT * FROM settings');
        const settings = {};
        for (const row of rows) {
            settings[row.key] = JSON.parse(row.value);
        }
        return settings;
    }

    // ============ LOG İŞLEMLERİ ============
    addLog(action, details = null, accountId = null, status = 'info') {
        this.run(
            'INSERT INTO automation_logs (account_id, action, details, status) VALUES (?, ?, ?, ?)',
            [accountId, action, details, status]
        );
    }

    getLogs(limit = 100) {
        return this.getAll(`
            SELECT l.*, a.phone_number
            FROM automation_logs l
            LEFT JOIN accounts a ON l.account_id = a.id
            ORDER BY l.created_at DESC
            LIMIT ?
        `, [limit]);
    }

    clearLogs() {
        this.run('DELETE FROM automation_logs');
    }

    // ============ İSTATİSTİKLER ============
    getStats() {
        const accountCount = this.getOne('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1').count;
        const channelCount = this.getOne('SELECT COUNT(*) as count FROM channels WHERE is_active = 1').count;
        const totalRequests = this.getOne('SELECT COUNT(*) as count FROM join_requests').count;
        const successfulRequests = this.getOne("SELECT COUNT(*) as count FROM join_requests WHERE status = 'success'").count;

        return {
            accountCount,
            channelCount,
            totalRequests,
            successfulRequests,
            remainingRequests: (accountCount * channelCount) - totalRequests
        };
    }

    close() {
        if (this.db) {
            this.save();
            this.db.close();
        }
    }
}

module.exports = DatabaseManager;
