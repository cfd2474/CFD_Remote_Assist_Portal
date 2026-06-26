import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "react-oidc-context";
import { fetchEnrollmentTokens, createEnrollmentToken, revokeEnrollmentToken, deleteEnrollmentToken, fetchPortalConfig, type EnrollmentToken } from "../api/client";

export function Enrollment() {
  const auth = useAuth();
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverPort, setServerPort] = useState<number>(8448);

  const [agency, setAgency] = useState("");
  const [description, setDescription] = useState("");
  const [tlsPinHash, setTlsPinHash] = useState("");
  const [tokenType, setTokenType] = useState<"mdm" | "qr">("qr");
  const [duration, setDuration] = useState<string>("no_expiration");

  const [selectedToken, setSelectedToken] = useState<EnrollmentToken | null>(null);

  useEffect(() => {
    if (auth.user) {
      loadTokens();
    }
  }, [auth.user]);

  async function loadTokens() {
    if (!auth.user) return;
    try {
      setLoading(true);
      const data = await fetchEnrollmentTokens(auth.user);
      setTokens(data);
      try {
        const config = await fetchPortalConfig(auth.user);
        if (config && config.serverPort) {
          setServerPort(config.serverPort);
        }
      } catch (e) {
        console.warn("Failed to fetch portal config for server port:", e);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.user) return;
    if (!description) {
      setError("Description is required");
      return;
    }
    try {
      await createEnrollmentToken(auth.user, {
        type: tokenType,
        duration: tokenType === "qr" ? duration : undefined,
        agency: agency || undefined,
        description: description,
        tls_pin_hash: tlsPinHash || undefined,
      });
      setAgency("");
      setDescription("");
      setTlsPinHash("");
      loadTokens();
    } catch (err: any) {
      setError(err.message || "Failed to create token");
    }
  }

  async function handleRevoke(token: string) {
    if (!auth.user) return;
    if (!confirm("Are you sure you want to revoke this token?")) return;
    try {
      await revokeEnrollmentToken(auth.user, token);
      loadTokens();
      if (selectedToken?.token === token) {
        setSelectedToken(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to revoke token");
    }
  }

  async function handleDelete(token: string) {
    if (!auth.user) return;
    if (!confirm("Are you sure you want to permanently remove this token?")) return;
    try {
      await deleteEnrollmentToken(auth.user, token);
      loadTokens();
      if (selectedToken?.token === token) {
        setSelectedToken(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to remove token");
    }
  }


  function renderQrCode(t: EnrollmentToken) {
    const trackingUrl = `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
    const payload = JSON.stringify({
      enrollment_token: t.token,
      tls_pin_hash: t.tls_pin_hash || undefined,
      tracking_server_url: trackingUrl
    });

    return (
      <div className="card" style={{ marginTop: "1rem", position: "relative" }}>
        <button 
          onClick={() => setSelectedToken(null)}
          style={{ position: "absolute", top: "1rem", right: "1rem", cursor: "pointer" }}
        >
          Dismiss
        </button>
        <h3>{t.type === 'mdm' ? 'MDM Provisioning Config' : 'Scan QR Code to Enroll Device'}</h3>
        
        {t.type === 'qr' && (
          <>
            <p style={{ marginBottom: "1rem" }}>
              Use the BYOD scanner in the EUD Remote Assist app to scan this code.
            </p>
            <div style={{ background: "white", padding: "1rem", display: "inline-block", borderRadius: "8px" }}>
              <QRCodeSVG value={payload} size={256} />
            </div>
          </>
        )}

        <div style={{ marginTop: "1rem" }}>
          {t.type === 'mdm' ? (
            <>
              <strong>MDM Provisioning Config:</strong>
              <pre style={{ background: "#1a1a1a", padding: "1rem", borderRadius: "4px", overflowX: "auto" }}>
                {`{
  "enrollment_token": "${t.token}",
  "tls_pin_hash": "${t.tls_pin_hash || ""}",
  "tracking_server_url": "${trackingUrl}"
}`}
              </pre>
            </>
          ) : (
            <>
              <strong>Token String:</strong>
              <pre style={{ background: "#1a1a1a", padding: "0.5rem", borderRadius: "4px", overflowX: "auto", display: "inline-block", marginTop: "0.5rem", userSelect: "all" }}>
                {t.token}
              </pre>
            </>
          )}
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
            <label style={{ marginRight: "1rem" }}>
              <input 
                type="radio" 
                name="tokenType" 
                value="mdm" 
                checked={tokenType === "mdm"} 
                onChange={() => setTokenType("mdm")} 
              /> MDM Token
            </label>
            <label>
              <input 
                type="radio" 
                name="tokenType" 
                value="qr" 
                checked={tokenType === "qr"} 
                onChange={() => setTokenType("qr")} 
              /> QR Token
            </label>
          </div>
          
          {tokenType === "qr" && (
            <div>
              <label>Token Duration</label>
              <select 
                value={duration} 
                onChange={(e) => setDuration(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.5rem" }}
              >
                <option value="single_use">Single Use - token expires after one use</option>
                <option value="10_min">10 minutes - token expires in 10 minutes</option>
                <option value="1_hour">1 hour - token expires in 1 hour</option>
                <option value="8_hours">8 hours - token expires in 8 hours</option>
                <option value="24_hours">24 hours - token expires in 24 hours</option>
                <option value="no_expiration">No Expiration - token does not expire</option>
              </select>
            </div>
          )}

          <div>
            <label>Description (Required)</label>
            <input
              type="text"
              required
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
            <label>TLS Pin Hash (Optional)</label>
            <input
              type="text"
              value={tlsPinHash}
              onChange={(e) => setTlsPinHash(e.target.value)}
              placeholder="e.g. sha256/..."
              style={{ width: "100%", padding: "0.5rem" }}
            />
            <small style={{ color: "#888", display: "block", marginTop: "0.25rem" }}>
              Leave blank if using MDM or if you trust the OS Certificate Authority.
            </small>
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
              <th>Type</th>
              <th>Description</th>
              <th>Agency</th>
              <th>Created</th>
              <th>Expiration</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.token}>
                <td>{t.type === 'mdm' ? 'MDM' : 'QR'}</td>
                <td>{t.description || "—"}</td>
                <td>{t.agency || "—"}</td>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>
                  {(() => {
                    if (t.type === 'mdm') return "No Expiration";
                    if (t.max_uses !== null) return `${Math.max(0, t.max_uses - t.uses)} use(s) remaining`;
                    if (t.expires_at) {
                      const diff = new Date(t.expires_at).getTime() - Date.now();
                      if (diff <= 0) return "Time limit reached";
                      const minutes = Math.floor(diff / 60000);
                      if (minutes >= 60) {
                        return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
                      }
                      return `${minutes}m remaining`;
                    }
                    return "No Expiration";
                  })()}
                </td>
                <td>
                  {(() => {
                    if (!t.is_active) {
                      if (t.max_uses !== null && t.uses >= t.max_uses) return "Consumed";
                      return "Revoked";
                    }
                    if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) {
                      return "Expired";
                    }
                    return "Active";
                  })()}
                </td>
                <td>
                  <button onClick={() => setSelectedToken(t)} disabled={!t.is_active} style={{ marginRight: "0.5rem" }}>
                    {t.type === 'mdm' ? 'Show Config' : 'Show QR'}
                  </button>
                  {t.is_active ? (
                    <button
                      onClick={() => handleRevoke(t.token)}
                      className="danger-button"
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDelete(t.token)}
                      className="danger-button"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "1rem" }}>
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
