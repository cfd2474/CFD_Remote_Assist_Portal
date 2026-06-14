import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevices } from "../api/client";
import type { Device } from "../types";
import { formatDeviceModel } from "../utils/deviceModelNames";

type SortKey = "device_name" | "agency";
type SortDir = "asc" | "desc";

function matchesFilter(value: string, filter: string): boolean {
  if (!filter.trim()) {
    return true;
  }
  return value.toLowerCase().includes(filter.trim().toLowerCase());
}

function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) {
    return "↕";
  }
  return dir === "asc" ? "↑" : "↓";
}

export function DeviceList() {
  const auth = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const visibleDevices = useMemo(() => {
    let list = devices.filter((device) => {
      if (!matchesFilter(device.device_name, nameFilter)) {
        return false;
      }
      return matchesFilter(device.agency ?? "", agencyFilter);
    });

    if (sortKey) {
      list = [...list].sort((a, b) => {
        const aValue = sortKey === "device_name" ? a.device_name : a.agency ?? "";
        const bValue = sortKey === "device_name" ? b.device_name : b.agency ?? "";
        const cmp = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return list;
  }, [devices, nameFilter, agencyFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const hasActiveFilters = nameFilter.trim().length > 0 || agencyFilter.trim().length > 0;

  if (loading) return <p className="loading">Loading devices…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Managed Devices</h1>
        <p>
          {hasActiveFilters
            ? `${visibleDevices.length} of ${devices.length} device${devices.length !== 1 ? "s" : ""}`
            : `${devices.length} registered device${devices.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {devices.length === 0 ? (
        <p className="empty-state">
          No devices registered yet. Deploy the Android client and register via MDM.
        </p>
      ) : (
        <div className="device-list-wrap">
          <table className="device-list">
            <thead>
              <tr className="device-list-filter-row">
                <th>
                  <input
                    type="search"
                    className="device-list-filter"
                    placeholder="Filter device name"
                    value={nameFilter}
                    onChange={(event) => setNameFilter(event.target.value)}
                    aria-label="Filter device name"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="device-list-filter"
                    placeholder="Filter agency"
                    value={agencyFilter}
                    onChange={(event) => setAgencyFilter(event.target.value)}
                    aria-label="Filter agency"
                  />
                </th>
                <th aria-hidden="true" />
                <th aria-hidden="true" />
                <th aria-hidden="true" />
                <th aria-hidden="true" />
              </tr>
              <tr>
                <th>
                  <button
                    type="button"
                    className={`device-list-sort${sortKey === "device_name" ? " active" : ""}`}
                    onClick={() => toggleSort("device_name")}
                  >
                    Device name
                    <span className="device-list-sort-indicator" aria-hidden="true">
                      {sortIndicator(sortKey === "device_name", sortDir)}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`device-list-sort${sortKey === "agency" ? " active" : ""}`}
                    onClick={() => toggleSort("agency")}
                  >
                    Agency
                    <span className="device-list-sort-indicator" aria-hidden="true">
                      {sortIndicator(sortKey === "agency", sortDir)}
                    </span>
                  </button>
                </th>
                <th>Status</th>
                <th>Model</th>
                <th>Battery</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visibleDevices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No devices match your filters.
                  </td>
                </tr>
              ) : (
                visibleDevices.map((device) => (
                  <tr key={device.uid}>
                    <td>
                      <Link to={`/devices/${device.uid}`} className="device-list-name">
                        {device.device_name}
                      </Link>
                    </td>
                    <td>{device.agency ?? "—"}</td>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
