from __future__ import annotations

import os
import random
import re
import secrets
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from yandex_music import Client

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
REQUEST_TIMEOUT = 30

app = FastAPI(title="igorprojects")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled_exc(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


_tracks_cache: dict[str, list] = {}
_server_client: Optional[Client] = None
_user_sessions: dict[str, dict] = {}
SESSION_COOKIE = "uip_sid"
SESSION_TTL_SEC = 60 * 60 * 24 * 7


def _init_client(token: str) -> Client:
    client = Client(token).init()
    client.request.set_timeout(REQUEST_TIMEOUT)
    return client


def _ensure_server_client() -> Optional[Client]:
    global _server_client
    if _server_client is not None:
        return _server_client
    token = os.getenv("YANDEX_MUSIC_TOKEN", "").strip()
    if not token or token == "your_token_here":
        return None
    try:
        _server_client = _init_client(token)
    except Exception:
        _server_client = None
    return _server_client


def _get_session_id(request: Request) -> Optional[str]:
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        return None
    sess = _user_sessions.get(sid)
    if not sess:
        return None
    if time.time() - sess["ts"] > SESSION_TTL_SEC:
        _user_sessions.pop(sid, None)
        return None
    sess["ts"] = time.time()
    return sid


def _get_user_client(request: Request) -> Optional[Client]:
    sid = _get_session_id(request)
    if not sid:
        return None
    return _user_sessions[sid]["client"]


def get_client(request: Request, needs_personal: bool = False) -> Client:
    if needs_personal:
        c = _get_user_client(request)
        if c is not None:
            return c
        raise HTTPException(401, "Нужен личный токен — войди для доступа к своим плейлистам.")
    server = _ensure_server_client()
    if server is not None:
        return server
    c = _get_user_client(request)
    if c is not None:
        return c
    raise HTTPException(503, "Демо-режимы не настроены. Войди со своим токеном.")


class AuthPayload(BaseModel):
    token: str


class TrackInfo(BaseModel):
    id: str
    title: str
    artists: list[str]
    cover_url: Optional[str]
    preview_url: Optional[str]
    duration_ms: int


class PlaylistInfo(BaseModel):
    kind: int
    title: str
    track_count: int
    owner: str


@app.post("/api/auth")
def set_token(payload: AuthPayload, request: Request, response: Response):
    token = payload.token.strip()
    if not token:
        raise HTTPException(400, "Пустой токен")
    try:
        client = _init_client(token)
    except Exception as e:
        raise HTTPException(401, f"Токен не принят: {e}")
    old_sid = request.cookies.get(SESSION_COOKIE)
    if old_sid:
        _user_sessions.pop(old_sid, None)
    sid = secrets.token_urlsafe(32)
    _user_sessions[sid] = {"client": client, "ts": time.time()}
    response.set_cookie(
        SESSION_COOKIE, sid,
        max_age=SESSION_TTL_SEC,
        httponly=True,
        samesite="lax",
        secure=False,
    )
    return {"login": client.me.account.login, "uid": client.me.account.uid}


@app.get("/api/auth/status")
def auth_status(request: Request):
    server_ready = _ensure_server_client() is not None
    c = _get_user_client(request)
    if c is None:
        return {"authorized": False, "server_ready": server_ready}
    return {"authorized": True, "login": c.me.account.login, "server_ready": server_ready}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    sid = request.cookies.get(SESSION_COOKIE)
    uid = None
    if sid and sid in _user_sessions:
        try:
            uid = _user_sessions[sid]["client"].me.account.uid
        except Exception:
            pass
        _user_sessions.pop(sid, None)
    response.delete_cookie(SESSION_COOKIE)
    if uid is not None:
        for k in list(_tracks_cache.keys()):
            if k == f"liked:{uid}" or k.startswith(f"kind:{uid}:"):
                _tracks_cache.pop(k, None)
    return {"ok": True}


@app.post("/api/reset")
def reset_cache():
    _tracks_cache.clear()
    return {"ok": True}


def _track_to_info(track) -> Optional[TrackInfo]:
    if not track or not track.available:
        return None
    try:
        dl_info = track.get_download_info(get_direct_links=True)
    except Exception:
        return None
    if not dl_info:
        return None
    mp3 = next((d for d in dl_info if d.codec == "mp3"), dl_info[0])
    cover = track.cover_uri.replace("%%", "400x400") if track.cover_uri else None
    return TrackInfo(
        id=str(track.id),
        title=track.title,
        artists=[a.name for a in (track.artists or [])],
        cover_url=f"https://{cover}" if cover else None,
        preview_url=mp3.direct_link,
        duration_ms=track.duration_ms or 0,
    )


_OLD_LINK_RE = re.compile(r"music\.yandex\.[a-z.]+/users/([^/?#]+)/playlists/(\d+)")
_NEW_LINK_RE = re.compile(r"music\.yandex\.[a-z.]+/playlists/(lk\.[0-9a-fA-F-]+|[0-9a-fA-F-]{8,})")


def _load_tracks_from_link(client: Client, url: str):
    m_old = _OLD_LINK_RE.search(url)
    if m_old:
        owner, kind = m_old.group(1), int(m_old.group(2))
        pl = client.users_playlists(kind, owner)
        if not pl:
            raise HTTPException(404, "Плейлист не найден")
        full = pl.fetch_tracks()
        return [t.track for t in full if t.track], pl.title

    m_new = _NEW_LINK_RE.search(url)
    if m_new:
        raw_id = m_new.group(1)
        candidates = [raw_id, raw_id[3:] if raw_id.startswith("lk.") else f"lk.{raw_id}"]
        resp = None
        last_err = None
        for cid in candidates:
            try:
                resp = client.request.get(f"{client.base_url}/playlist/{cid}")
                if isinstance(resp, dict):
                    break
            except Exception as e:
                last_err = e
                resp = None
        if not isinstance(resp, dict):
            raise HTTPException(502, f"Не удалось получить плейлист: {last_err}")
        owner = (resp.get("owner") or {}).get("uid")
        kind = resp.get("kind")
        title = resp.get("title") or "Плейлист по ссылке"
        if not owner or kind is None:
            raise HTTPException(502, "В ответе API нет owner.uid или kind")
        pl = client.users_playlists(int(kind), int(owner))
        if not pl:
            raise HTTPException(404, "Плейлист есть, но не отдаётся")
        full = pl.fetch_tracks()
        return [t.track for t in full if t.track], title

    raise HTTPException(400, "Не распознал ссылку плейлиста")


GENRES = [
    {"id": "pop",        "name": "Поп",          "query": "поп хиты"},
    {"id": "rock",       "name": "Рок",          "query": "рок"},
    {"id": "hiphop",     "name": "Хип-хоп",      "query": "хип хоп"},
    {"id": "rusrap",     "name": "Русский рэп",  "query": "русский рэп"},
    {"id": "electronic", "name": "Электроника",  "query": "электронная музыка"},
    {"id": "rnb",        "name": "R&B",          "query": "rnb"},
    {"id": "indie",      "name": "Инди",         "query": "indie"},
    {"id": "metal",      "name": "Метал",        "query": "metal"},
    {"id": "classical",  "name": "Классика",     "query": "классическая музыка"},
    {"id": "jazz",       "name": "Джаз",         "query": "jazz"},
    {"id": "lofi",       "name": "Lo-Fi",        "query": "lofi"},
    {"id": "phonk",      "name": "Phonk",        "query": "phonk"},
]
GENRES_BY_ID = {g["id"]: g for g in GENRES}


def _load_tracks_for_source(
    client: Client,
    playlist_kind: Optional[int] = None,
    link: Optional[str] = None,
    artist_ids: Optional[list[str]] = None,
    genre: Optional[str] = None,
):
    if artist_ids:
        cache_key = f"artists:{','.join(sorted(artist_ids))}"
    elif genre:
        cache_key = f"genre:{genre}"
    elif link:
        cache_key = f"link:{link}"
    elif playlist_kind == 3:
        cache_key = f"liked:{client.me.account.uid}"
    elif playlist_kind is not None:
        cache_key = f"kind:{client.me.account.uid}:{playlist_kind}"
    else:
        raise HTTPException(400, "Не указан источник треков")

    if cache_key in _tracks_cache:
        return cache_key, _tracks_cache[cache_key]

    if artist_ids:
        tracks = []
        seen = set()
        for aid in artist_ids[:20]:
            try:
                info = client.artists_brief_info(int(aid))
            except Exception:
                continue
            for t in (info.popular_tracks or []) if info else []:
                if t.id in seen or not t.available:
                    continue
                seen.add(t.id)
                tracks.append(t)
    elif genre:
        g = GENRES_BY_ID.get(genre)
        if not g:
            raise HTTPException(404, "Неизвестный жанр")
        tracks = []
        seen = set()
        for q in [g["query"], g["name"], f"{g['name']} популярное"]:
            try:
                result = client.search(q, type_="track")
            except Exception:
                continue
            for t in ((result.tracks.results if result and result.tracks else []) or []):
                if t.id in seen or not t.available:
                    continue
                seen.add(t.id)
                tracks.append(t)
            if len(tracks) >= 60:
                break
    elif link:
        tracks, _title = _load_tracks_from_link(client, link)
    elif playlist_kind == 3:
        liked = client.users_likes_tracks()
        track_ids = [t.track_id for t in (liked.tracks if liked else [])]
        if not track_ids:
            raise HTTPException(404, "В 'Мне нравится' нет треков")
        tracks = []
        for i in range(0, min(len(track_ids), 500), 100):
            tracks.extend(client.tracks(track_ids[i : i + 100]) or [])
    else:
        user_id = client.me.account.uid
        pl = client.users_playlists(playlist_kind, user_id)
        if not pl:
            raise HTTPException(404, "Плейлист не найден")
        full = pl.fetch_tracks()
        tracks = [t.track for t in full if t.track]

    tracks = [t for t in tracks if t and t.available]
    if not tracks:
        raise HTTPException(404, "Нет доступных треков для этого источника")
    _tracks_cache[cache_key] = tracks
    return cache_key, tracks


@app.get("/api/playlists", response_model=list[PlaylistInfo])
def list_playlists(request: Request):
    client = get_client(request, needs_personal=True)
    user_id = client.me.account.uid
    items: list[PlaylistInfo] = [
        PlaylistInfo(kind=3, title="Мне нравится", track_count=0, owner=str(user_id))
    ]
    for pl in client.users_playlists_list(user_id) or []:
        items.append(PlaylistInfo(
            kind=pl.kind,
            title=pl.title,
            track_count=pl.track_count or 0,
            owner=str(user_id),
        ))
    return items


@app.get("/api/round")
def get_round(
    request: Request,
    playlist_kind: Optional[int] = Query(None),
    link: Optional[str] = Query(None),
    artist_ids: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    exclude_ids: Optional[str] = Query(None),
    seed: Optional[int] = Query(None),
):
    sources = [playlist_kind is not None, link is not None, bool(artist_ids), bool(genre)]
    if sum(sources) != 1:
        raise HTTPException(400, "Укажи ровно один источник: playlist_kind | link | artist_ids | genre")

    needs_personal = playlist_kind is not None
    client = get_client(request, needs_personal=needs_personal)
    aids = [s for s in (artist_ids or "").split(",") if s.strip()] or None
    _key, tracks = _load_tracks_for_source(client, playlist_kind, link, aids, genre)

    excluded = {s.strip() for s in (exclude_ids or "").split(",") if s.strip()}
    candidates = [t for t in tracks if str(t.id) not in excluded]
    wrapped = not candidates
    if wrapped:
        candidates = list(tracks)

    rng = random.Random(seed)
    rng.shuffle(candidates)
    for t in candidates[:5]:
        info = _track_to_info(t)
        if info:
            data = info.model_dump() if hasattr(info, "model_dump") else info.dict()
            if wrapped:
                data["wrapped"] = True
            return data
    raise HTTPException(503, "Не удалось получить ссылки на превью")


@app.get("/api/playlist-info")
def playlist_info_by_link(request: Request, link: str = Query(...)):
    client = get_client(request)
    tracks, title = _load_tracks_from_link(client, link)
    return {"title": title, "track_count": len(tracks)}


@app.get("/api/track-list")
def track_list(request: Request, playlist_kind: Optional[int] = Query(None), link: Optional[str] = Query(None)):
    if (playlist_kind is None) == (link is None):
        raise HTTPException(400, "Укажи playlist_kind или link")
    client = get_client(request)
    _key, tracks = _load_tracks_for_source(client, playlist_kind, link)
    return [{"title": t.title, "artists": [a.name for a in (t.artists or [])]} for t in tracks]


@app.get("/api/search")
def search_tracks(request: Request, q: str = Query(..., min_length=2), limit: int = 8):
    client = get_client(request)
    try:
        result = client.search(q.strip(), type_="track", nocorrect=False)
    except Exception as e:
        raise HTTPException(502, f"Поиск не удался: {e}")
    if not result or not result.tracks:
        return []
    return [
        {"title": t.title or "", "artists": [a.name for a in (t.artists or [])]}
        for t in (result.tracks.results or [])[:limit]
    ]


@app.get("/api/search-artists")
def search_artists(request: Request, q: str = Query(..., min_length=2), limit: int = 8):
    client = get_client(request)
    try:
        result = client.search(q.strip(), type_="artist", nocorrect=False)
    except Exception as e:
        raise HTTPException(502, f"Поиск не удался: {e}")
    if not result or not result.artists:
        return []
    items = []
    for a in (result.artists.results or [])[:limit]:
        cover = None
        if a.cover and a.cover.uri:
            cover = "https://" + a.cover.uri.replace("%%", "200x200")
        elif a.og_image:
            cover = "https://" + a.og_image.replace("%%", "200x200")
        items.append({"id": str(a.id), "name": a.name or "", "cover": cover})
    return items


@app.get("/api/genres")
def list_genres():
    return [{"id": g["id"], "name": g["name"]} for g in GENRES]


@app.get("/play", include_in_schema=False)
def serve_game():
    return FileResponse(FRONTEND / "game.html")


@app.get("/photo", include_in_schema=False)
def serve_photo():
    return FileResponse(FRONTEND / "photo.html")


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
