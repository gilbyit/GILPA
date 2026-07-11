"""GILPA — costanti e configurazione."""
import os
import re

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

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRUE_SET = {"1", "true", "si", "sì", "yes", "on"}