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

        // Uygulama ayarları
        this.db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
        return this.getOne('SELECT * FROM accounts WHERE id = ?', [parseInt(id)]);
    }

    getAccountByPhone(phoneNumber) {
        if (!phoneNumber) return null;
        return this.getOne('SELECT * FROM accounts WHERE phone_number = ?', [phoneNumber.toString().trim()]);
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

    // ============ İSTATİSTİKLER ============
    getStats() {
        const accountCount = this.getOne('SELECT COUNT(*) as count FROM accounts').count;
        const activeAccountCount = this.getOne('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1').count;

        return {
            accountCount,
            activeAccountCount
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
