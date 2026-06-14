import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { LocationHistoryPoint } from "../types";

function createNumberedIcon(number: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span class="location-marker-badge${selected ? " selected" : ""}">${number}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function MapFocus({
  lat,
  lon,
  zoom,
}: {
  lat: number;
  lon: number;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.flyTo([lat, lon], zoom, { duration: 0.45 });
  }, [lat, lon, zoom, map]);

  return null;
}

function FitBounds({ points }: { points: LocationHistoryPoint[] }) {
  const map = useMap();
  const pointsKey = points.map((point) => point.recorded_at).join("|");

  useEffect(() => {
    if (points.length === 0) {
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 15);
      return;
    }
    const bounds = L.latLngBounds(
      points.map((point) => [point.lat, point.lon] as [number, number])
    );
    map.fitBounds(bounds.pad(0.2));
  }, [map, points, pointsKey]);

  return null;
}

interface LocationHistoryMapProps {
  points: LocationHistoryPoint[];
  selectedNumber: number | null;
  focusZoom?: number;
}

export function LocationHistoryMap({
  points,
  selectedNumber,
  focusZoom = 16,
}: LocationHistoryMapProps) {
  const defaultCenter: [number, number] =
    points.length > 0
      ? [points[0].lat, points[0].lon]
      : [39.7392, -104.9903];
  const focusPoint = points.find((point) => point.number === selectedNumber);

  return (
    <div className="location-history-map">
      <MapContainer center={defaultCenter} zoom={14} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {focusPoint ? (
          <MapFocus
            lat={focusPoint.lat}
            lon={focusPoint.lon}
            zoom={focusZoom}
          />
        ) : null}
        {points.map((point) => (
          <Marker
            key={`${point.number}-${point.recorded_at}`}
            position={[point.lat, point.lon]}
            icon={createNumberedIcon(
              point.number,
              point.number === selectedNumber
            )}
          >
            <Popup>
              #{point.number} — {new Date(point.recorded_at).toLocaleString()}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
