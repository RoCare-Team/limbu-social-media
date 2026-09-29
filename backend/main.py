from fastapi import FastAPI, Request, Query, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import hmac
import hashlib
import os
import sys
import time
import uuid
from urllib.parse import urlencode

# Allow `uvicorn main:app` from inside backend/ as well as `uvicorn backend.main:app`
# from the project root: without a parent package the relative imports below fail.
if not __package__:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "backend"

from .config import (
    VERIFY_TOKEN, APP_SECRET, UPLOAD_DIR, PUBLIC_BASE_URL, REQUIRED_SCOPES,
    FRONTEND_DIST, FRONTEND_URL,
)
from . import instagram_client as ig
from . import oauth
from .db import (
    init_db, get_conn, log_activity, log_reply, get_account, save_account, clear_account,
)
from .rules_engine import find_matching_reply

app = FastAPI(title="LimbuAI Instagram Automation Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


@app.exception_handler(ig.NotConnectedError)
def _not_connected(request: Request, exc: ig.NotConnectedError):
    return JSONResponse({"detail": str(exc)}, status_code=401)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Dashboard data endpoints
# ---------------------------------------------------------------------------

@app.get("/api/profile")
def api_profile():
    try:
        return ig.get_profile()
    except ig.NotConnectedError:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/media")
def api_media(limit: int = 12):
    try:
        return ig.get_media(limit=limit)
    except ig.NotConnectedError:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/media/{media_id}/insights")
def api_media_insights(media_id: str, media_type: str | None = None):
    # Try the richest metric set for this media type, then degrade: some media
    # (older posts, albums) reject individual metrics.
    attempts = [ig.EXTENDED_METRICS.get(media_type or ""), ig.BASE_METRICS, "reach"]
    last_error = None
    for metrics in filter(None, attempts):
        try:
            return ig.get_media_insights(media_id, metrics=metrics)
        except ig.NotConnectedError:
            raise
        except Exception as e:
            last_error = e
    raise HTTPException(500, str(last_error))


@app.get("/api/media/{media_id}/comments")
def api_media_comments(media_id: str):
    try:
        return ig.get_comments(media_id)
    except ig.NotConnectedError:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/stats")
def api_stats():
    """Counts for the overview cards - all local, no Instagram call."""
    with get_conn() as conn:
        def count(table, where="1 = 1"):
            return conn.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {where}").fetchone()["n"]
        return {
            "comment_rules": count("comment_rules"),
            "dm_rules": count("dm_rules"),
            "auto_comment_replies": count(
                "activity_log", "event_type = 'auto_comment_reply' AND status = 'success'"
            ),
            "auto_dm_replies": count(
                "activity_log", "event_type = 'auto_dm_reply' AND status = 'success'"
            ),
            "failures": count("activity_log", "status = 'failed'"),
        }


@app.post("/api/comments/{comment_id}/reply")
def api_reply_comment(comment_id: str, payload: dict):
    message = payload.get("message", "")
    if not message:
        raise HTTPException(400, "message is required")
    context = {
        "media_id": payload.get("media_id"),
        "comment_id": comment_id,
        "from_username": payload.get("username"),
        "incoming_text": payload.get("comment_text"),
    }
    try:
        result = ig.reply_to_comment(comment_id, message)
        log_activity("manual_comment_reply", f"comment_id={comment_id} message={message}")
        log_reply("comment", "manual", message, **context)
        return result
    except Exception as e:
        log_activity("manual_comment_reply", str(e), status="failed")
        log_reply("comment", "manual", message, status="failed", error=str(e), **context)
        raise HTTPException(500, str(e))


@app.post("/api/comments/{comment_id}/hide")
def api_hide_comment(comment_id: str, payload: dict):
    hide = payload.get("hide", True)
    try:
        result = ig.hide_comment(comment_id, hide=hide)
        log_activity("manual_hide_comment", f"comment_id={comment_id} hide={hide}")
        return result
    except Exception as e:
        log_activity("manual_hide_comment", str(e), status="failed")
        raise HTTPException(500, str(e))


@app.delete("/api/comments/{comment_id}")
def api_delete_comment(comment_id: str):
    try:
        result = ig.delete_comment(comment_id)
        log_activity("manual_delete_comment", f"comment_id={comment_id}")
        return result
    except Exception as e:
        log_activity("manual_delete_comment", str(e), status="failed")
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Auto-reply rules management (comments)
# ---------------------------------------------------------------------------

@app.get("/api/rules/comments")
def list_comment_rules():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM comment_rules ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/rules/comments")
def create_comment_rule(payload: dict):
    keyword = payload.get("keyword")
    reply_text = payload.get("reply_text")
    match_type = payload.get("match_type", "contains")
    if not keyword or not reply_text:
        raise HTTPException(400, "keyword and reply_text are required")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO comment_rules (keyword, reply_text, match_type) VALUES (?, ?, ?)",
            (keyword, reply_text, match_type),
        )
        conn.commit()
    return {"status": "created"}


@app.delete("/api/rules/comments/{rule_id}")
def delete_comment_rule(rule_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM comment_rules WHERE id = ?", (rule_id,))
        conn.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Auto-reply rules management (DMs)
# ---------------------------------------------------------------------------

@app.get("/api/rules/dms")
def list_dm_rules():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM dm_rules ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/rules/dms")
def create_dm_rule(payload: dict):
    keyword = payload.get("keyword")
    reply_text = payload.get("reply_text")
    match_type = payload.get("match_type", "contains")
    if not keyword or not reply_text:
        raise HTTPException(400, "keyword and reply_text are required")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO dm_rules (keyword, reply_text, match_type) VALUES (?, ?, ?)",
            (keyword, reply_text, match_type),
        )
        conn.commit()
    return {"status": "created"}


@app.delete("/api/rules/dms/{rule_id}")
def delete_dm_rule(rule_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM dm_rules WHERE id = ?", (rule_id,))
        conn.commit()
    return {"status": "deleted"}


RULE_TABLES = {"comments": "comment_rules", "dms": "dm_rules"}


@app.patch("/api/rules/{kind}/{rule_id}")
def toggle_rule(kind: str, rule_id: int, payload: dict):
    """Switch a rule on/off without deleting it: {"is_active": true|false}."""
    table = RULE_TABLES.get(kind)
    if not table:
        raise HTTPException(404, "Unknown rule type")
    is_active = 1 if payload.get("is_active", True) else 0
    with get_conn() as conn:
        conn.execute(f"UPDATE {table} SET is_active = ? WHERE id = ?", (is_active, rule_id))
        conn.commit()
    return {"status": "updated", "is_active": bool(is_active)}


# ---------------------------------------------------------------------------
# Reply history (comment replies and DM replies we sent)
# ---------------------------------------------------------------------------

@app.get("/api/replies")
def api_replies(kind: str | None = None, media_id: str | None = None, limit: int = 100):
    where, params = [], []
    if kind:
        where.append("kind = ?")
        params.append(kind)
    if media_id:
        where.append("media_id = ?")
        params.append(media_id)
    sql = "SELECT * FROM reply_log"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

@app.get("/api/activity")
def api_activity(limit: int = 50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Instagram Business Login (OAuth)
# This is the flow Meta's App Review screencasts must open with.
# ---------------------------------------------------------------------------

def _redirect_uri(request: Request) -> str:
    """Callback URL for this deployment - must match the App Dashboard entry."""
    base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return f"{base}/auth/callback"


@app.get("/api/auth/status")
def auth_status(request: Request):
    account = get_account()
    status = {
        "connected": bool(account),
        "app_configured": oauth.is_configured(),
        "scopes": REQUIRED_SCOPES,
        "redirect_uri": _redirect_uri(request),
    }
    if account:
        status["ig_user_id"] = account.get("ig_user_id")
        status["username"] = account.get("username")
        status["source"] = account.get("source", "login")
        expires_at = account.get("expires_at")
        if expires_at:
            status["expires_in_days"] = max(0, round((expires_at - time.time()) / 86400))
    return status


def _back_to_dashboard(**params) -> RedirectResponse:
    """Return to the dashboard (the Vite dev server when FRONTEND_URL is set)."""
    return RedirectResponse(f"{FRONTEND_URL}/?{urlencode(params)}")


@app.get("/auth/login")
def auth_login(request: Request):
    """Send the user to Instagram's permission screen."""
    try:
        return RedirectResponse(oauth.build_authorize_url(_redirect_uri(request)))
    except oauth.OAuthError as e:
        raise HTTPException(500, str(e))


@app.get("/auth/callback")
def auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """Instagram redirects here after the user presses Allow (or Cancel)."""
    if error:
        log_activity("login", error_description or error, status="failed")
        return _back_to_dashboard(login_error=error_description or error)
    if not code:
        return _back_to_dashboard(login_error="No authorization code was returned")
    if not oauth.consume_state(state):
        return _back_to_dashboard(login_error="Login session expired, please try again")

    redirect_uri = _redirect_uri(request)
    try:
        short = oauth.exchange_code(code, redirect_uri)
        long_lived = oauth.exchange_for_long_lived(short["access_token"])
    except oauth.OAuthError as e:
        log_activity("login", str(e), status="failed")
        return _back_to_dashboard(login_error=str(e))

    token = long_lived["access_token"]
    expires_in = long_lived.get("expires_in")
    ig_user_id = str(short.get("user_id") or "")
    save_account(ig_user_id=ig_user_id, access_token=token, expires_in=expires_in)

    # Now that a token is stored, fill in the username for the header.
    try:
        profile = ig.get_profile()
        save_account(
            ig_user_id=profile.get("id", ig_user_id),
            access_token=token,
            expires_in=expires_in,
            username=profile.get("username"),
        )
        log_activity("login", "connected @" + str(profile.get("username")))
    except Exception as e:
        log_activity("login", f"token saved but profile fetch failed: {e}", status="failed")

    return _back_to_dashboard(login="success")


@app.post("/api/auth/logout")
def auth_logout():
    clear_account()
    log_activity("logout", "account disconnected")
    return {"status": "disconnected"}


@app.post("/api/auth/refresh")
def auth_refresh():
    """Extend the long-lived token by another 60 days."""
    account = get_account()
    if not account:
        raise HTTPException(400, "No account connected")
    try:
        data = oauth.refresh_long_lived(account["access_token"])
    except oauth.OAuthError as e:
        raise HTTPException(500, str(e))
    save_account(
        ig_user_id=account["ig_user_id"],
        access_token=data["access_token"],
        expires_in=data.get("expires_in"),
        username=account.get("username"),
    )
    log_activity("token_refresh", "long-lived token extended")
    return {"status": "refreshed", "expires_in": data.get("expires_in")}


# ---------------------------------------------------------------------------
# Content publishing (instagram_business_content_publish)
# ---------------------------------------------------------------------------

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@app.post("/api/upload")
async def api_upload(request: Request, file: UploadFile = File(...)):
    """Store an image locally and hand back a public URL that Instagram can fetch.

    Instagram downloads the image itself, so this URL must be reachable from the
    internet - on localhost, paste an already-hosted image URL instead.
    """
    ext = ALLOWED_IMAGE_TYPES.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(400, "Only JPEG and PNG images can be published to Instagram")
    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Image is larger than 8 MB")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(body)

    base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return {"image_url": f"{base}/uploads/{name}", "filename": name}


@app.post("/api/publish")
def api_publish(payload: dict):
    """Create a media container, wait for it to finish processing, then publish it."""
    image_url = (payload.get("image_url") or "").strip()
    caption = payload.get("caption", "")
    if not image_url:
        raise HTTPException(400, "image_url is required")
    if not image_url.startswith(("http://", "https://")):
        raise HTTPException(400, "image_url must be a public http(s) URL")

    try:
        container = ig.create_media_container(image_url=image_url, caption=caption)
        creation_id = container.get("id")
        if not creation_id:
            raise ig.InstagramAPIError("Instagram did not return a media container id")

        # Instagram processes the image asynchronously; wait for FINISHED.
        for _ in range(15):
            status = ig.get_container_status(creation_id)
            code = status.get("status_code")
            if code == "FINISHED":
                break
            if code in ("ERROR", "EXPIRED"):
                raise ig.InstagramAPIError(
                    "Instagram could not process this image "
                    f"({status.get('status', code)})"
                )
            time.sleep(2)

        result = ig.publish_media(creation_id)
        log_activity("publish_post", f"media_id={result.get('id')} caption={caption[:120]}")
        return {"status": "published", "media_id": result.get("id")}
    except ig.InstagramAPIError as e:
        log_activity("publish_post", str(e), status="failed")
        raise HTTPException(500, str(e))


@app.get("/api/publish/limit")
def api_publish_limit():
    try:
        return ig.get_publishing_limit()
    except ig.NotConnectedError:
        raise
    except ig.InstagramAPIError as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Webhook: this is what makes auto-reply real-time.
# Point your Meta App's webhook URL to: https://your-domain.com/webhook
# ---------------------------------------------------------------------------

@app.get("/webhook")
def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return PlainTextResponse(hub_challenge)
    raise HTTPException(403, "Verification failed")


def _verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    if not APP_SECRET:
        return True  # skip check if no secret configured (dev mode)
    if not signature_header:
        return False
    expected = "sha256=" + hmac.new(APP_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


@app.post("/webhook")
async def receive_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not _verify_signature(raw_body, signature):
        raise HTTPException(403, "Invalid signature")

    payload = await request.json()
    log_activity("webhook_received", str(payload)[:500])

    account = get_account() or {}
    own_id = str(account.get("ig_user_id") or "")

    for entry in payload.get("entry", []):
        # --- Comments ---
        for change in entry.get("changes", []):
            if change.get("field") == "comments":
                value = change.get("value", {})
                # Skip comments written by this account (including our own auto-replies).
                if own_id and str(value.get("from", {}).get("id", "")) == own_id:
                    continue
                comment_id = value.get("id")
                comment_text = value.get("text", "")
                reply = find_matching_reply(comment_text, "comment_rules")
                if reply and comment_id:
                    context = {
                        "media_id": value.get("media", {}).get("id"),
                        "comment_id": comment_id,
                        "from_id": value.get("from", {}).get("id"),
                        "from_username": value.get("from", {}).get("username"),
                        "incoming_text": comment_text,
                    }
                    try:
                        ig.reply_to_comment(comment_id, reply)
                        log_activity("auto_comment_reply", f"comment_id={comment_id} reply={reply}")
                        log_reply("comment", "auto", reply, **context)
                    except Exception as e:
                        log_activity("auto_comment_reply", str(e), status="failed")
                        log_reply("comment", "auto", reply, status="failed", error=str(e), **context)

        # --- Direct Messages ---
        for messaging_event in entry.get("messaging", []):
            sender_id = messaging_event.get("sender", {}).get("id")
            message = messaging_event.get("message", {})
            # Our own outgoing replies come back as echoes - replying to them loops forever.
            if message.get("is_echo") or (own_id and str(sender_id) == own_id):
                continue
            text = message.get("text", "")
            reply = find_matching_reply(text, "dm_rules")
            if reply and sender_id:
                context = {"from_id": sender_id, "incoming_text": text}
                try:
                    ig.send_dm_reply(sender_id, reply)
                    log_activity("auto_dm_reply", f"sender_id={sender_id} reply={reply}")
                    log_reply("dm", "auto", reply, **context)
                except Exception as e:
                    log_activity("auto_dm_reply", str(e), status="failed")
                    log_reply("dm", "auto", reply, status="failed", error=str(e), **context)

    return JSONResponse({"status": "ok"})


# ---------------------------------------------------------------------------
# Serve the dashboard frontend
# ---------------------------------------------------------------------------
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# The review guide and API docs live in backend/static regardless of which UI is served.
def _static_page(name: str):
    def serve():
        return FileResponse(os.path.join(STATIC_DIR, name))
    return serve


for _page in ("app-review-guide.html", "api-docs.html"):
    app.add_api_route(f"/{_page}", _static_page(_page), include_in_schema=False)

# Prefer the built React app; fall back to the single-file dashboard.
UI_DIR = FRONTEND_DIST if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")) else STATIC_DIR
app.mount("/", StaticFiles(directory=UI_DIR, html=True), name="ui")
