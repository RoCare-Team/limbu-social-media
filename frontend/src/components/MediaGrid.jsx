import { fmtNum, fmtShortDate } from "../utils.js";

const TYPE_LABELS = { CAROUSEL_ALBUM: "Carousel", VIDEO: "Reel", IMAGE: "" };

function MediaCard({ post, onOpen }) {
  const src = post.thumbnail_url || post.media_url;
  const type = TYPE_LABELS[post.media_type] ?? post.media_type;
  return (
    <button className="card media" onClick={() => onOpen(post)}>
      <div className="thumb">
        {src && <img loading="lazy" src={src} alt="" />}
        {type && <span className="type">{type}</span>}
      </div>
      <div className="body">
        <div className="cap">{post.caption || "No caption"}</div>
        <div className="meta">
          <span>♥ {fmtNum(post.like_count ?? 0)}</span>
          <span>💬 {fmtNum(post.comments_count ?? 0)}</span>
          <span style={{ marginLeft: "auto" }}>{fmtShortDate(post.timestamp)}</span>
        </div>
      </div>
    </button>
  );
}

export default function MediaGrid({ items, loading, error, max, onOpen }) {
  if (error) return <div className="empty">Could not load posts: {error}</div>;
  if (loading && !items.length) {
    return (
      <div className="media-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card media">
            <div className="thumb skeleton" />
            <div className="body">
              <div className="cap">&nbsp;</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!items.length) return <div className="empty">No posts yet</div>;
  return (
    <div className="media-grid">
      {(max ? items.slice(0, max) : items).map((p) => (
        <MediaCard key={p.id} post={p} onOpen={onOpen} />
      ))}
    </div>
  );
}
