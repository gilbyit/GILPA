"""GILPA — connessione SQLite e init schema."""
import sqlite3
from pathlib import Path

from .config import DB_PATH, DEFAULT_CATEGORIES


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            key    TEXT UNIQUE NOT NULL,
            label  TEXT NOT NULL,
            color  TEXT NOT NULL DEFAULT '#7b8694'
        );
 
        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT 'other',
            status      TEXT NOT NULL DEFAULT 'active',
            notes       TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
 
        CREATE TABLE IF NOT EXISTS components (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            description     TEXT,
            shop            TEXT,
            url             TEXT,
            estimated_price REAL,
            quantity        INTEGER DEFAULT 1,
            priority        TEXT DEFAULT 'medium',
            status          TEXT DEFAULT 'to_buy',
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
 
        CREATE TABLE IF NOT EXISTS lists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
 
        CREATE TABLE IF NOT EXISTS list_fields (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            key        TEXT NOT NULL,
            label      TEXT NOT NULL,
            type       TEXT NOT NULL DEFAULT 'text',
            options    TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE(list_id, key)
        );
 
        CREATE TABLE IF NOT EXISTS list_items (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            data       TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
 
        CREATE TABLE IF NOT EXISTS shops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, aliases TEXT, category TEXT, notes TEXT
        );
 
        CREATE TABLE IF NOT EXISTS time_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, category TEXT, day_of_week INTEGER,
            start_time TEXT, duration_min INTEGER, recurring BOOLEAN DEFAULT 1, notes TEXT
        );
 
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT, description TEXT, duration_min INTEGER,
            logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
        );
 
        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            task_description TEXT, started_at DATETIME, ended_at DATETIME,
            completed BOOLEAN DEFAULT 0, duration_min INTEGER DEFAULT 25
        );
        """
    )
    # Seed categorie solo se la tabella è vuota
    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO categories (key, label, color) VALUES (?, ?, ?)",
            DEFAULT_CATEGORIES,
        )
    conn.commit()