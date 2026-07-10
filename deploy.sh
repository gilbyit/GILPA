#!/usr/bin/env bash
#
# GILPA — deploy.sh
# Aggiorna il codice da GitHub e riavvia solo ciò che serve.
#
#   ./deploy.sh            aggiorna e riavvia il necessario
#   ./deploy.sh --force    riavvia tutto anche senza nuovi commit
#   ./deploy.sh --no-pull  salta il git pull (rebuild di file già in locale)
#
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

# ---------- output ----------
if [[ -t 1 ]]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; N=$'\e[0m'
else
  R=""; G=""; Y=""; C=""; N=""
fi
info() { printf '%s▸%s %s\n' "$C" "$N" "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ---------- opzioni ----------
FORCE=0; DO_PULL=1
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --no-pull) DO_PULL=0 ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) die "opzione sconosciuta: $arg" ;;
  esac
done

# ---------- prerequisiti ----------
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  die "docker compose non trovato"
fi

[[ -f docker-compose.yml ]] || die "docker-compose.yml non trovato: sei nella cartella giusta?"
[[ -f .env ]] || warn ".env assente — le funzioni AI resteranno disattivate"

# ---------- git pull ----------
CHANGED=""
if (( DO_PULL )); then
  [[ -d .git ]] || die "questa cartella non è un repo git: usa --no-pull"

  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    git status --short
    die "ci sono modifiche locali non committate. Fai commit, stash, o usa --no-pull."
  fi

  OLD=$(git rev-parse HEAD)
  info "git pull…"
  git pull --ff-only
  NEW=$(git rev-parse HEAD)

  if [[ "$OLD" == "$NEW" ]]; then
    if (( ! FORCE )); then
      ok "già aggiornato ($(git rev-parse --short HEAD)). Niente da fare."
      echo "  Usa --force per riavviare comunque."
      exit 0
    fi
    warn "nessun nuovo commit, procedo per --force"
  else
    CHANGED=$(git diff --name-only "$OLD" "$NEW")
    info "commit: $(git rev-parse --short "$OLD") → $(git rev-parse --short "$NEW")"
    git log --oneline "$OLD..$NEW" | sed 's/^/    /'
  fi
fi

# ---------- cosa toccare ----------
# Il backend è bind-mounted (./backend:/app/src) → basta il restart.
# Rebuild solo se cambiano le dipendenze o l'immagine.
# Il frontend è COPY-ato nell'immagine → rebuild obbligatorio a ogni modifica.
matches() { [[ -n "$CHANGED" ]] && grep -qE "$1" <<<"$CHANGED"; }

BE_REBUILD=0; BE_RESTART=0; FE_REBUILD=0
if (( FORCE )) || (( ! DO_PULL )); then
  BE_REBUILD=1; FE_REBUILD=1
else
  matches '^backend/(Dockerfile|requirements\.txt)$' && BE_REBUILD=1
  matches '^backend/'                                && BE_RESTART=1
  matches '^frontend/'                               && FE_REBUILD=1
  matches '^docker-compose\.yml$'                    && { BE_REBUILD=1; FE_REBUILD=1; }
fi
(( BE_REBUILD )) && BE_RESTART=0   # il rebuild riavvia già

if (( ! BE_REBUILD && ! BE_RESTART && ! FE_REBUILD )); then
  ok "nuovi commit, ma nessun file rilevante per i container."
  exit 0
fi

# ---------- applica ----------
if (( BE_REBUILD )); then
  info "backend: rebuild (dipendenze o immagine cambiate)"
  "${DC[@]}" up -d --build gilpa-backend
elif (( BE_RESTART )); then
  info "backend: restart (codice bind-mounted)"
  docker restart gilpa-backend >/dev/null
fi

if (( FE_REBUILD )); then
  info "frontend: rebuild"
  "${DC[@]}" up -d --build gilpa-frontend
fi

# ---------- verifica ----------
PORT=$(grep -E '^GILPA_PORT_BACKEND=' .env 2>/dev/null | cut -d= -f2 || true)
PORT=${PORT:-8470}

info "attendo il backend su :$PORT…"
for i in $(seq 1 20); do
  if BODY=$(curl -fsS --max-time 2 "http://localhost:$PORT/health" 2>/dev/null); then
    VER=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"$BODY")
    ok "backend online — GILPA v${VER:-?}"
    break
  fi
  [[ $i -eq 20 ]] && { warn "backend non risponde dopo 20s"; docker logs --tail 30 gilpa-backend; exit 1; }
  sleep 1
done

if grep -q '^ANTHROPIC_API_KEY=.\+' .env 2>/dev/null || grep -q '^GILPA_LLM_API_KEY=.\+' .env 2>/dev/null; then
  ok "chiave LLM presente"
else
  warn "nessuna chiave LLM nel .env — i bottoni AI risponderanno 503"
fi

"${DC[@]}" ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || true
ok "deploy completato."
