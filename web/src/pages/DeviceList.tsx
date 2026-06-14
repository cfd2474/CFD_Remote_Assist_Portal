import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevices } from "../api/client";
import type { Device } from "../types";
import { formatDeviceModel } from "../utils/deviceModelNames";

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

      {devices.length === 0 ? (
        <p className="empty-state">
          No devices registered yet. Deploy the Android client and register via MDM.
        </p>
      ) : (
        <div className="device-list-wrap">
          <table className="device-list">
            <thead>
              <tr>
                <th>Device</th>
                <th>Status</th>
                <th>Model</th>
                <th>Battery</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.uid}>
                  <td>
                    <Link to={`/devices/${device.uid}`} className="device-list-name">
                      {device.device_name}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`badge ${device.is_online ? "badge-online" : "badge-offline"}`}
                    >
                      {device.is_online ? "Live" : "Offline"}
                    </span>
                  </td>
                  <td>{formatDeviceModel(device.model)}</td>
                  <td>
                    {device.last_battery != null
                      ? `${device.last_battery}%${device.last_is_charging ? " (charging)" : ""}`
                      : "—"}
                  </td>
                  <td>
                    {device.last_seen_at
                      ? new Date(device.last_seen_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
