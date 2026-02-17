# Fleet Scheduler

Vite/React frontend + a small Node/Express backend that integrates with Microsoft Lists (via Microsoft Graph).

## Requirements

- Node.js 18+ (recommended: 20+)

## Frontend

```bash
npm install
npm run dev
```

Vite will print the local URL (typically `http://localhost:5173`).

### Run frontend + backend together (recommended)

```bash
npm install
npm run dev:all
```

This avoids the common "Generate does nothing" / "HTTP 500" symptom that happens when the backend on `http://localhost:4000` is not running.

## Translations (English + Icelandic)

The frontend has a small built-in i18n helper with English (`en`) and Icelandic (`is`).

- Edit translations in `src/i18n/translations.js`
- Fill in the `is: { ... }` section with Icelandic strings
- Missing keys automatically fall back to English, so you can translate gradually

Language selection is stored in the browser in localStorage (`fleetScheduler.lang`).

## Backend

Install backend deps from the repo root:

```bash
npm run backend:install
```

Create your backend env file:

```bash
cp backend/.env.example backend/.env
```

Run the backend (ts-node-dev):

```bash
npm run backend:dev
```

(Alternative, if you prefer ts-node-dev)

```bash
npm run backend:dev:tsnode
```

Health check:

```bash
curl http://localhost:4000/api/health
```

## Publish (production)

Fastest option: Render (recommended)

This deploys the app as **one Node service**:

- Backend serves the built frontend (`dist/`)
- Backend also serves the API under `/api`

So managers only need **one URL**.

### Publish to Render (very step-by-step)

#### Step 0 — Put the code on GitHub

Render deploys from GitHub.

1) Create a GitHub account (if you don’t have one)
2) Create a new repo (example name): `gts-flotastjori`
3) From your Mac, push this project:

```bash
cd /Users/GTS/Desktop/fleet-scheduler
git init
git add -A
git commit -m "Initial commit"
git branch -M main

# Replace with YOUR GitHub repo URL:
git remote add origin https://github.com/<your-user>/gts-flotastjori.git
git push -u origin main
```

Important: do **not** commit secrets. This repo already ignores `.env` files.

#### Step 1 — Create the Render service

1) Go to https://render.com
2) Sign up / log in
3) Click **New +** → **Web Service**
4) Connect your GitHub account
5) Pick your repo

When Render asks for commands, use exactly these:

- **Build Command**

```bash
npm install && npm run backend:install && npm run build
```

- **Start Command**

```bash
npm --prefix backend run start:prod
```

Then click **Create Web Service**.

Render will give you a URL like:

- `https://<service-name>.onrender.com`

#### Step 2 — Add environment variables in Render

In Render → your service → **Environment**:

1) Add `APP_ORIGIN` = your Render URL

Example:

- `APP_ORIGIN=https://<service-name>.onrender.com`

2) Add everything required from `backend/.env.example` (Graph + Lists IDs + mail sender)

3) If you want Entra-protected API in production (recommended), set:

- `AUTH_ENABLED=true`
- `ENTRA_TENANT_ID=...`
- `ENTRA_API_AUDIENCE=...` (example: `api://<API app client id>`) 
- `ENTRA_REQUIRED_SCOPE=access_as_user`

4) Set the frontend build-time Entra variables (these are required for the Sign-in screen):

- `VITE_ENTRA_TENANT_ID=...`
- `VITE_ENTRA_CLIENT_ID=...` (your SPA app client id)
- `VITE_ENTRA_API_SCOPE=api://<API app client id>/access_as_user`

Tip: there is also a ready-to-use blueprint file at `render.yaml` in the repo.

#### Step 3 — Update Entra redirect URI (THIS IS REQUIRED)

In Microsoft Entra (Azure AD) → App registrations → your **SPA** app:

Authentication → Single-page application → Add redirect URI:

- `https://<service-name>.onrender.com/`

Save.

#### Step 4 — Test the deployed site

Open your Render URL:

- `https://<service-name>.onrender.com`

Then verify the backend is up (no sign-in required for this endpoint):

- `https://<service-name>.onrender.com/health`

If that returns `{ ok: true, ... }`, the service is running.

---

Recommended: deploy as **one Node service** where the backend serves the built frontend.

### 1) Build the frontend

From the repo root:

```bash
npm install
npm run build
```

This creates `dist/`.

### 2) Start the backend in production mode (serves `dist/`)

From the repo root:

```bash
npm run backend:install
npm run prod:start
```

This starts the backend and serves the frontend from the same origin.

### 3) Configure Entra redirect URIs for production

In your Entra **SPA** app registration, add your production URL (example):

- `https://your-domain.com/`

### 4) Required environment variables on your server

- Backend (server): set the values from `backend/.env.example` (Graph + Lists IDs, and API auth if enabled)
- Frontend (only if you deploy frontend separately): set values from `.env.example`

Notes:

- If you use `AUTH_ENABLED=true`, the frontend must be configured with Entra (`VITE_ENTRA_*`) and users must sign in.
- For email links, set `APP_ORIGIN` in `backend/.env` to your production URL.

### Publish to Azure App Service (no domain required)

You can publish this app without buying a domain.
Azure will give you a public URL like:

- `https://<app-name>.azurewebsites.net`

#### Step 0 — Put the code on GitHub

Azure App Service can deploy from GitHub.

1) Create a GitHub account (if you don’t have one)
2) Create a new repository (example name): `gts-flotastjori`
3) From your Mac, push this project to that repo:

```bash
cd /path/to/fleet-scheduler
git init
git add -A
git commit -m "Initial commit"
git branch -M main

# Replace with YOUR GitHub repo URL:
git remote add origin https://github.com/<your-user>/gts-flotastjori.git
git push -u origin main
```

Important: do **not** commit secrets. This repo already ignores `.env` files.

#### Step 1 — Create the Azure Web App

In Azure Portal:

1) Create a **Resource group** (any name)
2) Create an **App Service Plan** (Linux is fine)
3) Create a **Web App**
	- Name: choose something like `gts-flotastjori` (must be globally unique; if taken, add `-1`)
	- Runtime stack: Node 20 LTS

After creation, your URL will be:

- `https://<app-name>.azurewebsites.net`

#### Step 2 — Connect GitHub deployment

In the Web App:

1) Deployment Center → GitHub
2) Pick your repo + `main` branch
3) Save

Azure will create a GitHub Actions workflow for you.

#### Step 3 — Set the startup command

In the Web App:

Configuration → General settings → Startup Command:

```bash
npm run prod:start
```

This builds the frontend and starts the backend in “single service” mode.

#### Step 4 — Add App Settings (environment variables)

In the Web App:

Configuration → Application settings → New application setting

Set these (from your `backend/.env` + Entra values):

- `AUTH_ENABLED=true`
- `ENTRA_TENANT_ID=...`
- `ENTRA_API_AUDIENCE=api://...`
- `ENTRA_REQUIRED_SCOPE=access_as_user`

- `AZURE_TENANT_ID=...`
- `AZURE_CLIENT_ID=...`
- `AZURE_CLIENT_SECRET=...`  (secret)

- `MS_SITE_ID=...`
- `MS_SHIFT_INSTANCES_LIST_ID=...`
- `MS_SHIFT_PATTERNS_LIST_ID=...`

- `MAIL_SENDER_UPN=...` (if sending email)

Set `APP_ORIGIN` to your Azure URL (used for CORS + email links):

- `APP_ORIGIN=https://<app-name>.azurewebsites.net`

Also add the frontend build-time vars so the Sign-in page works:

- `VITE_ENTRA_TENANT_ID=...`
- `VITE_ENTRA_CLIENT_ID=...`
- `VITE_ENTRA_API_SCOPE=api://<API app client id>/access_as_user`

Save, then restart the Web App.

#### Step 5 — Update Entra redirect URI for production

In Microsoft Entra (Azure AD) → App registrations → your **SPA** app:

Authentication → Single-page application → Add redirect URI:

- `https://<app-name>.azurewebsites.net/`

Save.

#### Step 6 — Test

Open:

- `https://<app-name>.azurewebsites.net`

Click “Sign in with Microsoft”, then confirm:

- `https://<app-name>.azurewebsites.net/api/health` returns `{ ok: true, ... }`

## Entra ID login (frontend → backend) — step by step

This section explains how to require users to sign in (Microsoft Entra ID) before the frontend can call the backend.

Good news: you do **not** need to share any secrets with anyone (including this chat).

### What you are building (simple picture)

1) The user opens the frontend (React).
2) The frontend signs the user in with Entra ID.
3) The frontend calls the backend with an access token: `Authorization: Bearer <token>`.
4) The backend checks the token is real and meant for *this* API.

### You need 2 app registrations in Entra

You’ll create:

- **A “SPA” app** (represents the browser frontend)
- **An “API” app** (represents the backend API)

#### Step 1 — Create the backend API app registration

In Microsoft Entra admin center:

1) App registrations → New registration
2) Name: `Fleet Scheduler API` (any name is fine)
3) Register

Now configure a scope (permission) the frontend can request:

1) Open your new app → Expose an API
2) Set **Application ID URI** (often `api://<this-app-client-id>`)
3) Add a scope
	 - Scope name: `access_as_user`
	 - Who can consent: Admins and users (or admins only if you prefer)
	 - Save

Write down (these are safe to share, but you don’t have to):

- Tenant ID (Directory/Tenant ID)
- API app Client ID (Application/Client ID)
- Application ID URI (Audience), e.g. `api://xxxxxxxx-....`

#### Step 2 — Create the frontend SPA app registration

1) App registrations → New registration
2) Name: `Fleet Scheduler SPA`
3) Register

Enable SPA redirect:

1) Authentication → Add a platform → Single-page application
2) Redirect URI: `http://localhost:5174/`
3) Save

Give the SPA permission to call your API:

1) API permissions → Add a permission
2) My APIs → select `Fleet Scheduler API`
3) Choose `access_as_user`
4) Add permissions
5) (Optional) “Grant admin consent” if your org requires it

Write down:

- SPA app Client ID

### Step 3 — Configure the frontend env vars

Create a file named `.env` in the repo root (same folder as the frontend `package.json`).

Use the keys from `.env.example`:

- `VITE_ENTRA_TENANT_ID=<your tenant id>`
- `VITE_ENTRA_CLIENT_ID=<your SPA app client id>`
- `VITE_ENTRA_API_SCOPE=api://<your API app client id>/access_as_user`

Leave `VITE_BACKEND_URL` empty for local dev (Vite proxies `/api` to the backend).

### Step 4 — Configure the backend env vars

Create `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

In `backend/.env` set:

- `AUTH_ENABLED=true`
- `ENTRA_TENANT_ID=<your tenant id>`
- `ENTRA_API_AUDIENCE=api://<your API app client id>`
- `ENTRA_REQUIRED_SCOPE=access_as_user`

Tip: set this too (helps CORS when you deploy without the Vite proxy):

- `APP_ORIGIN=http://localhost:5174`

### Step 5 — Run backend + frontend

Terminal A (backend):

```bash
npm run backend:dev
```

Terminal B (frontend):

```bash
npm run dev -- --port 5174
```

Open:

- `http://localhost:5174/`

### Step 6 — Sanity checks

Backend health should work without sign-in:

```bash
curl http://localhost:4000/api/health
```

When the frontend first tries to call an API endpoint, it may redirect you to Microsoft login.
After you sign in, API calls should succeed.

### Common errors (and the fix)

- `AADSTS50011` redirect URI mismatch: add exactly `http://localhost:5174/` to the SPA app.
- `401 Unauthorized` with “invalid audience”: set `ENTRA_API_AUDIENCE` to match the token’s `aud`.
	- You can paste the token into `https://jwt.ms` locally to see `aud`.
- `403 Missing required scope`: make sure the SPA app has the API permission and you request the `access_as_user` scope.

## Microsoft Lists (Graph) setup

The backend supports two auth modes:

- App-only (client credentials): set `AZURE_CLIENT_SECRET` (best for production)
- Device Code (delegated): leave `AZURE_CLIENT_SECRET` blank and the backend will print a sign-in code (easiest for dev; no paid Azure subscription/card required)

For a quick one-off debug without any Azure setup, you can also set `GRAPH_BEARER_TOKEN` in `backend/.env` (copy an access token from Graph Explorer). This is not suitable for long-running use because the token expires.

1) Azure Portal → App registrations → New registration

2) Certificates & secrets → New client secret

	- Copy the **secret value** (not the secret ID)

3) API permissions

- Microsoft Graph → Application permissions
- Add `Sites.ReadWrite.All` (required to read/write lists and generate shift instances)

Optional (recommended if you want the backend to send confirmation emails in production using app-only):

- Add `Mail.Send` (Application)

Then:

- Click “Grant admin consent”

4) Fill `backend/.env`

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET` (optional; omit for Device Code)
- `MS_SITE_ID`
- `MS_SHIFT_PATTERNS_LIST_ID`
- `MS_SHIFT_INSTANCES_LIST_ID`

If using **app-only** (client credentials) and you enabled `Mail.Send` (Application), also set:

- `MAIL_SENDER_UPN` (the mailbox to send from, e.g. `sigtryggur@gts.is`)
- `APP_ORIGIN` (your web app base URL so links in emails point to production)

If you use Device Code, you may also need:

- `GRAPH_SCOPES` (default is `https://graph.microsoft.com/Sites.ReadWrite.All`)

Then restart the backend and try:

```bash
curl http://localhost:4000/api/patterns
curl "http://localhost:4000/api/shifts?workspaceId=default&month=2026-01"
curl -X POST "http://localhost:4000/api/generate/shifts?workspaceId=default&month=2026-01"
```

Note: Microsoft Lists column *display names* can differ from *internal names*, especially for Lookup fields. If you see missing/undefined fields, we’ll likely need to adjust `LIST_FIELD_*` mappings in `backend/.env` to match internal names.

For ShiftPatterns, the backend reads `PATTERN_FIELD_*` env vars (see `backend/.env.example`).

Optional, recommended:

- Add a `routeName` text column to ShiftPatterns ("ShiftTemplates") so the UI/printouts can show a human-friendly name.
- If your internal column name isn't exactly `routeName`, set `PATTERN_FIELD_ROUTE_NAME` in `backend/.env`.

In your current ShiftPatterns list, the debug endpoint shows these internal names:

- StartTime: `field_5`
- EndTime: `field_6`
- Shift type choice: `Type0`
- Day of week (multi-choice): `DayOfWeek`
- Route lookup ID: `RouteLookupId`

If you set `MS_ROUTES_LIST_ID` (from the Route column’s `lookup.listId`), the backend will resolve `RouteLookupId` into the Route Title automatically.

## Fixing trips/stops in Lists (no code)

The UI is driven by **templates** (Microsoft Lists), not by editing ShiftInstances.

### If a trip shows under the wrong shift

This is almost always the **TripsTemplates** row pointing at the wrong **Shift** via a Lookup column.

In the **TripsTemplates** list:

- Edit the trip row
- Set the **Shift** lookup to the correct shift template
- (Optional but recommended) set **SortOrder** (Number) so trips appear in the exact order you want within that shift

The backend groups trips by the trip row’s Shift lookup (internal field typically `ShiftLookupId`).

### If stops/breaks appear in the wrong place (ordering)

In the **StopsTemplate** list (each row is one stop/break for one trip):

- Make sure each row’s **Trip** lookup points to the correct TripsTemplates row
- Add/fill these columns (recommended):
	- **SortOrder** (Number): 1,2,3… in the exact order you want
	- **EventType** (Choice/Text): `stop` or `break`
	- **Duration** (Number): minutes (for breaks)

The backend will try to auto-detect these by column **display name**.

### Debugging what the backend thinks (no code)

Once the backend is running, you can open these in your browser:

- List columns + sample fields: `http://localhost:4000/api/debug/list-fields-by-id?listId=<GUID>&sample=3`
- Explain StopsTemplate ordering for a specific trip: `http://localhost:4000/api/debug/stops-template?tripItemId=<TripsTemplates item id>`

Tip: the API response for `/api/shifts` includes `tripItemId` on each trip, so you can copy/paste it into the debug URL.
