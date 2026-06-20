const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

// Use absolute path /app/data (Docker) or relative path for local development
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// Safely create directory - handle EACCES gracefully for Docker volumes
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err) {
  if (err.code !== 'EACCES') throw err;
  console.warn(`⚠️  Could not create ${DATA_DIR} - using existing directory`);
}

const db = new sqlite3.Database(path.join(DATA_DIR, 'techustad.db'));

// Promisify core methods
db.runAsync  = (sql, params = []) => new Promise((res, rej) =>
  db.run(sql, params, function(err) { if (err) rej(err); else res({ lastID: this.lastID, changes: this.changes }); })
);
db.getAsync  = (sql, params = []) => new Promise((res, rej) =>
  db.get(sql, params, (err, row) => err ? rej(err) : res(row))
);
db.allAsync  = (sql, params = []) => new Promise((res, rej) =>
  db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))
);
db.execAsync = (sql)             => new Promise((res, rej) =>
  db.exec(sql, err => err ? rej(err) : res())
);

// Sync-style prepare shim (run/get/all return Promises from the prepared statement)
db.prepare = function(sql) {
  return {
    run:  (...params) => db.runAsync(sql, params),
    get:  (...params) => db.getAsync(sql, params),
    all:  (...params) => db.allAsync(sql, params),
  };
};

db.serialize(() => {
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
});

db.execAsync(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT UNIQUE,
    phone       TEXT UNIQUE,
    password_hash TEXT,
    full_name   TEXT,
    avatar      TEXT,
    provider    TEXT DEFAULT 'local',
    provider_id TEXT,
    email_verified  INTEGER DEFAULT 0,
    phone_verified  INTEGER DEFAULT 0,
    stripe_customer_id TEXT,
    role        TEXT DEFAULT 'student',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    contact    TEXT NOT NULL,
    type       TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER DEFAULT 0,
    attempts   INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER,
    stripe_payment_intent_id TEXT UNIQUE,
    amount                  INTEGER,
    currency                TEXT DEFAULT 'usd',
    status                  TEXT,
    course                  TEXT,
    created_at              TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    subject    TEXT NOT NULL,
    message    TEXT NOT NULL,
    status     TEXT DEFAULT 'open',
    priority   TEXT DEFAULT 'medium',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL,
    sender     TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    course     TEXT NOT NULL,
    payment_id INTEGER,
    enrolled_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(payment_id) REFERENCES payments(id)
  );
`).catch(err => console.error('DB init error:', err));

module.exports = db;
