import { EVENT_LABELS, fmtDateTime } from "../utils.js";

function StatusBadge({ status }) {
  return <span className={`badge ${status === "success" ? "ok" : "err"}`}>{status}</span>;
}

export default function LogRow({ log, compact }) {
  const label = EVENT_LABELS[log.event_type] || log.event_type;
  if (compact) {
    return (
      <div className="log compact">
        <span>
          <span className="e">{label}</span> <StatusBadge status={log.status} />
        </span>
        <span className="t">{fmtDateTime(log.created_at)}</span>
      </div>
    );
  }
  return (
    <div className="log">
      <span className="t">{fmtDateTime(log.created_at)}</span>
      <span>
        <StatusBadge status={log.status} />
      </span>
      <span className="e">{label}</span>
      <span className="d">{log.detail}</span>
    </div>
  );
}
