export function fmtNum(n) {
  return n == null ? "—" : Number(n).toLocaleString();
}

// SQLite CURRENT_TIMESTAMP is UTC without a zone marker ("2026-09-28 13:36:26").
export function parseDbDate(s) {
  if (!s) return null;
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d) ? null : d;
}

export function fmtDateTime(s) {
  const d = parseDbDate(s);
  return d ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : s || "";
}

export function fmtShortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
}

export const EVENT_LABELS = {
  auto_comment_reply: "Auto comment reply",
  auto_dm_reply: "Auto DM reply",
  webhook_received: "Webhook received",
  manual_comment_reply: "Manual reply",
  manual_hide_comment: "Comment hidden",
  manual_delete_comment: "Comment deleted",
  publish_post: "Post published",
  login: "Login",
  logout: "Logout",
  token_refresh: "Token extended",
};

// Mirrors backend/rules_engine.py so the rule tester predicts what the webhook will do.
export function findMatchingRule(text, rules) {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  return (
    rules
      .filter((r) => r.is_active)
      .find((r) => {
        const kw = r.keyword.toLowerCase().trim();
        return r.match_type === "exact" ? t.trim() === kw : t.includes(kw);
      }) || null
  );
}
