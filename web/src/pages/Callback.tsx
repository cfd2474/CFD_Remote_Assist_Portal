import { useAuth } from "react-oidc-context";
import { Navigate } from "react-router-dom";

export function Callback() {
  const auth = useAuth();

  if (auth.isLoading) {
    return <p className="loading">Completing sign-in…</p>;
  }

  if (auth.error) {
    return <p className="error">Sign-in failed: {auth.error.message}</p>;
  }

  return <Navigate to="/" replace />;
}
