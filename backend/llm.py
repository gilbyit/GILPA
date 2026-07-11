"""GILPA — client LLM (OpenAI-compatible) e parsing JSON."""
import json
import re

from fastapi import HTTPException

from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL


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