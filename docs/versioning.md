# Versioning

The EUD Remote Assist Portal uses a single release version in the repo root **`VERSION`** file (currently **2.1.0**). Install automation and operators can read it from git or from the running API.

infra-TAK and other orchestrators: see [infratak-integration.md](infratak-integration.md).

## Source of truth

| Location | Format |
|----------|--------|
| `VERSION` (repo root) | `2.1.0` (semver, one line) |
| Git tag (optional) | `v2.1.0` |
| Running server | `GET /version` or `GET /health` |

Bump **`VERSION`** (and matching `server/package.json` / `web/package.json` if desired) for each portal release. Tag the commit when publishing:

```bash
git tag -a v2.1.0 -m "EUD Remote Assist Portal 2.1.0"
git push origin v2.1.0
```

## Check version from a git checkout

```bash
cat VERSION
# 2.1.0

./scripts/version.sh
# 2.1.0
```

After `git pull`, compare the checkout to what is deployed:

```bash
EXPECTED=$(cat VERSION)
RUNNING=$(curl -sS https://remote.example.com:8448/version | jq -r .version)
test "$EXPECTED" = "$RUNNING" && echo "OK: $RUNNING" || echo "MISMATCH: want $EXPECTED, got $RUNNING"
```

## HTTP endpoints

Both are proxied on the **device API port (8448)** in production. No authentication required.

### `GET /version`

```json
{
  "version": "2.1.0",
  "service": "eud-remote-assist-portal"
}
```

### `GET /health`

```json
{
  "status": "ok",
  "service": "eud-remote-assist-portal",
  "version": "2.1.0"
}
```

Examples:

```bash
curl -sS https://remote.tak-solutions.com:8448/version
curl -sS https://remote.tak-solutions.com:8448/health
```

On the server host (loopback to Docker nginx):

```bash
curl -sS http://127.0.0.1:8091/version
```

## Install / update workflow

1. Clone or pull the repo.
2. Read `VERSION` to confirm the expected release.
3. Run `docker compose up -d --build`.
4. Call `/version` and confirm it matches `VERSION`.

See [manual-install.md](manual-install.md) for full server setup.

## Android app version

Device **`app_version`** in registration/telemetry is separate — it is the **EUD Android APK** version, not the portal release. Portal version identifies the server/admin stack only.
