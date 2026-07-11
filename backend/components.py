"""GILPA — router Componenti + lista spesa."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..db import get_db
from ..config import PRIORITIES, COMPONENT_STATUSES

router = APIRouter()

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

 
COMP_SELECT = """
    SELECT c.*, p.name AS project_name, p.category AS project_category
    FROM components c LEFT JOIN projects p ON c.project_id = p.id
"""
 
 
def project_exists(conn, pid: int) -> bool:
    return conn.execute("SELECT 1 FROM projects WHERE id = ?", (pid,)).fetchone() is not None
 
 
@router.get("/api/components")
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
 
 
@router.get("/api/projects/{project_id}/components")
def list_project_components(project_id: int):
    conn = get_db()
    rows = conn.execute(COMP_SELECT + " WHERE c.project_id = ? ORDER BY c.created_at DESC",
                        (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]
 
 
@router.get("/api/shopping-list/summary")
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
 
 
@router.post("/api/components", status_code=201)
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
 
 
@router.patch("/api/components/{component_id}")
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
 
 
@router.delete("/api/components/{component_id}", status_code=204)
def delete_component(component_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM components WHERE id = ?", (component_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Componente non trovato")