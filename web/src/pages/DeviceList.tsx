import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevices, removeDevice } from "../api/client";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Device } from "../types";

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
  const [selectedUids, setSelectedUids] = useState<Set<string>>(() => new Set());
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFields, setExportFields] = useState({
    uid: true,
    device_name: true,
    model_display: true,
    phone_number: true,
    app_version: true,
    agency: true,
    last_location: true,
    last_telemetry_at: true,
  });

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

  const visibleUids = useMemo(
    () => visibleDevices.map((device) => device.uid),
    [visibleDevices]
  );

  const selectedVisibleCount = useMemo(
    () => visibleUids.filter((uid) => selectedUids.has(uid)).length,
    [visibleUids, selectedUids]
  );

  const allVisibleSelected =
    visibleUids.length > 0 && selectedVisibleCount === visibleUids.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleUids.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const selectedDevices = useMemo(
    () => devices.filter((device) => selectedUids.has(device.uid)),
    [devices, selectedUids]
  );

  const toggleDeviceSelection = (uid: string) => {
    setSelectedUids((current) => {
      const next = new Set(current);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedUids((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const uid of visibleUids) {
          next.delete(uid);
        }
      } else {
        for (const uid of visibleUids) {
          next.add(uid);
        }
      }
      return next;
    });
  };

  const handleBulkRemove = async () => {
    if (!auth.user || selectedDevices.length === 0) {
      return;
    }

    setRemoveModalOpen(false);
    setRemoving(true);
    setActionMessage(null);

    const uidsToRemove = selectedDevices.map((device) => device.uid);
    const failed: string[] = [];

    try {
      for (const uid of uidsToRemove) {
        try {
          await removeDevice(auth.user, uid);
        } catch {
          failed.push(uid);
        }
      }

      const remaining = await fetchDevices(auth.user);
      setDevices(remaining);
      setSelectedUids((current) => {
        const next = new Set(current);
        for (const uid of uidsToRemove) {
          if (!failed.includes(uid)) {
            next.delete(uid);
          }
        }
        return next;
      });

      if (failed.length > 0) {
        setActionMessage(
          `Removed ${uidsToRemove.length - failed.length} of ${uidsToRemove.length} device(s). ${failed.length} failed.`
        );
      }
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Failed to remove devices"
      );
    } finally {
      setRemoving(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val == null) return "";
    const str = String(val);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleExport = () => {
    const headers: string[] = [];
    if (exportFields.uid) headers.push("UID");
    if (exportFields.device_name) headers.push("Name");
    if (exportFields.model_display) headers.push("Model");
    if (exportFields.phone_number) headers.push("Phone number");
    if (exportFields.app_version) headers.push("App version");
    if (exportFields.agency) headers.push("Agency");
    if (exportFields.last_location) {
      headers.push("Latitude");
      headers.push("Longitude");
    }
    if (exportFields.last_telemetry_at) headers.push("Last location seen date/time");

    const rows = devices.map((device) => {
      const row: string[] = [];
      if (exportFields.uid) row.push(escapeCSV(device.uid));
      if (exportFields.device_name) row.push(escapeCSV(device.device_name));
      if (exportFields.model_display) row.push(escapeCSV(device.model_display));
      if (exportFields.phone_number) row.push(escapeCSV(device.phone_number));
      if (exportFields.app_version) row.push(escapeCSV(device.app_version));
      if (exportFields.agency) row.push(escapeCSV(device.agency));
      if (exportFields.last_location) {
        row.push(escapeCSV(device.last_lat));
        row.push(escapeCSV(device.last_lon));
      }
      if (exportFields.last_telemetry_at) {
        row.push(
          escapeCSV(
            device.last_telemetry_at
              ? new Date(device.last_telemetry_at).toLocaleString()
              : ""
          )
        );
      }
      return row.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const now = new Date();
    const formattedDate = now.toISOString().replace(/[:.]/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `EUD_export_${formattedDate}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportModalOpen(false);
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
        <>
          {actionMessage ? <p className="action-message">{actionMessage}</p> : null}

          <div className="device-list-wrap">
            <table className="device-list">
              <thead>
                <tr className="device-list-filter-row">
                  <th aria-hidden="true" />
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
                <th className="device-list-select-col">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="device-list-checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={visibleDevices.length === 0}
                    aria-label="Select all visible devices"
                  />
                </th>
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
                  <td colSpan={7} className="empty-state">
                    No devices match your filters.
                  </td>
                </tr>
              ) : (
                visibleDevices.map((device) => (
                  <tr key={device.uid}>
                    <td className="device-list-select-col">
                      <input
                        type="checkbox"
                        className="device-list-checkbox"
                        checked={selectedUids.has(device.uid)}
                        onChange={() => toggleDeviceSelection(device.uid)}
                        aria-label={`Select ${device.device_name}`}
                      />
                    </td>
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
                    <td>{device.model_display}</td>
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

          <section className="panel panel-danger device-list-bulk-remove">
            <h2>Remove devices</h2>
            <p>
              Permanently delete selected devices and all associated telemetry
              and event history from the portal.
            </p>
            <button
              type="button"
              className="btn-remove"
              disabled={selectedDevices.length === 0 || removing}
              onClick={() => setRemoveModalOpen(true)}
            >
              {removing ? "Removing…" : "Remove Device & Clear Data"}
            </button>
          </section>

          <div className="device-list-actions" style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn-link"
              onClick={() => setExportModalOpen(true)}
            >
              Export Device List
            </button>
          </div>

          <ConfirmModal
            open={removeModalOpen}
            title={
              selectedDevices.length === 1 ? "Remove device?" : "Remove devices?"
            }
            confirmLabel="Remove Device & Clear Data"
            confirmClassName="btn-remove"
            onConfirm={() => void handleBulkRemove()}
            onCancel={() => setRemoveModalOpen(false)}
          >
            {selectedDevices.length === 1 ? (
              <p>
                Remove &ldquo;{selectedDevices[0].device_name}&rdquo; from the
                portal? This permanently deletes the device record, telemetry
                history, and event log. The phone can register again later as a
                new enrollment.
              </p>
            ) : (
              <p>
                Remove {selectedDevices.length} devices from the portal? This
                permanently deletes each device record, telemetry history, and
                event log. Phones can register again later as new enrollments.
              </p>
            )}
            {selectedDevices.length > 1 ? (
              <ul className="modal-device-list">
                {selectedDevices.map((device) => (
                  <li key={device.uid}>{device.device_name}</li>
                ))}
              </ul>
            ) : null}
          </ConfirmModal>

          <ConfirmModal
            open={exportModalOpen}
            title="Export Device List"
            confirmLabel="Export CSV"
            confirmClassName="btn-primary"
            onConfirm={handleExport}
            onCancel={() => setExportModalOpen(false)}
          >
            <p>Select the fields you would like to include in the exported CSV:</p>
            <div className="export-options-grid">
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.uid}
                  onChange={(e) => setExportFields({ ...exportFields, uid: e.target.checked })}
                />
                UID
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.device_name}
                  onChange={(e) => setExportFields({ ...exportFields, device_name: e.target.checked })}
                />
                Name
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.model_display}
                  onChange={(e) => setExportFields({ ...exportFields, model_display: e.target.checked })}
                />
                Model
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.phone_number}
                  onChange={(e) => setExportFields({ ...exportFields, phone_number: e.target.checked })}
                />
                Phone number
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.app_version}
                  onChange={(e) => setExportFields({ ...exportFields, app_version: e.target.checked })}
                />
                App version
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.agency}
                  onChange={(e) => setExportFields({ ...exportFields, agency: e.target.checked })}
                />
                Agency
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.last_location}
                  onChange={(e) => setExportFields({ ...exportFields, last_location: e.target.checked })}
                />
                Last location (coordinate)
              </label>
              <label className="export-option-label">
                <input
                  type="checkbox"
                  className="device-list-checkbox"
                  checked={exportFields.last_telemetry_at}
                  onChange={(e) => setExportFields({ ...exportFields, last_telemetry_at: e.target.checked })}
                />
                Last location seen date/time
              </label>
            </div>
          </ConfirmModal>
        </>
      )}
    </div>
  );
}
