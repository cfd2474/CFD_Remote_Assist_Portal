# MDM Managed Configuration

Push this app restrictions bundle to the CFD Assist Android app via your EMM/MDM.

```xml
<restrictions>
  <restriction android:key="settings_password" android:restrictionType="string" />
  <restriction android:key="connection_secret" android:restrictionType="string" />
  <restriction android:key="tracking_server_url" android:restrictionType="string" />
  <restriction android:key="tracking_interval" android:restrictionType="integer" />
</restrictions>
```

## Values

| Key | Source |
|-----|--------|
| `settings_password` | Your org-defined PIN to block local app settings |
| `connection_secret` | Returned from `POST /api/v1/register` on first registration |
| `tracking_server_url` | `PUBLIC_BASE_URL` (e.g. `https://remote.example.com`) |
| `tracking_interval` | Minutes between location pulses (e.g. `15`) |

## Registration flow

1. Deploy app via MDM without `connection_secret` initially, or pre-generate secrets server-side.
2. On first launch, app calls `POST /api/v1/register`.
3. Store returned `connection_secret` in MDM and push updated managed config.
4. App uses `connection_secret` in `X-Connection-Secret` header for telemetry, events, and WebSocket auth.

## WebSocket endpoint

Devices connect to: `wss://<PUBLIC_BASE_URL>/ws/device`

Auth message (first frame):

```json
{
  "type": "auth",
  "uid": "<android_id>",
  "connection_secret": "<secret>"
}
```
