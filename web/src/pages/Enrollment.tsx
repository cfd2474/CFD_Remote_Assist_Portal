import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

interface EnrollmentToken {
  token: string;
  agency: string | null;
  description: string | null;
  tls_pin_hash: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export function Enrollment() {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agency, setAgency] = useState("");
  const [description, setDescription] = useState("");
  const [tlsPinHash, setTlsPinHash] = useState("");

  const [selectedToken, setSelectedToken] = useState<EnrollmentToken | null>(null);

  useEffect(() => {
    fetchTokens();
  }, []);

  async function fetchTokens() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/enrollment-tokens");
      if (!res.ok) throw new Error("Failed to load tokens");
      const data = await res.json();
      setTokens(data.tokens);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/enrollment-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agency: agency || null,
          description: description || null,
          tls_pin_hash: tlsPinHash || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to create token");
      setAgency("");
      setDescription("");
      setTlsPinHash("");
      fetchTokens();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRevoke(token: string) {
    if (!confirm("Are you sure you want to revoke this token?")) return;
    try {
      const res = await fetch(`/api/admin/enrollment-tokens/${token}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke token");
      fetchTokens();
      if (selectedToken?.token === token) {
        setSelectedToken(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  function renderQrCode(t: EnrollmentToken) {
    const payload = JSON.stringify({
      enrollment_token: t.token,
      tls_pin_hash: t.tls_pin_hash || undefined,
      tracking_server_url: window.location.origin
    });

    return (
      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Scan QR Code to Enroll Device</h3>
        <p style={{ marginBottom: "1rem" }}>
          Use the BYOD scanner in the EUD Remote Assist app to scan this code.
        </p>
        <div style={{ background: "white", padding: "1rem", display: "inline-block", borderRadius: "8px" }}>
          <QRCodeSVG value={payload} size={256} />
        </div>
        <div style={{ marginTop: "1rem" }}>
          <strong>MDM Provisioning Config:</strong>
          <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "4px", overflowX: "auto" }}>
            {`{
  "enrollment_token": "${t.token}",
  "tls_pin_hash": "${t.tls_pin_hash || ""}",
  "tracking_server_url": "${window.location.origin}"
}`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="content-container">
      <h2>Device Enrollment & Provisioning</h2>
      {error && <div className="error-message">{error}</div>}

      <div className="card">
        <h3>Generate New Token</h3>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label>Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. BYOD Contractor Batch"
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          <div>
            <label>Agency (Optional)</label>
            <input
              type="text"
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
              placeholder="e.g. DHS"
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          <div>
            <label>TLS Pin Hash (Optional, for Certificate Pinning)</label>
            <input
              type="text"
              value={tlsPinHash}
              onChange={(e) => setTlsPinHash(e.target.value)}
              placeholder="e.g. sha256/..."
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
          <button type="submit">Generate Token</button>
        </form>
      </div>

      {selectedToken && renderQrCode(selectedToken)}

      <h3>Active Tokens</h3>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="data-table" style={{ width: "100%", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Description</th>
              <th>Agency</th>
              <th>Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.token}>
                <td>{t.description || "—"}</td>
                <td>{t.agency || "—"}</td>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.is_active ? "Active" : "Revoked"}</td>
                <td>
                  <button onClick={() => setSelectedToken(t)} disabled={!t.is_active} style={{ marginRight: "0.5rem" }}>
                    View QR / Config
                  </button>
                  <button
                    onClick={() => handleRevoke(t.token)}
                    disabled={!t.is_active}
                    className="danger-button"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "1rem" }}>
                  No enrollment tokens found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
