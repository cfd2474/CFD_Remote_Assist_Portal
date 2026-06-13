import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevices } from "../api/client";
import type { Device } from "../types";

export function DeviceList() {
  const auth = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.user) return;

    const load = async () => {
      try {
        const data = await fetchDevices(auth.user!);
        setDevices(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load devices");
      } finally {
        setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [auth.user]);

  if (loading) return <p className="loading">Loading devices…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Managed Devices</h1>
        <p>{devices.length} registered device{devices.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="device-grid">
        {devices.map((device) => (
          <Link
            key={device.uid}
            to={`/devices/${device.uid}`}
            className="device-card"
          >
            <div className="device-card-header">
              <h2>{device.device_name}</h2>
              <span
                className={`badge ${device.is_online ? "badge-online" : "badge-offline"}`}
              >
                {device.is_online ? "Live" : "Offline"}
              </span>
            </div>
            <dl>
              <div>
                <dt>Model</dt>
                <dd>{device.model ?? "—"}</dd>
              </div>
              <div>
                <dt>Battery</dt>
                <dd>
                  {device.last_battery != null
                    ? `${device.last_battery}%${device.last_is_charging ? " (charging)" : ""}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>
                  {device.last_seen_at
                    ? new Date(device.last_seen_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>

      {devices.length === 0 && (
        <p className="empty-state">
          No devices registered yet. Deploy the Android client and register via MDM.
        </p>
      )}
    </div>
  );
}
