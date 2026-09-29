import { useState } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toasts.jsx";

function CopyValue({ value }) {
  const toast = useToast();
  return (
    <dd className="copy">
      <span className="code">{value || "—"}</span>
      {value && (
        <button
          className="btn sm"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(
              () => toast("Copied"),
              () => toast("Could not copy", "err")
            )
          }
        >
          Copy
        </button>
      )}
    </dd>
  );
}

export default function Settings({ auth, profile, onAuthChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const fromEnv = auth?.source === "env";
  // The backend builds redirect_uri from PUBLIC_BASE_URL, so derive the webhook from it
  // too - window.location would show the Vite dev port instead of the backend.
  const backendBase = auth?.redirect_uri ? auth.redirect_uri.replace(/\/auth\/callback$/, "") : window.location.origin;

  async function refresh() {
    setBusy(true);
    try {
      const r = await api.refreshToken();
      toast(`Token extended (${Math.round((r.expires_in || 0) / 86400)} days)`);
      onAuthChanged();
    } catch (e) {
      toast(e.message, "err");
    }
    setBusy(false);
  }

  async function logout() {
    const msg = fromEnv
      ? "This account comes from IG_ACCESS_TOKEN in .env, so it will stay connected until you remove it there. Continue?"
      : "Disconnect this Instagram account?";
    if (!window.confirm(msg)) return;
    await api.logout();
    onAuthChanged();
  }

  const rows = [
    ["Username", profile?.username ? "@" + profile.username : "—"],
    ["Account ID", <span className="mono">{profile?.id || auth?.ig_user_id || "—"}</span>],
    ["Account type", profile?.account_type || "—"],
    ["Token source", fromEnv ? <><code>IG_ACCESS_TOKEN</code> in .env</> : "Instagram login"],
    ["Token expires", auth?.expires_in_days !== undefined ? `in ${auth.expires_in_days} days` : "unknown (env token)"],
  ];

  return (
    <>
      <div className="card pad section">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="h2">Connected account</div>
          <span className="spacer" />
          <button className="btn sm" onClick={refresh} disabled={busy}>
            Extend token 60 days
          </button>
          <button className="btn sm danger" onClick={logout}>
            Disconnect
          </button>
        </div>
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card pad section">
        <div className="h2">Webhook (real-time auto-replies)</div>
        <div className="sub" style={{ marginBottom: 14 }}>
          Meta App Dashboard → Instagram → Webhooks. Subscribe to <code>comments</code> and <code>messages</code>. The URL must be
          public HTTPS — use a tunnel like ngrok when testing locally.
        </div>
        <dl className="kv">
          <dt>Callback URL</dt>
          <CopyValue value={`${backendBase}/webhook`} />
          <dt>Verify token</dt>
          <dd>
            Value of <code>VERIFY_TOKEN</code> in your <code>.env</code>
          </dd>
        </dl>
      </div>

      <div className="card pad section">
        <div className="h2">Instagram login (OAuth)</div>
        <div className="sub" style={{ marginBottom: 14 }}>
          Add this under “OAuth redirect URIs” in Instagram business login settings. Needs <code>IG_APP_ID</code> and{" "}
          <code>IG_APP_SECRET</code> in <code>.env</code>.
        </div>
        <dl className="kv">
          <dt>Redirect URI</dt>
          <CopyValue value={auth?.redirect_uri} />
          <dt>App credentials</dt>
          <dd>
            {auth?.app_configured ? (
              <span className="badge ok">Configured</span>
            ) : (
              <span className="badge err">Missing IG_APP_ID / IG_APP_SECRET</span>
            )}
          </dd>
          <dt>Scopes</dt>
          <dd className="scope-list">
            {(auth?.scopes || []).map((s) => (
              <span key={s} className="badge mono">
                {s}
              </span>
            ))}
          </dd>
        </dl>
      </div>
    </>
  );
}
