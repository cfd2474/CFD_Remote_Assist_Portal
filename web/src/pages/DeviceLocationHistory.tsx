import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevice, fetchLocationHistory } from "../api/client";
import { LocationHistoryMap } from "../components/LocationHistoryMap";
import type { Device, LocationHistoryPoint } from "../types";
import {
  buildLocationHistoryCsv,
  buildLocationHistoryFilename,
  downloadCsv,
} from "../utils/exportLocationHistoryCsv";
import {
  buildLocationHistoryBounds,
  defaultLocationHistoryToDate,
  formatLocalDateInput,
} from "../utils/locationHistoryDates";

export function DeviceLocationHistory() {
  const { uid } = useParams<{ uid: string }>();
  const auth = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [points, setPoints] = useState<LocationHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

  const [fromMode, setFromMode] = useState<"now" | "date">("now");
  const [fromDate, setFromDate] = useState(formatLocalDateInput(new Date()));
  const [toDate, setToDate] = useState(defaultLocationHistoryToDate());
  const [appliedFilter, setAppliedFilter] = useState<{
    fromMode: "now" | "date";
    fromDate: string;
    toDate: string;
  }>(() => ({
    fromMode: "now",
    fromDate: formatLocalDateInput(new Date()),
    toDate: defaultLocationHistoryToDate(),
  }));

  const loadHistory = useCallback(
    async (fromModeValue: "now" | "date", fromDateValue: string, toDateValue: string) => {
      if (!auth.user || !uid) {
        return;
      }

      setHistoryLoading(true);
      setFilterError(null);

      try {
        const { fromAt, toAt } = buildLocationHistoryBounds(
          fromModeValue,
          fromDateValue,
          toDateValue
        );
        const data = await fetchLocationHistory(auth.user, uid, fromAt, toAt);
        setPoints(data);
        setSelectedNumber(data[0]?.number ?? null);
      } catch (err) {
        setFilterError(
          err instanceof Error ? err.message : "Failed to load location history"
        );
        setPoints([]);
        setSelectedNumber(null);
      } finally {
        setHistoryLoading(false);
      }
    },
    [auth.user, uid]
  );

  useEffect(() => {
    if (!auth.user || !uid) {
      return;
    }

    const load = async () => {
      try {
        const data = await fetchDevice(auth.user!, uid);
        setDevice(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load device");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [auth.user, uid]);

  useEffect(() => {
    if (!auth.user || !uid || loading) {
      return;
    }
    void loadHistory(
      appliedFilter.fromMode,
      appliedFilter.fromDate,
      appliedFilter.toDate
    );
  }, [auth.user, uid, loading, appliedFilter, loadHistory]);

  const applyFilter = () => {
    setAppliedFilter({ fromMode, fromDate, toDate });
  };

  const exportAllHistory = async () => {
    if (!auth.user || !uid || !device) {
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      const allPoints = await fetchLocationHistory(
        auth.user,
        uid,
        new Date(),
        new Date(0),
        { full: true }
      );
      const csv = buildLocationHistoryCsv(allPoints);
      downloadCsv(
        csv,
        buildLocationHistoryFilename(device.device_name, device.uid)
      );
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export location history"
      );
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <p className="loading">Loading location history…</p>;
  }

  if (error || !device || !uid) {
    return <p className="error">{error ?? "Device not found"}</p>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <p className="breadcrumb">
          <Link to="/">Devices</Link>
          {" / "}
          <Link to={`/devices/${uid}`}>{device.device_name}</Link>
          {" / Location history"}
        </p>
        <h1>Location history</h1>
        <p>{device.device_name}</p>
      </div>

      <section className="panel location-history-filters">
        <h2>Date range</h2>
        <p className="filter-hint">
          From is the most recent bound; To is further back in time. Calendar
          dates use midnight (00:00) local time.
        </p>
        <div className="filter-row">
          <label className="filter-field">
            <span>From (most recent)</span>
            <select
              value={fromMode}
              onChange={(event) =>
                setFromMode(event.target.value as "now" | "date")
              }
            >
              <option value="now">Now</option>
              <option value="date">Calendar date</option>
            </select>
          </label>
          {fromMode === "date" ? (
            <label className="filter-field">
              <span>From date</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
          ) : null}
          <label className="filter-field">
            <span>To (older)</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
          <button type="button" className="btn-primary" onClick={applyFilter}>
            Apply
          </button>
        </div>
        {filterError ? <p className="error">{filterError}</p> : null}
      </section>

      <section className="panel">
        <h2>Map</h2>
        {historyLoading ? (
          <p className="loading">Loading history points…</p>
        ) : points.length > 0 ? (
          <LocationHistoryMap
            points={points}
            selectedNumber={selectedNumber}
          />
        ) : (
          <p className="empty-state">No location points in this range.</p>
        )}
      </section>

      <section className="panel">
        <div className="location-history-records-header">
          <h2>Records</h2>
          <button
            type="button"
            className="btn-primary location-history-export"
            disabled={exporting}
            onClick={() => void exportAllHistory()}
          >
            {exporting ? "Exporting…" : "Export all history"}
          </button>
        </div>
        {exportError ? <p className="error">{exportError}</p> : null}
        {historyLoading ? (
          <p className="loading">Loading records…</p>
        ) : points.length === 0 ? (
          <p className="empty-state no-records">no records</p>
        ) : (
          <div className="location-history-table-wrap">
            <table className="location-history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date / time</th>
                  <th>Coordinates</th>
                  <th>GPS accuracy</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr
                    key={`${point.number}-${point.recorded_at}`}
                    className={
                      point.number === selectedNumber
                        ? "location-history-row selected"
                        : "location-history-row"
                    }
                    onClick={() => setSelectedNumber(point.number)}
                  >
                    <td>{point.number}</td>
                    <td>{new Date(point.recorded_at).toLocaleString()}</td>
                    <td>
                      {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                    </td>
                    <td>
                      {point.accuracy_m != null
                        ? `±${Math.round(point.accuracy_m)} m`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
