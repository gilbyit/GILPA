"""GILPA Backend — FastAPI (v0.7.0)

App slim: monta i router per dominio. Logica in
  db.py, config.py, helpers.py, llm.py, routers/{categories,projects,components,lists}.py
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, get_db
from .routers import categories, projects, components, lists

app = FastAPI(title="GILPA", version="0.7.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


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


app.include_router(categories.router)
app.include_router(projects.router)
app.include_router(components.router)
app.include_router(lists.router)