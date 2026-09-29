import MediaGrid from "../components/MediaGrid.jsx";

export default function Posts({ media, onRefresh, onLoadMore, onOpenPost }) {
  return (
    <>
      <div className="section-head">
        <div>
          <div className="h2">Your posts</div>
          <div className="sub">Open a post to see reach, likes and saves, and to reply to, hide or delete comments.</div>
        </div>
        <button className="btn sm" onClick={onRefresh} disabled={media.loading}>
          ↻ Refresh
        </button>
      </div>
      <MediaGrid {...media} onOpen={onOpenPost} />
      {media.hasMore && !media.error && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button className="btn" onClick={onLoadMore} disabled={media.loading}>
            {media.loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
