# CFD Remote Assist Portal

Server-based web platform for remotely managing company-owned Android devices. Supports device registration, location tracking, ping requests, WebSocket command delivery, and WebRTC screen viewing with remote touch control.

Protected by **OIDC (Authentik)** for admins. Device APIs authenticate via per-device `connection_secret`.

## Architecture

```
┌─────────────┐     HTTPS/OIDC      ┌──────────────┐
│ Admin Browser│ ──────────────────►│  nginx       │
└─────────────┘                      │  (reverse    │
                                     │   proxy)     │
┌─────────────┐     HTTPS/REST/WS    └──────┬───────┘
│ Android App │ ◄───────────────────────────┤
└─────────────┘                             │
                              ┌─────────────┴─────────────┐
                              │  API Server (Node.js)     │
                              │  - REST /api/v1 (devices) │
                              │  - REST /api/admin (OIDC) │
                              │  - WS /ws/device|admin    │
                              └─────────────┬─────────────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │  PostgreSQL               │
                              └───────────────────────────┘
```

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env with your Authentik issuer, passwords, and public URL

docker compose up -d --build
```

Portal: `http://localhost` (or your configured host)

## API endpoints (Android client)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/register` | None | One-time device registration |
| POST | `/api/v1/telemetry` | `X-Connection-Secret` | Location/battery pulse |
| POST | `/api/v1/event` | `X-Connection-Secret` | e.g. `PING_ACKNOWLEDGED` |
| WS | `/ws/device` | First message auth | Receive commands, WebRTC signaling |

### Commands (server → device via WebSocket)

- `TRIGGER_PING`
- `REQUEST_LOCATION`
- `START_REMOTE_ADMIN`
- `STOP_REMOTE_ADMIN`

### Remote control (admin → device)

```json
{ "action": "CLICK", "x_percent": 0.45, "y_percent": 0.22 }
```

## Admin portal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/devices` | Bearer JWT | List devices |
| GET | `/api/admin/devices/:uid` | Bearer JWT | Device detail |
| POST | `/api/admin/devices/:uid/command` | Bearer JWT | Send command |
| POST | `/api/admin/devices/:uid/control` | Bearer JWT | Send touch packet |
| WS | `/ws/admin` | OIDC token in auth | WebRTC signaling relay |

## Configuration

See:

- [docs/authentik-setup.md](docs/authentik-setup.md) — OIDC provider setup
- [docs/mdm-config.md](docs/mdm-config.md) — Android MDM managed config

## GitHub deployment (Ubuntu 22.04)

Configure these **repository secrets**:

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Target server IP/hostname |
| `DEPLOY_USER` | SSH user (e.g. `deploy`) |
| `DEPLOY_SSH_KEY` | Private SSH key |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `POSTGRES_DB` | Database name |
| `PUBLIC_BASE_URL` | Public HTTPS URL |
| `OIDC_ISSUER` | Authentik issuer URL |
| `OIDC_AUDIENCE` | OIDC audience / client ID |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_JWKS_URI` | Optional JWKS override |
| `CORS_ORIGIN` | Portal origin URL |

On the Ubuntu host, install Docker and Docker Compose, then push to `main` to deploy.

## Local development

```bash
# Terminal 1 — database
docker run -d --name cfd-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=cfd_remote_assist -e POSTGRES_USER=cfd -p 5432:5432 postgres:16-alpine

# Terminal 2 — API
cd server && cp .env.example .env && npm install && npm run db:migrate && npm run dev

# Terminal 3 — Web
cd web && cp .env.example .env && npm install && npm run dev
```

## Project structure

```
server/          Node.js API + WebSocket hub
web/             React admin portal (Vite)
nginx/           Reverse proxy config + TLS certs
docs/            Authentik & MDM setup guides
docker-compose.yml
.github/workflows/deploy.yml
```
