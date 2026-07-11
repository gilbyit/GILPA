"""GILPA — router Liste personalizzate (campi, voci, riordino, AI)."""
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Any

from ..db import get_db
from ..helpers import slugify
from ..config import FIELD_TYPES, DATE_RE, TRUE_SET
from ..llm import _llm_message, _extract_json

router = APIRouter()

class FieldDef(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    type: str = "text"
    options: Optional[list[str]] = None
 
 
class FieldUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=60)
    type: Optional[str] = None
    options: Optional[list[str]] = None
    sort_order: Optional[int] = None
 
 
class FieldsReorder(BaseModel):
    order: list[int] = Field(..., min_length=1)


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

@router.get("/api/lists")
def get_lists():
    conn = get_db()
    rows = conn.execute("SELECT * FROM lists ORDER BY updated_at DESC").fetchall()
    out = [_list_payload(conn, r) for r in rows]
    conn.close()
    return out
 
 
@router.post("/api/lists", status_code=201)
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
 
 
@router.patch("/api/lists/{list_id}")
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
 
 
@router.delete("/api/lists/{list_id}", status_code=204)
def delete_list(list_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Lista non trovata")
    return None
 
 
# ---- Campi ----
 
@router.post("/api/lists/{list_id}/fields", status_code=201)
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
 
 
@router.patch("/api/lists/{list_id}/fields/{field_id}")
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
 
 
@router.delete("/api/lists/{list_id}/fields/{field_id}", status_code=204)
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
 
 
@router.put("/api/lists/{list_id}/fields/reorder")
def reorder_fields(list_id: int, body: FieldsReorder):
    """Riordina i campi di una lista. `order` deve contenere ESATTAMENTE tutti
    gli id dei campi della lista, una volta ciascuno, nell'ordine desiderato."""
    conn = get_db()
    try:
        if not _list_exists(conn, list_id):
            raise HTTPException(404, "Lista non trovata")
        current = [
            r["id"] for r in conn.execute(
                "SELECT id FROM list_fields WHERE list_id = ?", (list_id,)
            ).fetchall()
        ]
        if sorted(body.order) != sorted(current):
            raise HTTPException(
                422,
                "L'ordine deve contenere tutti e soli gli id dei campi della lista, senza duplicati",
            )
        # Nessuna scrittura prima della validazione: niente transazioni aperte su 422.
        for i, fid in enumerate(body.order):
            conn.execute(
                "UPDATE list_fields SET sort_order = ? WHERE id = ? AND list_id = ?",
                (i, fid, list_id),
            )
        _touch_list(conn, list_id)
        conn.commit()
        return _load_fields(conn, list_id)
    finally:
        conn.close()
 
 
# ---- Voci ----
 
@router.get("/api/lists/{list_id}/items")
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
 
 
@router.post("/api/lists/{list_id}/items", status_code=201)
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
 
 
@router.patch("/api/lists/{list_id}/items/{item_id}")
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
 
 
@router.delete("/api/lists/{list_id}/items/{item_id}", status_code=204)
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

@router.post("/api/lists/suggest-fields")
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
 
 
@router.post("/api/lists/{list_id}/items/suggest")
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