# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start frontend + backend together (recommended)
npm run dev

# Frontend only (port 5174)
npm run dev:frontend

# Backend only (port 4000, tsx watch)
npm run backend:dev

# Kill stale ports and restart both
npm run dev:reset

# Build frontend (outputs to dist/)
npm run build

# Lint frontend
npm run lint

# Type-check backend
npm run backend:typecheck

# Lint + build + typecheck in one pass
npm run platform:check

# Install backend dependencies (run once, or after backend/package.json changes)
npm run backend:install
```

### Backend CLI scripts (run from repo root)

```bash
npm --prefix backend run timon:sync                         # daily Tímon import
npm --prefix backend run timon:sync -- --workspace south --fromdate 2026-02-01 --todate 2026-03-31
npm --prefix backend run backup:lists                       # snapshot Lists to JSON
npm --prefix backend run generate:shifts                    # CLI shift generation
```

### Useful dev endpoints

```
GET  /api/health                                      # backend status
GET  /api/debug/env                                   # effective env/field mapping
GET  /api/debug/list-fields?list=instances&sample=1   # inspect SharePoint column names
GET  /api/debug/timon-readiness                       # Tímon config check
POST /api/debug/timon-preview                         # dry-run Tímon import (no writes)
GET  /api/debug/shift-generation-preview?workspaceId=south&month=2026-05
```

## Architecture

### Two-process monorepo

| Layer | Tech | Port |
|---|---|---|
| Frontend | Vite + React 19, JSX, Mantine v8 | 5174 |
| Backend | Express + TypeScript (tsx), no transpile step | 4000 |

In dev, Vite proxies `/api` and `/confirm` to `http://127.0.0.1:4000`. In production, the backend serves the built `dist/` directly (`SERVE_FRONTEND=true`), so there is a single origin and no proxy needed.

### Data layer: Microsoft Lists (no local database)

The backend has no SQL database. All persistent state lives in **Microsoft SharePoint Lists**, accessed via **Microsoft Graph API**. The two primary lists are:

- **ShiftPatterns** – recurring shift templates (route, time, day-of-week). Read-only from the app.
- **ShiftInstances** – one row per concrete shift occurrence. Created by the generate endpoint; updated by assign/confirm actions.

Supporting lists (optional, read-only):
- **Buses**, **Drivers**, **Workspaces**, **TripsTemplates**, **StopsTemplate**, **Templates/ShiftTemplates**, **Routes**

### Field name indirection

Microsoft Lists often uses internal column names like `field_1`, `field_4` instead of display names. Every column the backend reads or writes is configurable via env vars (`LIST_FIELD_*`, `PATTERN_FIELD_*`, `STOPSTEMPLATE_FIELD_*`, etc.) with sensible defaults. The canonical mapping is in `backend/src/services/msListsConfig.ts`. When a field isn't found, use `/api/debug/list-fields?list=instances&sample=1` to find the real internal name, then override in `backend/.env`.

### Graph auth modes (backend → Microsoft)

1. **App-only / client credentials** (production): set `AZURE_CLIENT_SECRET` → uses `client_credentials` grant.
2. **Device Code** (dev, no secret): leave `AZURE_CLIENT_SECRET` blank → backend prints a browser code on first request.
3. **Bearer token shortcut** (one-off dev): set `GRAPH_BEARER_TOKEN` → bypasses all auth; expires in ~1 hour.

### Frontend auth (optional Entra ID)

Controlled by `VITE_ENTRA_*` env vars at build time. If all three (`VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_API_SCOPE`) are set, the frontend uses MSAL (`src/auth/msal.js`) and attaches a Bearer token to every API call. The backend validates it only when `AUTH_ENABLED=true`. Both sides can be configured independently — check `/health` which reports `authEnabled`.

### Shift lifecycle

```
ShiftPatterns (SharePoint)
    │
    ▼ POST /api/generate/shifts?workspaceId=&month=
ShiftInstances (SharePoint)   ← also auto-generated on first GET if AUTO_GENERATE_SHIFTS_ON_READ=true
    │
    ▼ PATCH via assign / confirm endpoints
Driver assigned, email sent, confirmation link tracked
```

### Workspaces

Hardcoded fallback list is in `src/workspaces.js`. At runtime, the backend calls `GET /api/workspaces` which reads from a SharePoint list named **Workspaces** (or `MS_WORKSPACES_LIST_ID`). The frontend merges the two: if the API returns data it takes precedence; otherwise the local fallback is used. The `workspaceId` slug (e.g. `south`, `school`, `airport`) is stored on every ShiftInstance and ShiftPattern row.

### Tímon integration

Tímon is an external workforce scheduling system. `backend/src/services/timonService.ts` fetches shift plans from `https://gts.timon.is/api/v2`. `timonSyncService.ts` matches Tímon rows to local ShiftInstances by route code + shift name + date, then writes driver assignments back. A Render cron job runs this daily at 04:00 UTC. The sync is idempotent via `externalShiftId` / `externalSource` columns on ShiftInstances.

### Email confirmation flow

`POST /api/shifts/:id/assign-and-email` sends a signed link (`CONFIRM_LINK_SECRET`) to the driver. The link hits `/confirm/:token`, which is a lightweight Express HTML page (not the React SPA) so drivers can confirm without signing in.

### i18n

Frontend uses a minimal custom i18n helper. Translations live in `src/i18n/translations.js` with `en` and `is` (Icelandic) keys. Missing `is` keys fall back to `en`. Language is persisted to `localStorage` under `fleetScheduler.lang`.

## Environment setup

```bash
cp backend/.env.example backend/.env
# Fill in MS_SITE_ID, MS_SHIFT_INSTANCES_LIST_ID, MS_SHIFT_PATTERNS_LIST_ID,
# AZURE_CLIENT_ID, and optionally AZURE_CLIENT_SECRET
```

Frontend env vars go in `.env` at the repo root (Vite reads them at build time). See `.env.example`.
