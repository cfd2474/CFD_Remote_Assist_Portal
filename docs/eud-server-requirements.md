# EUD Application — Server Requirements Compliance

This document maps the Android (EUD) app server requirements to the deployed CFD Remote Assist platform at **remote.tak-solutions.com**.

## Requirement checklist

| # | EUD requirement | Status | Implementation |
|---|-----------------|--------|----------------|
| 1 | HTTPS listener with valid TLS | **Met** | Nginx + Let's Encrypt on port **8448** (devices) and **443** (admin portal) |
| 2 | `POST /api/v1/register` | **Met** | Node.js API accepts JSON payload (uid, serial, IMEI, device_name, model, etc.) |
| 3 | Firewall port open | **Met** | Port **8448/tcp** exposed (nginx listens on `0.0.0.0:8448`). Use `ufw allow 8448/tcp` if UFW is enabled. |
| 4 | Database with UID primary key | **Met** | PostgreSQL `devices` table — `uid TEXT PRIMARY KEY` |
| 5 | Network access for devices | **Met** | Public HTTPS endpoint; devices need cellular/Wi‑Fi route to `remote.tak-solutions.com:8448` |

> **Note on port:** The EUD doc uses port 8080 as an example. This deployment uses **8448** for device traffic so it does not conflict with TAK Server admin (**8443**) or other services on infra-TAK hosts. Configure the app/MDM `tracking_server_url` accordingly — the path `/api/v1/register` is unchanged.

---

## 1. HTTPS listener

- **Device API base URL:** `https://remote.tak-solutions.com:8448`
- **Certificate:** Let's Encrypt (valid for `remote.tak-solutions.com`)
- **Stack:** Host nginx (TLS termination) → Docker nginx (`127.0.0.1:8091`) → Node.js API

Verify:

```bash
curl https://remote.tak-solutions.com:8448/health
# {"status":"ok","service":"eud-remote-assist-portal","version":"2.2.9"}
```

---

## 2. Registration API endpoint

**URL:** `POST https://remote.tak-solutions.com:8448/api/v1/register`

**Authentication:** None (first-time registration)

**Request body:**

```json
{
  "uid": "3a5f92b...",
  "serial": "R58M123456X",
  "imei": "35263700...",
  "device_name": "Tech-Support-Tablet-01",
  "model": "Samsung SM-G991U",
  "phone_number": "+15551234567",
  "app_version": "1.0.0"
}
```

Required fields: `uid`, `device_name`

**Response (201 new / 200 re-register):**

```json
{
  "uid": "3a5f92b...",
  "connection_secret": "<hex-secret>",
  "tracking_server_url": "https://remote.tak-solutions.com:8448",
  "message": "Device registered. Store connection_secret in MDM managed config."
}
```

---

## 3. Firewall

On the Ubuntu host, if using UFW:

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 443/tcp   # Admin portal
sudo ufw allow 8448/tcp # Android device API
sudo ufw enable
```

Device traffic uses **8448**, not 8080. Port 8080 on this host is reserved for an internal service (pref configurator) and is not exposed publicly.

---

## 4. Database

- **Engine:** PostgreSQL 16 (Docker container `cfd-remote-assist-postgres-1`)
- **Database:** `cfd_remote_assist`
- **Primary key:** `devices.uid` (Android ID)

Stored at registration:

| Column | Source |
|--------|--------|
| `uid` | Android ID (PK) |
| `serial` | Hardware serial |
| `imei` | Cellular IMEI |
| `device_name` | User-facing name |
| `model` | Device model |
| `phone_number` | SIM line 1 |
| `app_version` | App version |
| `connection_secret` | Generated server-side |
| `registered_at` | Timestamp |

---

## 5. Network access

Devices must reach `remote.tak-solutions.com` on port **8448** over HTTPS:

- Corporate Wi‑Fi or cellular data with outbound HTTPS allowed
- VPN not required (server is public-facing)
- MDM managed config key `tracking_server_url` = `https://remote.tak-solutions.com:8448`

After registration, subsequent calls use:

| Endpoint | Auth |
|----------|------|
| `GET /api/v1/ping` or `POST /api/v1/ping` | None (uid only — verifies device is registered) |
| `POST /api/v1/telemetry` | `X-Connection-Secret` header |
| `POST /api/v1/event` | `X-Connection-Secret` header |
| `wss://.../ws/device` | Auth frame with `connection_secret` |

---

## MDM configuration summary

```text
tracking_server_url = https://remote.tak-solutions.com:8448
connection_secret   = <from registration response>
tracking_interval   = 15
```

See [mdm-config.md](mdm-config.md) for full managed configuration details.
