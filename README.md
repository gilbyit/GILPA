# GILPA — Gil's Personal Assistant
 
Assistente personale self-hosted, in esecuzione sul server di casa **NASGUL**.
Gestisce progetti, materiali da acquistare, time-blocking e sessioni di lavoro,
con l'idea di pilotarlo in linguaggio naturale tramite la Claude API.
 
Niente cloud, niente abbonamenti: gira tutto in locale dentro Docker, e l'unica
cosa che esce verso internet sono le (future) chiamate all'API di Claude.
 
---
 
## Stato attuale
 
> Versione backend: **0.3.0**
 
Funzionante e in uso:
 
- **Progetti** — CRUD completo (crea, modifica, elimina, filtra per stato, ricerca).
- **Categorie dinamiche** — gestibili da interfaccia, con colore personalizzato e
  conteggio dei progetti associati; si possono creare al volo mentre si inserisce un progetto.
- **Interfaccia web** — PWA con tema scuro, servita da nginx.
In sviluppo / pianificato: vedi la [Roadmap](#roadmap).
 
---
 
## Stack
 
| Livello | Tecnologia |
|---|---|
| Backend | Python 3 + FastAPI |
| Database | SQLite (un singolo file) |
| Frontend | PWA — HTML/CSS/JS vanilla |
| LLM (previsto) | Claude API (Haiku / Sonnet) |
| Accesso remoto (previsto) | Tailscale |
| Deploy | Docker / Docker Compose |
 
**Scelte di design**
 
- *SQLite invece di PostgreSQL*: per un utente singolo è più che sufficiente, non
  richiede un demone separato e il backup è copiare un file.
- *PWA invece di app nativa*: zero installazione, gira su qualsiasi browser,
  aggiornamenti istantanei.
- *Claude API invece di LLM locale*: l'i5-3470T di NASGUL non ha potenza per un
  modello decente; le API costano pochissimo per uso personale e la qualità è superiore.
---
 
## Architettura
 
```
                      NASGUL (LAN)
┌──────────────────────────────────────────────────┐
│                                                    │
│   gilpa-frontend (nginx)        gilpa-backend       │
│   PWA · porta 8471      ──►     FastAPI · porta 8470 │
│                                      │              │
│                                      ▼              │
│                                 data/gilpa.db        │
│                                  (SQLite)            │
│                                                      │
└──────────────────────────────────────────────────┘
                         │ Tailscale (previsto)
                         ▼
                   Claude API (LLM, previsto)
```
 
Il frontend chiama il backend sulla porta `8470` (CORS aperto). In alternativa si
può usare un proxy nginx `/api` → backend.
 
---
 
## Struttura del progetto
 
```
gilpa/
├── docker-compose.yml
├── .env                  # variabili d'ambiente — NON versionato
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py           # FastAPI: endpoint progetti + categorie
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── index.html        # interfaccia (tema scuro)
└── data/                 # NON versionato
    └── gilpa.db          # database SQLite (creato all'avvio)
```
 
`data/` e `.env` sono esclusi dal versionamento: contengono rispettivamente i dati
personali e la chiave API.
 
---
 
## Avvio
 
Requisiti: Docker e Docker Compose.
 
1. Crea il file `.env` nella root con la tua chiave API:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   DATABASE_PATH=/app/data/gilpa.db
   ```
 
2. Avvia lo stack:
   ```bash
   docker compose up -d --build
   ```
 
3. Apri l'interfaccia:
   - Frontend: `http://<IP-NASGUL>:8471`
   - Backend (API/health): `http://<IP-NASGUL>:8470`
Il database e le tabelle (categorie incluse, con le 4 di default) vengono creati
automaticamente al primo avvio del backend.
 
Per aggiornare dopo una modifica:
 
```bash
docker restart gilpa-backend                 # il backend è montato come volume
docker compose up -d --build gilpa-frontend  # il frontend va ricostruito
```
 
---
 
## API
 
Tutti gli endpoint applicativi sono sotto `/api`. `/health` sta sulla root.
 
| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/health` | Stato e versione del backend |
| GET | `/api/stats` | Conteggi progetti per stato |
| GET | `/api/projects` | Lista progetti (filtri: `status`, `category`) |
| POST | `/api/projects` | Crea progetto |
| GET | `/api/projects/{id}` | Dettaglio progetto |
| PATCH | `/api/projects/{id}` | Modifica progetto |
| DELETE | `/api/projects/{id}` | Elimina progetto |
| GET | `/api/categories` | Lista categorie + conteggio progetti |
| POST | `/api/categories` | Crea categoria (chiave generata dal nome) |
| PATCH | `/api/categories/{id}` | Modifica nome/colore |
| DELETE | `/api/categories/{id}` | Elimina (bloccato se in uso) |
 
---
 
## Roadmap
 
- [x] CRUD progetti
- [x] Categorie dinamiche con conteggio + creazione al volo
- [ ] **Componenti** agganciati ai progetti (negozio, prezzo, quantità, stato d'acquisto)
- [ ] **Lista spesa** raggruppata per negozio con totali
- [ ] **Pomodoro** timer + log attività
- [ ] **Chat / cervello LLM** — endpoint `/api/chat` con Claude API ("vado da Action" → lista materiali)
- [ ] **Accesso remoto** via Tailscale
- [ ] Notifiche (Telegram / ntfy) e suggerimenti proattivi
---
 
## Note
 
Progetto personale, single-user, pensato per girare su hardware modesto e di recupero.
Documentazione di design più estesa in `GILPA_schema.md`.
