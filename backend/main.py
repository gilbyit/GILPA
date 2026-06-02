"""GILPA Backend — FastAPI
 
v0.3.0
- CRUD progetti
- CRUD categorie DINAMICHE (tabella `categories`), con conteggio progetti
- Le altre tabelle dello schema vengono comunque create all'avvio.
"""
 
from datetime import datetime
from pathlib import Path
from typing import Optional
import os
import re
import sqlite3
 
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
 
app = FastAPI(title="GILPA", version="0.3.0")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
DB_PATH = os.getenv("DATABASE_PATH", "/app/data/gilpa.db")
 
STATUSES = {"new","active", "paused", "done"}
 
# Categorie di default (seed iniziale). I "key" coincidono con quelli
# che i progetti esistenti usano già, quindi i conteggi restano corretti.
DEFAULT_CATEGORIES = [
    ("hardware", "Hardware", "#f6c454"),
    ("software", "Software", "#3d7bfd"),
    ("music",    "Musica",   "#a78bfa"),
    ("other",    "Altro",    "#7b8694"),
]
 
# Palette per assegnare un colore automatico alle categorie create "al volo"
PALETTE = ["#3d7bfd", "#f6c454", "#a78bfa", "#34d399", "#f87171",
           "#22d3ee", "#fb923c", "#e879f9", "#60a5fa", "#a3e635"]
 
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
 
 
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
    conn.close()
 
 
@app.on_event("startup")
def on_startup() -> None:
    init_db()
 
 
# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
 
def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return s or "cat"
 
 
def unique_key(conn, base: str) -> str:
    key, n = base, 1
    while conn.execute("SELECT 1 FROM categories WHERE key = ?", (key,)).fetchone():
        n += 1
        key = f"{base}-{n}"
    return key
 
 
def auto_color(conn) -> str:
    n = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    return PALETTE[n % len(PALETTE)]
 
 
def category_exists(conn, key: str) -> bool:
    return conn.execute("SELECT 1 FROM categories WHERE key = ?", (key,)).fetchone() is not None
 
 
def valid_color(c: Optional[str], fallback: str) -> str:
    return c if (c and HEX_RE.match(c)) else fallback
 
 
# ---------------------------------------------------------------------------
# Modelli
# ---------------------------------------------------------------------------
 
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = "other"
    status: str = "new"
    notes: Optional[str] = None
 
 
class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
 
 
class CategoryCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    color: Optional[str] = None
 
 
class CategoryUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=60)
    color: Optional[str] = None
 
 
# ---------------------------------------------------------------------------
# Servizio
# ---------------------------------------------------------------------------
 
@app.get("/health")
def health():
    return {"status": "ok", "version": app.version}
 
 
@app.get("/api/stats")
def stats():
    conn = get_db()
    rows = conn.execute("SELECT status, COUNT(*) n FROM projects GROUP BY status").fetchall()
    conn.close()
    c = {r["status"]: r["n"] for r in rows}
    return {"total": sum(c.values()), "active": c.get("active", 0),
            "paused": c.get("paused", 0), "done": c.get("done", 0)}
 
 
# ---------------------------------------------------------------------------
# Categorie
# ---------------------------------------------------------------------------
 
@app.get("/api/categories")
def list_categories():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT c.id, c.key, c.label, c.color,
               (SELECT COUNT(*) FROM projects p WHERE p.category = c.key) AS project_count
        FROM categories c
        ORDER BY c.label COLLATE NOCASE
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@app.post("/api/categories", status_code=201)
def create_category(c: CategoryCreate):
    conn = get_db()
    key = unique_key(conn, slugify(c.label))
    color = valid_color(c.color, auto_color(conn))
    cur = conn.execute(
        "INSERT INTO categories (key, label, color) VALUES (?, ?, ?)",
        (key, c.label.strip(), color),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return {**dict(row), "project_count": 0}
 
 
@app.patch("/api/categories/{category_id}")
def update_category(category_id: int, c: CategoryUpdate):
    fields = {}
    if c.label is not None:
        fields["label"] = c.label.strip()
    if c.color is not None:
        if not HEX_RE.match(c.color):
            raise HTTPException(422, "Colore non valido (atteso #RRGGBB)")
        fields["color"] = c.color
    if not fields:
        raise HTTPException(422, "Nessun campo da aggiornare")
 
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    conn = get_db()
    cur = conn.execute(
        f"UPDATE categories SET {set_clause} WHERE id = ?",
        list(fields.values()) + [category_id],
    )
    conn.commit()
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Categoria non trovata")
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    cnt = conn.execute(
        "SELECT COUNT(*) FROM projects WHERE category = ?", (row["key"],)
    ).fetchone()[0]
    conn.close()
    return {**dict(row), "project_count": cnt}
 
 
@app.delete("/api/categories/{category_id}", status_code=204)
def delete_category(category_id: int):
    conn = get_db()
    row = conn.execute("SELECT key FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Categoria non trovata")
    in_use = conn.execute(
        "SELECT COUNT(*) FROM projects WHERE category = ?", (row["key"],)
    ).fetchone()[0]
    if in_use:
        conn.close()
        raise HTTPException(409, f"Categoria in uso da {in_use} progetto/i. Riassegnali prima di eliminarla.")
    conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    conn.commit()
    conn.close()
    return None
 
 
# ---------------------------------------------------------------------------
# Progetti
# ---------------------------------------------------------------------------
 
@app.get("/api/projects")
def list_projects(status: Optional[str] = None, category: Optional[str] = None):
    if status and status not in STATUSES:
        raise HTTPException(422, f"status non valido: {status}")
    sql, clauses, params = "SELECT * FROM projects", [], []
    if status:
        clauses.append("status = ?"); params.append(status)
    if category:
        clauses.append("category = ?"); params.append(category)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC"
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@app.post("/api/projects", status_code=201)
def create_project(p: ProjectCreate):
    if p.status not in STATUSES:
        raise HTTPException(422, f"status non valido: {p.status}")
    conn = get_db()
    if not category_exists(conn, p.category):
        conn.close()
        raise HTTPException(422, f"categoria inesistente: {p.category}")
    cur = conn.execute(
        "INSERT INTO projects (name, category, status, notes) VALUES (?, ?, ?, ?)",
        (p.name.strip(), p.category, p.status, p.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)
 
 
@app.patch("/api/projects/{project_id}")
def update_project(project_id: int, p: ProjectUpdate):
    if p.status is not None and p.status not in STATUSES:
        raise HTTPException(422, f"status non valido: {p.status}")
    fields = {k: v for k, v in p.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(422, "Nessun campo da aggiornare")
    conn = get_db()
    if "category" in fields and not category_exists(conn, fields["category"]):
        conn.close()
        raise HTTPException(422, f"categoria inesistente: {fields['category']}")
    fields["updated_at"] = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    cur = conn.execute(
        f"UPDATE projects SET {set_clause} WHERE id = ?",
        list(fields.values()) + [project_id],
    )
    conn.commit()
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Progetto non trovato")
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return dict(row)
 
 
@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Progetto non trovato")
    return None
