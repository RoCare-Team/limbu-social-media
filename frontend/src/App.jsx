import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { icons } from "./components/Icons.jsx";
import PostDrawer from "./components/PostDrawer.jsx";
import Overview from "./pages/Overview.jsx";
import Posts from "./pages/Posts.jsx";
import Rules from "./pages/Rules.jsx";
import Publish from "./pages/Publish.jsx";
import Activity from "./pages/Activity.jsx";
import Settings from "./pages/Settings.jsx";
import LoginGate from "./pages/LoginGate.jsx";

const VIEWS = [
  { id: "overview", title: "Overview" },
  { id: "posts", title: "Posts & comments" },
  { id: "rules", title: "Auto-replies" },
  { id: "publish", title: "Create post" },
  { id: "activity", title: "Activity" },
  { id: "settings", title: "Settings" },
];
const POLL_MS = 10000;
const MEDIA_PAGE = 24;
const MEDIA_MAX = 100;

function readHash() {
  const h = window.location.hash.slice(1);
  return VIEWS.some((v) => v.id === h) ? h : "overview";
}

// The OAuth callback sends the browser back with ?login=success or ?login_error=...
function readLoginParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("login") === "success") return { kind: "ok", text: "Instagram account connected." };
  if (p.get("login_error")) return { kind: "err", text: "Login failed: " + p.get("login_error") };
  return null;
}

function toggleTheme() {
  const root = document.documentElement;
  const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked */
  }
}

export default function App() {
  const [view, setView] = useState(readHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginNotice] = useState(readLoginParams);
  const [dismissed, setDismissed] = useState(() => new Set());

  const [auth, setAuth] = useState(null);
  const [serverDown, setServerDown] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [media, setMedia] = useState({ items: [], hasMore: false, loading: true, error: null, limit: MEDIA_PAGE });
  const [rules, setRules] = useState({ comments: [], dms: [] });
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [openPost, setOpenPost] = useState(null);

  // ---- navigation ----
  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((id) => {
    if (window.location.hash !== "#" + id) window.location.hash = id;
    setView(id);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (loginNotice) window.history.replaceState({}, "", window.location.pathname + window.location.hash);
  }, [loginNotice]);

  // ---- data loaders ----
  const loadAuth = useCallback(async () => {
    try {
      setAuth(await api.authStatus());
      setServerDown(false);
    } catch {
      setServerDown(true);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await api.profile());
      setProfileError(null);
    } catch (e) {
      setProfileError(e.message);
    }
  }, []);

  const loadMedia = useCallback(async (limit = MEDIA_PAGE) => {
    setMedia((m) => ({ ...m, loading: true, error: null }));
    try {
      const res = await api.media(limit);
      setMedia({
        items: res.data || [],
        hasMore: limit < MEDIA_MAX && Boolean(res.paging?.next),
        loading: false,
        error: null,
        limit,
      });
    } catch (e) {
      setMedia((m) => ({ ...m, loading: false, error: e.message }));
    }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const [s, comments, dms] = await Promise.all([api.stats(), api.rules("comments"), api.rules("dms")]);
      setStats(s);
      setRules({ comments, dms });
    } catch {
      /* keep last good values; the next poll retries */
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      setLogs(await api.activity(100));
    } catch {
      /* same as above */
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  const connected = Boolean(auth?.connected);
  useEffect(() => {
    if (!connected) return;
    loadProfile();
    loadMedia();
    loadCounts();
    loadActivity();
    const t = setInterval(() => {
      loadCounts();
      loadActivity();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [connected, loadProfile, loadMedia, loadCounts, loadActivity]);

  const refreshAfterAction = useCallback(() => {
    loadCounts();
    loadActivity();
  }, [loadCounts, loadActivity]);

  // ---- banners ----
  const banners = [];
  if (loginNotice) banners.push({ key: "login", ...loginNotice });
  if (serverDown) banners.push({ key: "down", kind: "err", text: "Could not reach the backend. Is uvicorn running on port 8000?" });
  if (auth && !auth.connected && !auth.app_configured)
    banners.push({
      key: "noapp",
      kind: "warn",
      text: "IG_APP_ID and IG_APP_SECRET are empty in .env, so “Continue with Instagram” won't work yet. You can set IG_ACCESS_TOKEN instead.",
    });
  if (connected && profileError)
    banners.push({ key: "token", kind: "err", text: `Instagram rejected the access token: ${profileError}. Reconnect or update IG_ACCESS_TOKEN.` });
  if (connected && auth.expires_in_days !== undefined && auth.expires_in_days < 10)
    banners.push({ key: "expiry", kind: "warn", text: `Your access token expires in ${auth.expires_in_days} days. Extend it from Settings.` });

  // ---- status pill ----
  let status = ["", "Connecting…"];
  if (serverDown) status = ["bad", "Server offline"];
  else if (auth && !connected) status = ["bad", "Not connected"];
  else if (profileError) status = ["bad", "Token error"];
  else if (profile) status = ["ok", "Connected"];

  const current = VIEWS.find((v) => v.id === view);
  const ruleCount = rules.comments.length + rules.dms.length;

  const pages = {
    overview: (
      <Overview auth={auth} profile={profile} stats={stats} rules={rules} logs={logs} media={media} go={go} onOpenPost={setOpenPost} />
    ),
    posts: (
      <Posts
        media={media}
        onRefresh={() => loadMedia(media.limit)}
        onLoadMore={() => loadMedia(Math.min(media.limit + MEDIA_PAGE, MEDIA_MAX))}
        onOpenPost={setOpenPost}
      />
    ),
    rules: <Rules rules={rules} onChanged={loadCounts} />,
    publish: (
      <Publish
        profile={profile}
        onPublished={() => {
          loadMedia(media.limit);
          refreshAfterAction();
        }}
      />
    ),
    activity: <Activity logs={logs} />,
    settings: (
      <Settings
        auth={auth}
        profile={profile}
        onAuthChanged={() => {
          loadAuth();
          loadActivity();
        }}
      />
    ),
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="mark">L</div>
          <div>
            <b>LimbuAI</b>
            <small>Instagram Automation</small>
          </div>
        </div>
        {VIEWS.map((v) => (
          <button key={v.id} className={`nav ${view === v.id ? "active" : ""}`} onClick={() => go(v.id)}>
            {icons[v.id]}
            {v.title}
            {v.id === "rules" && <span className="count">{ruleCount}</span>}
          </button>
        ))}
        <div className="aside-foot">
          <a href="/app-review-guide.html">App Review guide</a>
          <a href="/api-docs.html">API docs</a>
          <button onClick={toggleTheme}>Toggle theme</button>
        </div>
      </aside>
      <div className={`scrim ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} />

      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="btn sm menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
              ☰
            </button>
            <h1>{current.title}</h1>
          </div>
          <div className="top-right">
            <div className={`status-pill ${status[0]}`}>
              <span className="dot" />
              <span>{status[1]}</span>
            </div>
            {auth && !connected && (
              <a className="btn ig sm" href="/auth/login">
                Continue with Instagram
              </a>
            )}
            {connected && profile && (
              <div className="chip">
                <div className="avatar">{(profile.username || "?")[0].toUpperCase()}</div>
                <span className="who mono">@{profile.username}</span>
              </div>
            )}
          </div>
        </header>

        <main className="content">
          {banners
            .filter((b) => !dismissed.has(b.key))
            .map((b) => (
              <div key={b.key} className={`banner ${b.kind}`}>
                <span>{b.text}</span>
                <button aria-label="Dismiss" onClick={() => setDismissed((d) => new Set(d).add(b.key))}>
                  ×
                </button>
              </div>
            ))}

          {auth && !connected && <LoginGate scopes={auth.scopes} />}
          {connected && pages[view]}
        </main>
      </div>

      <PostDrawer post={openPost} ownUsername={profile?.username} onClose={() => setOpenPost(null)} onChanged={refreshAfterAction} />
    </div>
  );
}
