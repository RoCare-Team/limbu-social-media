import MediaGrid from "../components/MediaGrid.jsx";
import LogRow from "../components/LogRow.jsx";
import { fmtNum } from "../utils.js";

function Stat({ label, value, foot }) {
  return (
    <div className="card stat">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      <div className="f">{foot}</div>
    </div>
  );
}

function Checklist({ auth, profile, rules, logs }) {
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const items = [
    [Boolean(auth?.connected && profile), "Instagram account connected", "Check your access token"],
    [Boolean(auth?.app_configured), "Instagram login configured", "Set IG_APP_ID and IG_APP_SECRET in .env"],
    [rules.comments.length + rules.dms.length > 0, "At least one auto-reply rule", "Add rules under Auto-replies"],
    [!isLocal, "Deployed on a public URL", "Webhooks need public HTTPS (deploy or use ngrok)"],
    [logs.some((l) => l.event_type === "webhook_received"), "Webhook receiving events", "Connect the webhook in Meta App Dashboard"],
  ];
  return (
    <ul className="checklist" style={{ marginTop: 6 }}>
      {items.map(([ok, title, help]) => (
        <li key={title}>
          <span className={`ic ${ok ? "ok" : "todo"}`}>{ok ? "✓" : "!"}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{title}</div>
            {!ok && <div className="sub">{help}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Overview({ auth, profile, stats, rules, logs, media, go, onOpenPost }) {
  const all = [...rules.comments, ...rules.dms];
  const autoTotal = stats ? stats.auto_comment_replies + stats.auto_dm_replies : null;

  return (
    <>
      <div className="stats">
        <Stat
          label="Posts"
          value={fmtNum(profile?.media_count)}
          foot={(profile?.account_type || "").replace("_", " ").toLowerCase()}
        />
        <Stat
          label="Active rules"
          value={stats ? all.filter((r) => r.is_active).length : "—"}
          foot={`${rules.comments.length} comment · ${rules.dms.length} DM`}
        />
        <Stat
          label="Auto-replies sent"
          value={fmtNum(autoTotal)}
          foot={stats ? `${stats.auto_comment_replies} comments · ${stats.auto_dm_replies} DMs` : ""}
        />
        <Stat label="Failed events" value={fmtNum(stats?.failures)} foot="from activity log" />
      </div>

      <div className="grid-2">
        <div className="section">
          <div className="section-head">
            <div>
              <div className="h2">Latest posts</div>
              <div className="sub">Click a post for insights and comments</div>
            </div>
            <button className="btn sm" onClick={() => go("posts")}>
              View all
            </button>
          </div>
          <MediaGrid {...media} max={6} onOpen={onOpenPost} />
        </div>

        <div>
          <div className="section card pad">
            <div className="h2">Setup checklist</div>
            <Checklist auth={auth} profile={profile} rules={rules} logs={logs} />
          </div>
          <div className="section card">
            <div className="row pad" style={{ paddingBottom: 6 }}>
              <div className="h2">Recent activity</div>
              <span className="spacer" />
              <button className="btn sm" onClick={() => go("activity")}>
                All
              </button>
            </div>
            {logs.length ? logs.slice(0, 6).map((l) => <LogRow key={l.id} log={l} compact />) : <div className="empty">No activity yet</div>}
          </div>
        </div>
      </div>
    </>
  );
}
