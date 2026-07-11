"""GILPA — router Progetti."""
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..db import get_db
from ..helpers import category_exists
from ..config import STATUSES

router = APIRouter()

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
 

@router.get("/api/projects")
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
 
 
@router.post("/api/projects", status_code=201)
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
 
 
@router.patch("/api/projects/{project_id}")
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
 
 
@router.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Progetto non trovato")