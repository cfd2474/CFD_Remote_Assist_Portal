import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import type { User } from "oidc-client-ts";
import { fetchReverseGeocode } from "../api/client";
import { DeviceMap } from "./DeviceMap";

interface DeviceLocationPanelProps {
  uid: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  label: string;
  user: User;
}

export function DeviceLocationPanel({
  uid,
  lat,
  lon,
  accuracyM,
  label,
  user,
}: DeviceLocationPanelProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(true);
  const [addressError, setAddressError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAddressLoading(true);
    setAddressError(false);
    setAddress(null);

    fetchReverseGeocode(user, lat, lon)
      .then((result) => {
        if (!cancelled) {
          setAddress(result.address);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAddressError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAddressLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, lat, lon]);

  return (
    <>
      <dl className="info-list location-info">
        <div>
          <dt>Address</dt>
          <dd>
            {addressLoading
              ? "Looking up address…"
              : addressError
                ? "Address unavailable"
                : address}
          </dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>
            {lat.toFixed(5)}, {lon.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>GPS accuracy</dt>
          <dd>
            {accuracyM != null
              ? `±${Math.round(accuracyM)} m`
              : "Not reported by device"}
          </dd>
        </div>
      </dl>
      <DeviceMap lat={lat} lon={lon} label={label} />
      <p className="location-history-link">
        <Link to={`/devices/${uid}/location-history`}>Location history</Link>
      </p>
    </>
  );
}
