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
git clone https://github.com/cfd2474/CFD_Remote_Assist_Portal.git /opt/cfd-remote-assist
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
| `PUBLIC_BASE_URL` | `https://remote.yourcompany.com` |
| `OIDC_ISSUER` | `https://auth.yourcompany.com/application/o/cfd-remote-assist/` |
| `OIDC_CLIENT_ID` | `cfd-remote-assist` |
| `OIDC_AUDIENCE` | `cfd-remote-assist` (optional) |
| `CORS_ORIGIN` | Same as `PUBLIC_BASE_URL` |

See [authentik-setup.md](authentik-setup.md) for OIDC configuration.

## 4. TLS certificates (production)

Place your certificate files in `nginx/certs/`:

```
nginx/certs/fullchain.pem
nginx/certs/privkey.pem
```

Then uncomment the HTTPS `server` block in `nginx/nginx.conf` and optionally add an HTTP → HTTPS redirect on port 80.

For testing without TLS, the default config serves everything on port 80.

## 5. Start the stack

```bash
docker compose up -d --build
```

Verify:

```bash
curl http://localhost/health
# {"status":"ok","service":"cfd-remote-assist"}
```

Open the portal at your configured URL and sign in via Authentik.

## 6. Updating after a git push

When new code is pushed to the repo:

```bash
cd /opt/cfd-remote-assist
git pull
docker compose up -d --build
```

Database migrations run automatically when the server container starts.

## 7. Firewall

Allow HTTP/HTTPS only:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 8. MDM / Android clients

Point managed devices at `PUBLIC_BASE_URL`. See [mdm-config.md](mdm-config.md).
