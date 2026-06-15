# Manual Server Installation (Ubuntu 22.04)

This project is deployed by cloning from GitHub and running Docker Compose on your server. There is no automated deploy pipeline — you pull updates when ready.

## 1. Server prerequisites

On a fresh Ubuntu 22.04 host:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates

# Docker (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in so docker group applies

# Verify
docker compose version
```

## 2. Clone the repository

```bash
sudo mkdir -p /opt/cfd-remote-assist
sudo chown $USER:$USER /opt/cfd-remote-assist
git clone https://github.com/cfd2474/EUD_Remote_Assist_Portal.git /opt/cfd-remote-assist
cd /opt/cfd-remote-assist
```

## 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Required values:

| Variable | Example |
|----------|---------|
| `POSTGRES_PASSWORD` | Strong random password |
| `PUBLIC_BASE_URL` | `https://remote.yourcompany.com:8448` |
| `CORS_ORIGIN` | `https://remote.yourcompany.com` (admin portal, port 443) |
| `OIDC_ISSUER` | `https://auth.yourcompany.com/application/o/cfd-remote-assist/` |
| `OIDC_JWKS_URI` | `https://auth.yourcompany.com/application/o/cfd-remote-assist/jwks/` |
| `OIDC_CLIENT_ID` | `cfd-remote-assist` |
| `OIDC_AUDIENCE` | `cfd-remote-assist` (optional) |
| `NGINX_BIND_ADDR` | `127.0.0.1` when using host nginx (recommended) |
| `HTTP_PORT` | `8091` when host nginx proxies to loopback (see host nginx examples) |

See [authentik-setup.md](authentik-setup.md) for OIDC configuration.  
For **infra-TAK** co-deploy (Caddy, port 8767): [infratak-integration.md](infratak-integration.md).

## 4. TLS certificates (production)

Docker nginx serves **HTTP only** on port 80. Terminate TLS on **host nginx** or **Caddy** (see `nginx/host-admin-portal.conf.example` and `nginx/host-device-api.conf.example`).

Set loopback bind so Docker nginx is not publicly exposed:

```env
NGINX_BIND_ADDR=127.0.0.1
HTTP_PORT=8091
```

Host nginx proxies `127.0.0.1:8091` for admin (443) and device API (8448).

For local testing without host TLS, leave `NGINX_BIND_ADDR` empty and use `HTTP_PORT=80`.

## 5. Start the stack

```bash
docker compose up -d --build
```

Verify:

```bash
cat VERSION
# 2.2.6

curl http://127.0.0.1:8091/health
# {"status":"ok","service":"eud-remote-assist-portal","version":"2.2.6"}

curl http://127.0.0.1:8091/version
# {"version":"2.2.6","service":"eud-remote-assist-portal"}
```

See [versioning.md](versioning.md) for install automation and version checks.

Open the portal at your configured URL and sign in via Authentik.

## 6. Updating after a git push

When new code is pushed to the repo:

```bash
cd /opt/cfd-remote-assist
git pull
cat VERSION   # expected release after pull
docker compose up -d --build
curl -sS http://127.0.0.1:8091/version   # confirm running version matches VERSION
```

Database migrations run automatically when the server container starts.

## 7. Firewall

Allow HTTP/HTTPS only:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp   # Admin portal
sudo ufw allow 8448/tcp  # Android device API
sudo ufw enable
```

## 8. MDM / Android clients

Point managed devices at `PUBLIC_BASE_URL`. See [mdm-config.md](mdm-config.md).
