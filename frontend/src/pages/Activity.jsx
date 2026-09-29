import { useState } from "react";
import LogRow from "../components/LogRow.jsx";

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "auto", label: "Auto-replies", test: (l) => l.event_type.startsWith("auto_") },
  { id: "manual", label: "Manual", test: (l) => l.event_type.startsWith("manual_") },
  { id: "failed", label: "Failed", test: (l) => l.status === "failed" },
];

export default function Activity({ logs }) {
  const [filter, setFilter] = useState("all");
  const shown = logs.filter(FILTERS.find((f) => f.id === filter).test);

  return (
    <>
      <div className="section-head">
        <div>
          <div className="h2">Activity log</div>
          <div className="sub">Webhooks, auto-replies, manual actions and logins. Refreshes every 10 seconds.</div>
        </div>
        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`btn sm ${filter === f.id ? "primary" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">{shown.length ? shown.map((l) => <LogRow key={l.id} log={l} />) : <div className="empty">Nothing here yet</div>}</div>
    </>
  );
}
