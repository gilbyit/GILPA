"""GILPA — helper condivisi (slug, chiavi, colori)."""
import re
from typing import Optional

from .config import HEX_RE


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