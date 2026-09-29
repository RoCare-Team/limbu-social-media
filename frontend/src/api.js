// Thin client for the FastAPI backend (backend/main.py). All URLs are relative:
// Vite proxies them in dev, and FastAPI serves this app itself in production.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || res.statusText || "Request failed";
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return data;
}

const send = (method, url, body) =>
  request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

const id = (v) => encodeURIComponent(v);

export const api = {
  // auth
  authStatus: () => request("/api/auth/status"),
  logout: () => send("POST", "/api/auth/logout"),
  refreshToken: () => send("POST", "/api/auth/refresh"),

  // account + media
  profile: () => request("/api/profile"),
  media: (limit = 24) => request(`/api/media?limit=${limit}`),
  insights: (mediaId, mediaType) =>
    request(`/api/media/${id(mediaId)}/insights${mediaType ? `?media_type=${id(mediaType)}` : ""}`),
  comments: (mediaId) => request(`/api/media/${id(mediaId)}/comments`),

  // comment moderation
  // context ({ media_id, username, comment_text }) is stored in the reply history
  replyComment: (commentId, message, context = {}) =>
    send("POST", `/api/comments/${id(commentId)}/reply`, { message, ...context }),
  hideComment: (commentId) => send("POST", `/api/comments/${id(commentId)}/hide`, { hide: true }),
  deleteComment: (commentId) => request(`/api/comments/${id(commentId)}`, { method: "DELETE" }),

  // auto-reply rules; kind is "comments" or "dms"
  rules: (kind) => request(`/api/rules/${kind}`),
  addRule: (kind, rule) => send("POST", `/api/rules/${kind}`, rule),
  toggleRule: (kind, ruleId, isActive) => send("PATCH", `/api/rules/${kind}/${ruleId}`, { is_active: isActive }),
  deleteRule: (kind, ruleId) => request(`/api/rules/${kind}/${ruleId}`, { method: "DELETE" }),

  // dashboard data
  stats: () => request("/api/stats"),
  activity: (limit = 100) => request(`/api/activity?limit=${limit}`),
  // sent comment/DM replies; params: { kind: "comment" | "dm", media_id, limit }
  replies: (params = {}) => request(`/api/replies?${new URLSearchParams(params)}`),

  // publishing
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/upload", { method: "POST", body: form });
  },
  publish: (imageUrl, caption) => send("POST", "/api/publish", { image_url: imageUrl, caption }),
  publishLimit: () => request("/api/publish/limit"),
};
