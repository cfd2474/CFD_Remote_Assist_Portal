import type { LocationHistoryPoint } from "../types";

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildLocationHistoryCsv(points: LocationHistoryPoint[]): string {
  const rows = [
    ["number", "recorded_at", "lat", "lon", "accuracy_m"],
    ...points.map((point) => [
      String(point.number),
      point.recorded_at,
      point.lat.toFixed(5),
      point.lon.toFixed(5),
      point.accuracy_m != null ? String(Math.round(point.accuracy_m)) : "",
    ]),
  ];

  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

export function buildLocationHistoryFilename(
  deviceName: string,
  uid: string
): string {
  const safeName =
    deviceName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_|_$/g, "") ||
    "device";
  return `${safeName}_${uid}_location-history.csv`;
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
