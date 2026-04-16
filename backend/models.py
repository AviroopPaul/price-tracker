import sqlite3

DB_PATH = "price_tracker.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            name TEXT NOT NULL,
            site TEXT,
            current_price REAL,
            last_price REAL,
            last_checked TEXT,
            created_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            price REAL NOT NULL,
            checked_at TEXT NOT NULL,
            FOREIGN KEY (item_id) REFERENCES items (id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('check_interval_hours', '24'),
            ('alert_on_increase', '1'),
            ('alert_on_decrease', '1'),
            ('price_change_threshold', '0');
    """)
    conn.commit()
    conn.close()
