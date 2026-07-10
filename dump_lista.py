import sqlite3, json, sys

DB = sys.argv[1] if len(sys.argv) > 1 else "gilpa.db"
con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

out = {}

out["lists"] = [dict(r) for r in con.execute(
    "SELECT id, name, description FROM lists")]

# individua la lista anime (adatta il filtro se il nome è diverso)
row = con.execute(
    "SELECT id FROM lists WHERE lower(name) LIKE '%anime%' LIMIT 1").fetchone()

if row:
    lid = row["id"]
    out["list_id"] = lid
    out["fields"] = [dict(r) for r in con.execute(
        "SELECT key,label,type,options,sort_order FROM list_fields "
        "WHERE list_id=? ORDER BY sort_order", (lid,))]
    out["items"] = [json.loads(r["data"]) for r in con.execute(
        "SELECT data FROM list_items WHERE list_id=?", (lid,))]
    out["n_items"] = len(out["items"])

print(json.dumps(out, indent=2, ensure_ascii=False))