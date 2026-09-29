import { useState } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toasts.jsx";
import { findMatchingRule } from "../utils.js";

const KINDS = [
  { id: "comments", tab: "Comments", title: "Comment rules" },
  { id: "dms", tab: "Direct messages", title: "DM rules" },
];

function RuleRow({ rule, kind, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function act(fn, success) {
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
      await onChanged();
    } catch (e) {
      toast(e.message, "err");
    }
    setBusy(false);
  }

  return (
    <div className={`rule ${rule.is_active ? "" : "off"}`}>
      <label className="switch" title={rule.is_active ? "Active - click to pause" : "Paused - click to activate"}>
        <input
          type="checkbox"
          checked={Boolean(rule.is_active)}
          disabled={busy}
          aria-label={`Toggle rule ${rule.keyword}`}
          onChange={(e) => act(() => api.toggleRule(kind, rule.id, e.target.checked))}
        />
        <span />
      </label>
      <div>
        <span className="kw">{rule.keyword}</span> <span className="badge">{rule.match_type}</span>
        <div className="reply">{rule.reply_text}</div>
      </div>
      <button
        className="btn sm danger"
        disabled={busy}
        onClick={() => window.confirm("Delete this rule?") && act(() => api.deleteRule(kind, rule.id), "Rule deleted")}
      >
        Delete
      </button>
    </div>
  );
}

export default function Rules({ rules, onChanged }) {
  const toast = useToast();
  const [kind, setKind] = useState("comments");
  const [form, setForm] = useState({ keyword: "", reply_text: "", match_type: "contains" });
  const [saving, setSaving] = useState(false);
  const [testText, setTestText] = useState("");

  const list = rules[kind];
  const meta = KINDS.find((k) => k.id === kind);
  const hit = findMatchingRule(testText, list);

  async function addRule(e) {
    e.preventDefault();
    const rule = { ...form, keyword: form.keyword.trim(), reply_text: form.reply_text.trim() };
    if (!rule.keyword || !rule.reply_text) return;
    setSaving(true);
    try {
      await api.addRule(kind, rule);
      setForm((f) => ({ ...f, keyword: "", reply_text: "" }));
      toast("Rule added");
      await onChanged();
    } catch (err) {
      toast(err.message, "err");
    }
    setSaving(false);
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <>
      <div className="section-head">
        <div>
          <div className="h2">Keyword auto-replies</div>
          <div className="sub">When a new comment or DM matches a keyword, the reply is sent automatically via the webhook.</div>
        </div>
        <div className="tabs" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              className={`tab ${kind === k.id ? "active" : ""}`}
              onClick={() => setKind(k.id)}
            >
              {k.tab}
            </button>
          ))}
        </div>
      </div>

      <div className="card pad section">
        <form className="rule-form" onSubmit={addRule}>
          <div>
            <label className="lbl" htmlFor="rule-keyword">Keyword</label>
            <input id="rule-keyword" className="input" placeholder="price" value={form.keyword} onChange={set("keyword")} required />
          </div>
          <div>
            <label className="lbl" htmlFor="rule-reply">Reply</label>
            <input
              id="rule-reply"
              className="input"
              placeholder={kind === "comments" ? "Hi! Check your DMs for pricing 💌" : "Thanks for reaching out! Our prices start at…"}
              value={form.reply_text}
              onChange={set("reply_text")}
              required
            />
          </div>
          <div>
            <label className="lbl" htmlFor="rule-match">Match</label>
            <select id="rule-match" className="input" value={form.match_type} onChange={set("match_type")}>
              <option value="contains">Contains</option>
              <option value="exact">Exact match</option>
            </select>
          </div>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add rule"}
          </button>
        </form>
      </div>

      <div className="card section">
        <div className="row pad" style={{ paddingBottom: 12 }}>
          <div className="h2">{meta.title}</div>
          <span className="spacer" />
          <span className="sub">
            {list.filter((r) => r.is_active).length} active of {list.length}
          </span>
        </div>
        {list.length ? (
          list.map((r) => <RuleRow key={r.id} rule={r} kind={kind} onChanged={onChanged} />)
        ) : (
          <div className="empty" style={{ borderTop: "1px solid var(--border)" }}>
            No rules yet — add your first keyword above.
          </div>
        )}
      </div>

      <div className="card pad section">
        <div className="h2">Test your rules</div>
        <div className="sub" style={{ marginBottom: 12 }}>
          Type a sample {kind === "comments" ? "comment" : "message"} to see which reply would be sent. Newest rules are checked first; paused rules are skipped.
        </div>
        <input className="input" placeholder="e.g. what's the price?" value={testText} onChange={(e) => setTestText(e.target.value)} />
        {testText.trim() && (
          <div className="test-result">
            {hit ? (
              <>
                <span className="badge ok">Match: {hit.keyword}</span> <span style={{ marginLeft: 6 }}>→ {hit.reply_text}</span>
              </>
            ) : (
              <>
                <span className="badge">No match</span> <span className="sub" style={{ marginLeft: 6 }}>No reply would be sent.</span>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
