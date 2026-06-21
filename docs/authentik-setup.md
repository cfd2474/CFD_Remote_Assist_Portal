# Authentik OIDC Setup

Configure an OAuth2/OpenID Provider in Authentik for the EUD Remote Assist portal.

## 1. Create an Application

1. In Authentik Admin, go to **Applications → Applications → Create**.
2. Name: `EUD Remote Assist`
3. Slug: `eud-remote-assist`
4. Create a new **Provider** (OAuth2/OpenID).

## 2. Provider settings

| Setting | Value |
|---------|-------|
| Client type | Confidential (or Public for SPA-only) |
| Client ID | `eud-remote-assist` |
| Redirect URIs | `https://<portal-host>/callback` |
| Post-logout redirect URIs | `https://<portal-host>/` |
| Signing Key | Authentik default |
| Scopes | `openid`, `profile`, `email` |

Note the **Issuer URL** — typically:

`https://<authentik-host>/application/o/eud-remote-assist/`

Set this as `OIDC_ISSUER` in your `.env` and GitHub secrets.

## 3. API token validation

The backend validates admin JWTs using the issuer JWKS endpoint. Set:

- `OIDC_ISSUER` — issuer URL above
- `OIDC_AUDIENCE` — client ID (if configured as audience in Authentik)
- `OIDC_JWKS_URI` — optional override; defaults to `{issuer}/.well-known/jwks`

## 4. Frontend build args

When building the web container, these are injected:

- `VITE_OIDC_AUTHORITY` = `OIDC_ISSUER`
- `VITE_OIDC_CLIENT_ID` = `eud-remote-assist`

## 5. Restrict access

Use Authentik **Policies** on the application to limit sign-in to IT/admin groups only.
