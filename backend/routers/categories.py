"""GILPA — router Categorie."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..db import get_db
from ..helpers import slugify, unique_key, auto_color, valid_color
from ..config import HEX_RE

router = APIRouter()

class CategoryCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    color: Optional[str] = None
 
 
class CategoryUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=60)
    color: Optional[str] = None
 

@router.get("/api/categories")
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
 
 
@router.post("/api/categories", status_code=201)
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
 
 
@router.patch("/api/categories/{category_id}")
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
 
 
@router.delete("/api/categories/{category_id}", status_code=204)
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