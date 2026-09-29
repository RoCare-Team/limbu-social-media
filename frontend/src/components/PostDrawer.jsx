import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { fmtDateTime, fmtNum } from "../utils.js";
import { useToast } from "./Toasts.jsx";

// Friendly names for Graph API insight metrics, in display order.
const METRICS = {
  views: "Views",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saved: "Saves",
  total_interactions: "Interactions",
  profile_visits: "Profile visits",
  follows: "Follows",
  ig_reels_avg_watch_time: "Avg watch time",
  ig_reels_video_view_total_time: "Total watch time",
};

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function metricValue(i) {
  const v = i.values?.[0]?.value ?? i.total_value?.value ?? 0;
  return i.name.includes("watch_time") ? fmtDuration(v) : fmtNum(v);
}

function sortInsights(data) {
  const order = Object.keys(METRICS);
  const rank = (n) => (order.includes(n) ? order.indexOf(n) : order.length);
  return [...data].sort((a, b) => rank(a.name) - rank(b.name));
}

function SourceBadge({ source }) {
  return <span className={`badge ${source === "auto" ? "auto" : ""}`}>{source === "auto" ? "Auto-reply" : "Manual"}</span>;
}

function Reply({ reply, own }) {
  return (
    <div className={`reply ${own ? "own" : ""}`}>
      <div>
        <span className="who">@{reply.username}</span>
        {own && <span className="badge ok">You</span>} {reply.text}
      </div>
      <div className="when">
        {reply.timestamp ? new Date(reply.timestamp).toLocaleString() : ""}
        {reply.like_count ? ` · ♥ ${reply.like_count}` : ""}
      </div>
    </div>
  );
}

function Comment({ comment, post, ownUsername, sentReplies, onRemoved, onChanged }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const replies = [...(comment.replies?.data || [])].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  const isOwn = (u) => ownUsername && u === ownUsername;
  const answered = replies.some((r) => isOwn(r.username)) || sentReplies.some((r) => r.status === "success");
  const autoReplied = sentReplies.some((r) => r.source === "auto" && r.status === "success");
  const failed = sentReplies.find((r) => r.status === "failed");

  async function run(action, confirmText, successText, removes) {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    let ok = false;
    try {
      await action();
      toast(successText);
      onChanged();
      if (removes) onRemoved(comment.id);
      ok = true;
    } catch (e) {
      toast(e.message, "err");
    }
    setBusy(false);
    return ok;
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const context = { media_id: post.id, username: comment.username, comment_text: comment.text };
    const ok = await run(() => api.replyComment(comment.id, text.trim(), context), null, "Reply sent", false);
    if (ok) {
      setText("");
      setReplying(false);
    }
  }

  return (
    <div className="comment">
      <div>
        <span className="who">@{comment.username}</span>
        {comment.text}
      </div>
      <div className="when">
        {comment.timestamp ? new Date(comment.timestamp).toLocaleString() : ""}
        {comment.like_count ? ` · ♥ ${comment.like_count}` : ""}
        {" · "}
        {autoReplied ? (
          <span className="badge auto">Auto-replied</span>
        ) : answered ? (
          <span className="badge ok">Replied</span>
        ) : (
          <span className="badge warn">Not replied</span>
        )}
        {failed && <span className="badge err" title={failed.error || ""}>Reply failed</span>}
      </div>
      {replies.length > 0 && (
        <div className="thread">
          {replies.map((r) => (
            <Reply key={r.id} reply={r} own={isOwn(r.username)} />
          ))}
        </div>
      )}
      <div className="actions">
        <button className="btn sm" onClick={() => setReplying((r) => !r)} disabled={busy}>
          Reply
        </button>
        <button
          className="btn sm"
          disabled={busy}
          onClick={() => run(() => api.hideComment(comment.id), "Hide this comment from your post?", "Comment hidden", true)}
        >
          Hide
        </button>
        <button
          className="btn sm danger"
          disabled={busy}
          onClick={() => run(() => api.deleteComment(comment.id), "Permanently delete this comment?", "Comment deleted", true)}
        >
          Delete
        </button>
      </div>
      {replying && (
        <form className="reply-box" onSubmit={sendReply}>
          <input className="input" autoFocus placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn sm primary" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

// One row of the local reply history: what came in, what we sent back.
function SentRow({ row, kind }) {
  const who = row.from_username ? `@${row.from_username}` : row.from_id ? `User ${row.from_id}` : "Someone";
  return (
    <div className="sent">
      <div className="row" style={{ gap: 6 }}>
        <span className="who">{who}</span>
        <SourceBadge source={row.source} />
        {row.status !== "success" && <span className="badge err">failed</span>}
        <span className="spacer" />
        <span className="when">{fmtDateTime(row.created_at)}</span>
      </div>
      {row.incoming_text && (
        <div className="bubble in">
          <span className="lbl-sm">{kind === "dm" ? "Message" : "Comment"}</span>
          {row.incoming_text}
        </div>
      )}
      <div className="bubble out">
        <span className="lbl-sm">Our reply</span>
        {row.reply_text}
      </div>
      {row.error && <div className="when" style={{ color: "var(--err)" }}>{row.error}</div>}
    </div>
  );
}

const load = (setter, promise) => {
  setter({ loading: true, data: [], error: null });
  return promise
    .then((res) => setter({ loading: false, data: Array.isArray(res) ? res : res?.data || [], error: null }))
    .catch((e) => setter({ loading: false, data: [], error: e.message }));
};

function ListState({ state, emptyText, children }) {
  if (state.loading) return <div className="empty">Loading…</div>;
  if (state.error) return <div className="empty">Could not load: {state.error}</div>;
  if (!state.data.length) return <div className="empty">{emptyText}</div>;
  return children;
}

export default function PostDrawer({ post, ownUsername, onClose, onChanged }) {
  const empty = { loading: false, data: [], error: null };
  const [insights, setInsights] = useState(empty);
  const [comments, setComments] = useState(empty);
  const [sent, setSent] = useState(empty);
  const [dms, setDms] = useState(empty);
  const [tab, setTab] = useState("comments");
  const open = Boolean(post);

  const reload = useCallback((p) => {
    load(setComments, api.comments(p.id));
    load(setSent, api.replies({ kind: "comment", media_id: p.id }));
    load(setDms, api.replies({ kind: "dm", limit: 50 }));
  }, []);

  useEffect(() => {
    if (!post) return;
    setTab("comments");
    load(setInsights, api.insights(post.id, post.media_type));
    reload(post);
  }, [post, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sentByComment = (id) => sent.data.filter((r) => r.comment_id === id);
  const repliedCount = comments.data.filter(
    (c) => c.replies?.data?.some((r) => r.username === ownUsername) || sentByComment(c.id).some((r) => r.status === "success"),
  ).length;
  const threadReplies = comments.data.reduce((n, c) => n + (c.replies?.data?.length || 0), 0);

  const tabs = [
    { id: "comments", label: "Comments", count: comments.data.length },
    { id: "sent", label: "Replies sent", count: sent.data.length },
    { id: "dms", label: "DM replies", count: dms.data.length },
  ];

  return (
    <>
      <div className={`drawer-bg ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Post details">
        <div className="drawer-head">
          <div className="h2" style={{ margin: 0 }}>
            Post details
          </div>
          <span className="spacer" />
          {post?.permalink && (
            <a className="btn sm" href={post.permalink} target="_blank" rel="noopener noreferrer">
              Open on Instagram ↗
            </a>
          )}
          <button className="btn sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {post && (
          <div className="drawer-body">
            <div className="drawer-media">
              <img src={post.thumbnail_url || post.media_url || ""} alt="" />
              <div>
                <div className="sub">{post.timestamp ? new Date(post.timestamp).toLocaleString() : ""}</div>
                <div className="drawer-caption">{post.caption || "(no caption)"}</div>
              </div>
            </div>

            <div className="engage">
              <div>
                <div className="v">♥ {fmtNum(post.like_count ?? 0)}</div>
                <div className="l">Likes</div>
              </div>
              <div>
                <div className="v">💬 {fmtNum(post.comments_count ?? 0)}</div>
                <div className="l">Comments</div>
              </div>
              <div>
                <div className="v">
                  {comments.loading ? "…" : `${repliedCount}/${comments.data.length}`}
                </div>
                <div className="l">Answered</div>
              </div>
              <div>
                <div className="v">{comments.loading ? "…" : fmtNum(threadReplies)}</div>
                <div className="l">Thread replies</div>
              </div>
            </div>

            <div className="h2" style={{ marginBottom: 8 }}>
              Insights
            </div>
            <div className="insights">
              {insights.loading &&
                Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
              {insights.error && (
                <div className="sub" style={{ gridColumn: "1 / -1", background: "none", textAlign: "left", padding: 0 }}>
                  Insights unavailable: {insights.error}
                </div>
              )}
              {sortInsights(insights.data).map((i) => (
                <div key={i.name} title={i.description || ""}>
                  <div className="v">{metricValue(i)}</div>
                  <div className="l">{METRICS[i.name] || i.title || i.name}</div>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginBottom: 8 }}>
              <div className="tabs">
                {tabs.map((t) => (
                  <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                    {t.label} <span className="tab-count">{t.count}</span>
                  </button>
                ))}
              </div>
              <span className="spacer" />
              <button className="btn sm" onClick={() => reload(post)} aria-label="Reload">
                ↻
              </button>
            </div>

            {tab === "comments" && (
              <ListState state={comments} emptyText="No comments yet">
                {comments.data.map((c) => (
                  <Comment
                    key={c.id}
                    comment={c}
                    post={post}
                    ownUsername={ownUsername}
                    sentReplies={sentByComment(c.id)}
                    onChanged={() => {
                      onChanged();
                      reload(post);
                    }}
                    onRemoved={(id) => setComments((s) => ({ ...s, data: s.data.filter((x) => x.id !== id) }))}
                  />
                ))}
              </ListState>
            )}

            {tab === "sent" && (
              <ListState
                state={sent}
                emptyText="No replies sent from this dashboard on this post yet. Auto-replies and manual replies show up here."
              >
                {sent.data.map((r) => (
                  <SentRow key={r.id} row={r} kind="comment" />
                ))}
              </ListState>
            )}

            {tab === "dms" && (
              <>
                <div className="hint" style={{ marginBottom: 6 }}>
                  DMs aren't linked to a specific post, so this shows the latest DM auto-replies across your account.
                </div>
                <ListState state={dms} emptyText="No DM replies sent yet">
                  {dms.data.map((r) => (
                    <SentRow key={r.id} row={r} kind="dm" />
                  ))}
                </ListState>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
