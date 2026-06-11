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

## Deployment

**GitHub stores the code; you install manually on your server.**

1. Push or pull from this repository as needed.
2. On your Ubuntu 22.04 server, clone the repo and run Docker Compose.

Full steps: [docs/manual-install.md](docs/manual-install.md)

```bash
git clone https://github.com/cfd2474/CFD_Remote_Assist_Portal.git /opt/cfd-remote-assist
cd /opt/cfd-remote-assist
cp .env.example .env   # edit with your values
docker compose up -d --build
```

To update after new code is pushed:

```bash
cd /opt/cfd-remote-assist && git pull && docker compose up -d --build
```

## Configuration

See:

- [docs/manual-install.md](docs/manual-install.md) — server setup on Ubuntu 22.04
- [docs/authentik-setup.md](docs/authentik-setup.md) — OIDC provider setup
- [docs/mdm-config.md](docs/mdm-config.md) — Android MDM managed config

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
docs/            Install, Authentik & MDM guides
docker-compose.yml
```
