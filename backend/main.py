"""GILPA Backend — FastAPI
 
v0.5.0
- CRUD progetti
- CRUD categorie DINAMICHE (tabella `categories`), con conteggio progetti
- CRUD componenti + lista spesa per negozio
- LISTE PERSONALIZZATE: liste con campi definiti dall'utente (testo, numero,
  booleano, data, url, select, rating) e voci con dati JSON.
  Suggerimento campi e autofill voci via Claude API (richiede ANTHROPIC_API_KEY).
- Le altre tabelle dello schema vengono comunque create all'avvio.
"""
 
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
import os
import re
import sqlite3
 
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
 
app = FastAPI(title="GILPA", version="0.5.0")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
DB_PATH = os.getenv("DATABASE_PATH", "/app/data/gilpa.db")
 
STATUSES = {"new","active", "paused", "done"}
PRIORITIES = {"high", "medium", "low"}
COMPONENT_STATUSES = {"to_buy", "ordered", "delivered", "cancelled"}
FIELD_TYPES = {"text", "number", "boolean", "date", "url", "select", "rating"}
# LLM_MODEL = os.getenv("GILPA_LLM_MODEL", "claude-haiku-4-5")
LLM_BASE_URL = os.getenv("GILPA_LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_API_KEY  = os.getenv("GILPA_LLM_API_KEY")
LLM_MODEL    = os.getenv("GILPA_LLM_MODEL", "llama-3.3-70b-versatile")
 
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
 
 
class ComponentCreate(BaseModel):
    project_id: int
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    shop: Optional[str] = None
    url: Optional[str] = None
    estimated_price: Optional[float] = None
    quantity: int = 1
    priority: str = "medium"
    status: str = "to_buy"
 
 
class ComponentUpdate(BaseModel):
    project_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    shop: Optional[str] = None
    url: Optional[str] = None
    estimated_price: Optional[float] = None
    quantity: Optional[int] = None
    priority: Optional[str] = None
    status: Optional[str] = None
 
 
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
 
 
# ---------------------------------------------------------------------------
# Componenti
# ---------------------------------------------------------------------------
 
COMP_SELECT = """
    SELECT c.*, p.name AS project_name, p.category AS project_category
    FROM components c LEFT JOIN projects p ON c.project_id = p.id
"""
 
 
def project_exists(conn, pid: int) -> bool:
    return conn.execute("SELECT 1 FROM projects WHERE id = ?", (pid,)).fetchone() is not None
 
 
@app.get("/api/components")
def list_components(status: Optional[str] = None, shop: Optional[str] = None,
                    project_id: Optional[int] = None):
    if status and status not in COMPONENT_STATUSES:
        raise HTTPException(422, f"status non valido: {status}")
    clauses, params = [], []
    if status:
        clauses.append("c.status = ?"); params.append(status)
    if shop:
        clauses.append("c.shop = ?"); params.append(shop)
    if project_id:
        clauses.append("c.project_id = ?"); params.append(project_id)
    sql = COMP_SELECT + (" WHERE " + " AND ".join(clauses) if clauses else "")
    sql += " ORDER BY c.created_at DESC"
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@app.get("/api/projects/{project_id}/components")
def list_project_components(project_id: int):
    conn = get_db()
    rows = conn.execute(COMP_SELECT + " WHERE c.project_id = ? ORDER BY c.created_at DESC",
                        (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@app.get("/api/shopping-list/summary")
def shopping_summary():
    """Riepilogo per negozio dei soli pezzi ancora da comprare (status='to_buy')."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT COALESCE(NULLIF(TRIM(shop), ''), '—') AS shop,
               COUNT(*) AS items,
               COALESCE(SUM(COALESCE(estimated_price, 0) * COALESCE(quantity, 1)), 0) AS total
        FROM components
        WHERE status = 'to_buy'
        GROUP BY shop
        ORDER BY total DESC, items DESC
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@app.post("/api/components", status_code=201)
def create_component(c: ComponentCreate):
    if c.priority not in PRIORITIES:
        raise HTTPException(422, f"priorità non valida: {c.priority}")
    if c.status not in COMPONENT_STATUSES:
        raise HTTPException(422, f"status non valido: {c.status}")
    if c.quantity < 1:
        raise HTTPException(422, "quantità minima: 1")
    conn = get_db()
    if not project_exists(conn, c.project_id):
        conn.close()
        raise HTTPException(422, f"progetto inesistente: {c.project_id}")
    cur = conn.execute(
        """INSERT INTO components
           (project_id, name, description, shop, url, estimated_price, quantity, priority, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (c.project_id, c.name.strip(), c.description, (c.shop or None) and c.shop.strip(),
         (c.url or None), c.estimated_price, c.quantity, c.priority, c.status),
    )
    conn.commit()
    row = conn.execute(COMP_SELECT + " WHERE c.id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)
 
 
@app.patch("/api/components/{component_id}")
def update_component(component_id: int, c: ComponentUpdate):
    if c.priority is not None and c.priority not in PRIORITIES:
        raise HTTPException(422, f"priorità non valida: {c.priority}")
    if c.status is not None and c.status not in COMPONENT_STATUSES:
        raise HTTPException(422, f"status non valido: {c.status}")
    if c.quantity is not None and c.quantity < 1:
        raise HTTPException(422, "quantità minima: 1")
    fields = {k: v for k, v in c.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(422, "Nessun campo da aggiornare")
    conn = get_db()
    if "project_id" in fields and not project_exists(conn, fields["project_id"]):
        conn.close()
        raise HTTPException(422, f"progetto inesistente: {fields['project_id']}")
    if "name" in fields and isinstance(fields["name"], str):
        fields["name"] = fields["name"].strip()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    cur = conn.execute(
        f"UPDATE components SET {set_clause} WHERE id = ?",
        list(fields.values()) + [component_id],
    )
    conn.commit()
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Componente non trovato")
    row = conn.execute(COMP_SELECT + " WHERE c.id = ?", (component_id,)).fetchone()
    conn.close()
    return dict(row)
 
 
@app.delete("/api/components/{component_id}", status_code=204)
def delete_component(component_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM components WHERE id = ?", (component_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Componente non trovato")
    return None 
 
# ---------------------------------------------------------------------------
# Liste personalizzate
# ---------------------------------------------------------------------------
 
class FieldDef(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    type: str = "text"
    options: Optional[list[str]] = None
 
 
class FieldUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=60)
    type: Optional[str] = None
    options: Optional[list[str]] = None
    sort_order: Optional[int] = None
 
 
class ListCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    fields: list[FieldDef] = []
 
 
class ListUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
 
 
class ItemIn(BaseModel):
    data: dict[str, Any] = {}
 
 
class SuggestFieldsIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    existing: list[str] = []
 
 
class SuggestItemIn(BaseModel):
    hint: str = Field(..., min_length=1, max_length=300)
 
 
def _check_field_def(label: str, ftype: str, options: Optional[list[str]]) -> None:
    if ftype not in FIELD_TYPES:
        raise HTTPException(422, f"tipo campo non valido: {ftype} (ammessi: {', '.join(sorted(FIELD_TYPES))})")
    if ftype == "select" and not options:
        raise HTTPException(422, f"il campo select '{label}' richiede almeno un'opzione")
 
 
def _list_exists(conn, list_id: int) -> bool:
    return conn.execute("SELECT 1 FROM lists WHERE id = ?", (list_id,)).fetchone() is not None
 
 
def _unique_field_key(conn, list_id: int, base: str) -> str:
    key, n = base, 1
    while conn.execute("SELECT 1 FROM list_fields WHERE list_id = ? AND key = ?", (list_id, key)).fetchone():
        n += 1
        key = f"{base}-{n}"
    return key
 
 
def _insert_field(conn, list_id: int, f: FieldDef, sort_order: int) -> None:
    _check_field_def(f.label, f.type, f.options)
    key = _unique_field_key(conn, list_id, slugify(f.label))
    opts = json.dumps(f.options, ensure_ascii=False) if f.options else None
    conn.execute(
        "INSERT INTO list_fields (list_id, key, label, type, options, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        (list_id, key, f.label.strip(), f.type, opts, sort_order),
    )
 
 
def _load_fields(conn, list_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, key, label, type, options, sort_order FROM list_fields WHERE list_id = ? ORDER BY sort_order, id",
        (list_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["options"] = json.loads(d["options"]) if d["options"] else None
        out.append(d)
    return out
 
 
def _list_payload(conn, row) -> dict:
    d = dict(row)
    d["fields"] = _load_fields(conn, d["id"])
    d["item_count"] = conn.execute(
        "SELECT COUNT(*) FROM list_items WHERE list_id = ?", (d["id"],)
    ).fetchone()[0]
    return d
 
 
def _touch_list(conn, list_id: int) -> None:
    conn.execute(
        "UPDATE lists SET updated_at = ? WHERE id = ?",
        (datetime.utcnow().isoformat(sep=" ", timespec="seconds"), list_id),
    )
 
 
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRUE_SET = {"1", "true", "si", "sì", "yes", "on"}
 
 
def _coerce_value(f: dict, v: Any, strict: bool = True) -> Any:
    """Coercizione/validazione di un valore rispetto al tipo del campo.
    strict=False (output LLM): valori non validi diventano None invece di 422."""
    def fail(msg: str):
        if strict:
            raise HTTPException(422, msg)
        return None
 
    if v is None or v == "":
        return None
    t = f["type"]
    try:
        if t in ("text", "url"):
            return str(v).strip() or None
        if t == "number":
            return float(v)
        if t == "rating":
            iv = int(float(v))
            if not 0 <= iv <= 10:
                return fail(f"'{f['label']}': rating fuori range 0-10")
            return iv
        if t == "boolean":
            if isinstance(v, bool):
                return v
            return str(v).strip().lower() in TRUE_SET
        if t == "date":
            s = str(v).strip()
            if not DATE_RE.match(s):
                return fail(f"'{f['label']}': data non valida (atteso YYYY-MM-DD)")
            return s
        if t == "select":
            s = str(v).strip()
            if f.get("options") and s not in f["options"]:
                return fail(f"'{f['label']}': valore '{s}' non tra le opzioni")
            return s
    except (ValueError, TypeError):
        return fail(f"'{f['label']}': valore non valido per il tipo {t}")
    return fail(f"'{f['label']}': tipo campo sconosciuto")
 
 
def _validate_item_data(fields: list[dict], data: dict, strict: bool = True) -> dict:
    by_key = {f["key"]: f for f in fields}
    out = {}
    for k, v in (data or {}).items():
        f = by_key.get(k)
        if f is None:
            if strict:
                raise HTTPException(422, f"campo sconosciuto: {k}")
            continue
        out[k] = _coerce_value(f, v, strict=strict)
    return out
 
 
def _item_payload(row) -> dict:
    d = dict(row)
    d["data"] = json.loads(d["data"] or "{}")
    return d
 
 
# ---- CRUD liste ----
 
@app.get("/api/lists")
def get_lists():
    conn = get_db()
    rows = conn.execute("SELECT * FROM lists ORDER BY updated_at DESC").fetchall()
    out = [_list_payload(conn, r) for r in rows]
    conn.close()
    return out
 
 
@app.post("/api/lists", status_code=201)
def create_list(l: ListCreate):
    for f in l.fields:  # valida PRIMA di aprire la transazione
        _check_field_def(f.label, f.type, f.options)
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO lists (name, description) VALUES (?, ?)",
            (l.name.strip(), (l.description or None) and l.description.strip()),
        )
        lid = cur.lastrowid
        for i, f in enumerate(l.fields):
            _insert_field(conn, lid, f, i)
        conn.commit()
        row = conn.execute("SELECT * FROM lists WHERE id = ?", (lid,)).fetchone()
        return _list_payload(conn, row)
    finally:
        conn.close()
 
 
@app.patch("/api/lists/{list_id}")
def update_list(list_id: int, l: ListUpdate):
    fields = l.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(422, "Nessun campo da aggiornare")
    if "name" in fields and isinstance(fields["name"], str):
        fields["name"] = fields["name"].strip()
    fields["updated_at"] = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    conn = get_db()
    cur = conn.execute(f"UPDATE lists SET {set_clause} WHERE id = ?",
                       list(fields.values()) + [list_id])
    conn.commit()
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(404, "Lista non trovata")
    row = conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    out = _list_payload(conn, row)
    conn.close()
    return out
 
 
@app.delete("/api/lists/{list_id}", status_code=204)
def delete_list(list_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Lista non trovata")
    return None
 
 
# ---- Campi ----
 
@app.post("/api/lists/{list_id}/fields", status_code=201)
def create_field(list_id: int, f: FieldDef):
    _check_field_def(f.label, f.type, f.options)
    conn = get_db()
    try:
        if not _list_exists(conn, list_id):
            raise HTTPException(404, "Lista non trovata")
        nxt = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM list_fields WHERE list_id = ?", (list_id,)
        ).fetchone()[0]
        _insert_field(conn, list_id, f, nxt)
        _touch_list(conn, list_id)
        conn.commit()
        out = _load_fields(conn, list_id)
        return out[-1] if out else None
    finally:
        conn.close()
 
 
@app.patch("/api/lists/{list_id}/fields/{field_id}")
def update_field(list_id: int, field_id: int, f: FieldUpdate):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM list_fields WHERE id = ? AND list_id = ?", (field_id, list_id)
    ).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Campo non trovato")
    upd = f.model_dump(exclude_unset=True)
    if not upd:
        conn.close()
        raise HTTPException(422, "Nessun campo da aggiornare")
    new_type = upd.get("type", row["type"])
    new_opts = upd["options"] if "options" in upd else (json.loads(row["options"]) if row["options"] else None)
    try:
        _check_field_def(upd.get("label", row["label"]), new_type, new_opts)
    except HTTPException:
        conn.close()
        raise
    if "options" in upd:
        upd["options"] = json.dumps(upd["options"], ensure_ascii=False) if upd["options"] else None
    if "label" in upd and isinstance(upd["label"], str):
        upd["label"] = upd["label"].strip()
    set_clause = ", ".join(f"{k} = ?" for k in upd)
    conn.execute(f"UPDATE list_fields SET {set_clause} WHERE id = ?",
                 list(upd.values()) + [field_id])
    _touch_list(conn, list_id)
    conn.commit()
    out = next(x for x in _load_fields(conn, list_id) if x["id"] == field_id)
    conn.close()
    return out
 
 
@app.delete("/api/lists/{list_id}/fields/{field_id}", status_code=204)
def delete_field(list_id: int, field_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT key FROM list_fields WHERE id = ? AND list_id = ?", (field_id, list_id)
    ).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Campo non trovato")
    conn.execute("DELETE FROM list_fields WHERE id = ?", (field_id,))
    # ripulisce il valore dalle voci esistenti
    key = row["key"]
    for it in conn.execute("SELECT id, data FROM list_items WHERE list_id = ?", (list_id,)).fetchall():
        d = json.loads(it["data"] or "{}")
        if key in d:
            d.pop(key)
            conn.execute("UPDATE list_items SET data = ? WHERE id = ?",
                         (json.dumps(d, ensure_ascii=False), it["id"]))
    _touch_list(conn, list_id)
    conn.commit()
    conn.close()
    return None
 
 
# ---- Voci ----
 
@app.get("/api/lists/{list_id}/items")
def get_items(list_id: int):
    conn = get_db()
    if not _list_exists(conn, list_id):
        conn.close()
        raise HTTPException(404, "Lista non trovata")
    rows = conn.execute(
        "SELECT * FROM list_items WHERE list_id = ? ORDER BY created_at DESC, id DESC", (list_id,)
    ).fetchall()
    conn.close()
    return [_item_payload(r) for r in rows]
 
 
@app.post("/api/lists/{list_id}/items", status_code=201)
def create_item(list_id: int, item: ItemIn):
    conn = get_db()
    if not _list_exists(conn, list_id):
        conn.close()
        raise HTTPException(404, "Lista non trovata")
    try:
        data = _validate_item_data(_load_fields(conn, list_id), item.data)
    except HTTPException:
        conn.close()
        raise
    cur = conn.execute(
        "INSERT INTO list_items (list_id, data) VALUES (?, ?)",
        (list_id, json.dumps(data, ensure_ascii=False)),
    )
    _touch_list(conn, list_id)
    conn.commit()
    row = conn.execute("SELECT * FROM list_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _item_payload(row)
 
 
@app.patch("/api/lists/{list_id}/items/{item_id}")
def update_item(list_id: int, item_id: int, item: ItemIn):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id)
    ).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Voce non trovata")
    fields = _load_fields(conn, list_id)
    merged = json.loads(row["data"] or "{}")
    try:
        merged.update(_validate_item_data(fields, item.data))
    except HTTPException:
        conn.close()
        raise
    merged = {k: v for k, v in merged.items() if v is not None}
    now = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    conn.execute("UPDATE list_items SET data = ?, updated_at = ? WHERE id = ?",
                 (json.dumps(merged, ensure_ascii=False), now, item_id))
    _touch_list(conn, list_id)
    conn.commit()
    row = conn.execute("SELECT * FROM list_items WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return _item_payload(row)
 
 
@app.delete("/api/lists/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: int, item_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id))
    if cur.rowcount:
        _touch_list(conn, list_id)
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Voce non trovata")
    return None
 
 
# ---- LLM: suggerimento campi e autofill voci ----

 
def _llm_message(system: str, user: str, max_tokens: int = 1200) -> str:
    if not LLM_API_KEY:
        raise HTTPException(503, "GILPA_LLM_API_KEY non configurata: funzioni AI non disponibili")
    import httpx
    try:
        r = httpx.post(f"{LLM_BASE_URL}/chat/completions", timeout=120,
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={"model": LLM_MODEL, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user}]})
        if r.status_code == 429:
            raise HTTPException(429, "Limite di richieste raggiunto, riprova tra poco")
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Errore LLM: {e}")
 
 
def _extract_json(text: str):
    """Estrae il primo blocco JSON (array o oggetto) dalla risposta del modello."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"[\[{].*[\]}]", t, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise HTTPException(502, "Risposta del modello non interpretabile come JSON")
 
 
@app.post("/api/lists/suggest-fields")
def suggest_fields(body: SuggestFieldsIn):
    """Chiede al modello una proposta di campi per una lista (nuova o esistente)."""
    system = (
        "Progetti schemi per liste personali di un'app di organizzazione. "
        "Rispondi SOLO con un array JSON valido, senza testo aggiuntivo e senza backtick. "
        "Ogni elemento: {\"label\": string (italiano, max 3 parole), \"type\": uno tra "
        "text|number|boolean|date|url|select|rating, \"options\": array di stringhe SOLO se type=select}."
    )
    existing = ", ".join(body.existing) if body.existing else "nessuno"
    user = (
        f"Lista: \"{body.name.strip()}\"\n"
        f"Descrizione: {body.description.strip() if body.description else '—'}\n"
        f"Campi già presenti (NON riproporli): {existing}\n"
        "Proponi da 3 a 7 campi utili per questa lista."
    )
    raw = _extract_json(_llm_message(system, user))
    if not isinstance(raw, list):
        raise HTTPException(502, "Il modello non ha restituito un array di campi")
    out, seen = [], {slugify(e) for e in body.existing}
    for it in raw:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label", "")).strip()[:60]
        ftype = str(it.get("type", "text")).strip()
        opts = it.get("options")
        if not label or ftype not in FIELD_TYPES:
            continue
        if slugify(label) in seen:
            continue
        seen.add(slugify(label))
        if ftype == "select":
            opts = [str(o).strip() for o in opts if str(o).strip()] if isinstance(opts, list) else []
            if not opts:
                ftype = "text"; opts = None
        else:
            opts = None
        out.append({"label": label, "type": ftype, "options": opts})
    if not out:
        raise HTTPException(502, "Nessun campo valido nella risposta del modello")
    return {"fields": out}
 
 
@app.post("/api/lists/{list_id}/items/suggest")
def suggest_item(list_id: int, body: SuggestItemIn):
    """Autofill dei valori di una voce a partire da un titolo/indizio.
    I valori sono PROPOSTE del modello: vanno confermati dall'utente nel form."""
    conn = get_db()
    lrow = conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    if lrow is None:
        conn.close()
        raise HTTPException(404, "Lista non trovata")
    fields = _load_fields(conn, list_id)
    conn.close()
    if not fields:
        raise HTTPException(422, "La lista non ha campi")
    schema = "\n".join(
        f"- key: {f['key']} | label: {f['label']} | tipo: {f['type']}"
        + (f" | opzioni: {', '.join(f['options'])}" if f.get("options") else "")
        for f in fields
    )
    system = (
        "Compili schede di voci per liste personali. Rispondi SOLO con un oggetto JSON valido "
        "{key: valore}, senza testo aggiuntivo e senza backtick. Usa null quando non conosci il valore "
        "con ragionevole certezza: NON inventare numeri o date. Formati: number=numero, boolean=true/false, "
        "date=\"YYYY-MM-DD\", rating=intero 0-10, select=una delle opzioni esatte, text/url=stringa."
    )
    user = (
        f"Lista: \"{lrow['name']}\"" + (f" — {lrow['description']}" if lrow["description"] else "") + "\n"
        f"Voce da compilare: \"{body.hint.strip()}\"\n"
        f"Campi:\n{schema}"
    )
    raw = _extract_json(_llm_message(system, user, max_tokens=800))
    if not isinstance(raw, dict):
        raise HTTPException(502, "Il modello non ha restituito un oggetto JSON")
    data = _validate_item_data(fields, raw, strict=False)
    data = {k: v for k, v in data.items() if v is not None}
    return {"data": data, "model": LLM_MODEL}
