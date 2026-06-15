# Versioning

The EUD Remote Assist Portal uses a single release version in the repo root **`VERSION`** file (currently **2.2.5**). Install automation and operators can read it from git or from the running API.

infra-TAK and other orchestrators: see [infratak-integration.md](infratak-integration.md).

## Source of truth

| Location | Format |
|----------|--------|
| `VERSION` (repo root) | `2.2.5` (semver, one line) |
| Git tag (optional) | `v2.2.5` |
| Release notes | `docs/RELEASE_NOTES.md` (parsed blocks; also shown in admin portal) |
| Running server | `GET /version` or `GET /health` |

Bump **`VERSION`** (and matching `server/package.json` / `web/package.json` if desired) for each portal release. Add a new block to **`docs/RELEASE_NOTES.md`** (newest at top). Tag the commit when publishing:

```bash
git tag -a v2.2.5 -m "EUD Remote Assist Portal 2.2.5"
git push origin v2.2.5
```

## Check version from a git checkout

```bash
cat VERSION
# 2.2.5

./scripts/version.sh
# 2.2.5
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
  "version": "2.2.5",
  "service": "eud-remote-assist-portal"
}
```

### `GET /health`

```json
{
  "status": "ok",
  "service": "eud-remote-assist-portal",
  "version": "2.2.3"
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

## Release notes (`docs/RELEASE_NOTES.md`)

Maintain a running changelog in **`docs/RELEASE_NOTES.md`**. On each release:

1. Add a new block at the **top** of the file (newest first).
2. Wrap the entry in parseable HTML comment markers:

```markdown
<!-- RELEASE_START version=2.2.4 -->
## Version 2.2.4

**Portal**

- Summary of changes…

<!-- RELEASE_END version=2.2.4 -->
```

The admin portal reads this file at build time and exposes **Documentation → Release Notes** with a per-version index and detail pages.

## Android app version

Device **`app_version`** in registration/telemetry is separate — it is the **EUD Android APK** version, not the portal release. Portal version identifies the server/admin stack only.
