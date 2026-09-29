import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toasts.jsx";

const MAX_CAPTION = 2200;

export default function Publish({ profile, onPublished }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [dropText, setDropText] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [publishing, setPublishing] = useState(false);
  const [quota, setQuota] = useState(null);

  const loadQuota = useCallback(async () => {
    try {
      const res = await api.publishLimit();
      const d = (res.data || [])[0] || {};
      setQuota({ used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 50 });
    } catch {
      setQuota(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  useEffect(() => setImgError(false), [imageUrl]);

  async function upload(file) {
    if (!file) return;
    setDropText(`Uploading ${file.name}…`);
    try {
      const data = await api.upload(file);
      setImageUrl(data.image_url);
      setDropText(`Uploaded ${file.name} — click to replace`);
    } catch (e) {
      setDropText(`Upload failed: ${e.message}`);
      toast(e.message, "err");
    }
  }

  async function publish() {
    const url = imageUrl.trim();
    if (!url) return toast("Choose an image or paste an image URL first", "err");
    if (!window.confirm("Publish this post to your Instagram feed now?")) return;
    setPublishing(true);
    setStatus({ kind: "", text: "Publishing… this can take ~30 seconds" });
    try {
      const res = await api.publish(url, caption);
      setStatus({ kind: "ok", text: `Published ✓ (media ${res.media_id})` });
      setImageUrl("");
      setCaption("");
      setDropText(null);
      if (fileRef.current) fileRef.current.value = "";
      loadQuota();
      onPublished();
    } catch (e) {
      setStatus({ kind: "err", text: "Failed: " + e.message });
    }
    setPublishing(false);
  }

  const username = profile?.username || "you";
  const statusColor = { ok: "var(--ok)", err: "var(--err)" }[status.kind];

  return (
    <div className="publish">
      <div className="card pad">
        <div className="h2" style={{ marginBottom: 14 }}>
          New image post
        </div>

        <div className="field">
          <span className="lbl">Image</span>
          <label
            className={`drop ${dragOver ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              upload(e.dataTransfer.files[0]);
            }}
          >
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => upload(e.target.files[0])} />
            {dropText || (
              <>
                <b>Click to upload</b> or drag a JPEG/PNG here (max 8 MB)
              </>
            )}
          </label>
        </div>

        <div className="field">
          <label className="lbl" htmlFor="publish-url">…or public image URL</label>
          <input
            id="publish-url"
            className="input"
            placeholder="https://example.com/photo.jpg"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="lbl" htmlFor="publish-caption">Caption</label>
          <textarea
            id="publish-caption"
            className="input"
            rows={5}
            maxLength={MAX_CAPTION}
            placeholder="Write a caption… #hashtags"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="hint" style={{ textAlign: "right" }}>
            {caption.length} / {MAX_CAPTION}
          </div>
        </div>

        <div className="row">
          <button className="btn ig" onClick={publish} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish to Instagram"}
          </button>
          <span className="sub" style={{ color: statusColor }}>
            {status.text}
          </span>
        </div>

        <p className="hint" style={{ marginTop: 14 }}>
          Instagram downloads the image from its URL, so it must be publicly reachable. On <code>localhost</code> uploads won't
          work — paste an already-hosted image URL instead.
        </p>
      </div>

      <div>
        <div className="card phone section">
          <div className="ph-head">
            <div className="avatar">{username[0].toUpperCase()}</div>
            <span>{username}</span>
          </div>
          <div className="ph-img">
            {!imageUrl.trim() ? "Preview" : imgError ? "Image could not be loaded" : <img src={imageUrl.trim()} alt="" onError={() => setImgError(true)} />}
          </div>
          <div className="ph-cap">
            {caption ? (
              <>
                <b>{username}</b> {caption}
              </>
            ) : (
              <span className="sub">Your caption will appear here</span>
            )}
          </div>
        </div>

        <div className="card pad">
          <div className="row">
            <div className="h2">Publishing quota</div>
            <span className="spacer" />
            <span className="sub mono">
              {quota === null ? "—" : quota === false ? "unavailable" : `${quota.used} / ${quota.total} used`}
            </span>
          </div>
          <div className="quota">
            <div style={{ width: quota ? `${Math.min(100, (quota.used / quota.total) * 100)}%` : "0%" }} />
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            API-published posts allowed per rolling 24 hours.
          </div>
        </div>
      </div>
    </div>
  );
}
