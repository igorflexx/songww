const STEPS_SEC = [1, 2, 4, 7, 11, 16];
const MAX_LIMIT = STEPS_SEC[STEPS_SEC.length - 1];
const TRACK_POINTS = [6, 5, 4, 3, 2, 1];
const ARTIST_POINTS = [4, 3, 2, 2, 1, 1];
const MAX_SUGGESTIONS = 6;
const MAX_ARTISTS = 20;

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch {} }
  if (!r.ok) {
    const detail = (data && (data.detail || data.message)) || text || r.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

const state = {
  source: null,
  current: null,
  preloaded: null,
  attempt: 0,
  guessedTrack: false,
  guessedArtist: false,
  score: 0,
  suggestionIndex: -1,
  selectedArtists: [],
  pendingMode: null,
  playedIds: [],
  session: 0,
};

const audio = $("audio");
let playingTimer = null;

function spawnFireflies() {
  const root = document.querySelector(".bg-fireflies");
  const N = 55;
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < N; i++) {
    const f = document.createElement("div");
    f.className = "firefly";
    f.style.left = rand(0, 100) + "vw";
    f.style.top = rand(0, 100) + "vh";
    const size = rand(2, 6);
    f.style.width = f.style.height = size + "px";
    f.style.setProperty("--dx1", rand(-120, 120) + "px");
    f.style.setProperty("--dy1", rand(-120, 120) + "px");
    f.style.setProperty("--dx2", rand(-120, 120) + "px");
    f.style.setProperty("--dy2", rand(-120, 120) + "px");
    f.style.setProperty("--dx3", rand(-120, 120) + "px");
    f.style.setProperty("--dy3", rand(-120, 120) + "px");
    f.style.setProperty("--dx4", rand(-120, 120) + "px");
    f.style.setProperty("--dy4", rand(-120, 120) + "px");
    f.style.setProperty("--drift-dur", rand(16, 32) + "s");
    f.style.setProperty("--drift-delay", -rand(0, 20) + "s");
    f.style.setProperty("--glow-dur", rand(2.8, 5.5) + "s");
    f.style.setProperty("--glow-delay", -rand(0, 5) + "s");
    f.style.setProperty("--blink-dur", rand(0.6, 1.4) + "s");
    f.style.setProperty("--blink-delay", -rand(0, 1) + "s");
    root.appendChild(f);
  }
}

const ALL_SCREENS = [
  "screen-welcome", "screen-about", "screen-modes",
  "screen-artists", "screen-genres",
  "screen-auth", "screen-pick", "screen-game",
];

function currentScreen() {
  return ALL_SCREENS.map($).find((el) => el && !el.classList.contains("hidden"));
}

function showScreen(id, opts = {}) {
  const current = currentScreen();
  const next = $(id);
  if (!next || current === next) return;

  const reveal = () => {
    for (const sid of ALL_SCREENS) {
      const el = $(sid);
      if (el) el.classList.toggle("hidden", sid !== id);
    }
    next.classList.remove("exiting", "dramatic-in");
    if (opts.dramatic) {
      requestAnimationFrame(() => next.classList.add("dramatic-in"));
    } else {
      next.style.animation = "none";
      requestAnimationFrame(() => { next.style.animation = ""; });
    }
  };

  if (current) {
    current.classList.add("exiting");
    setTimeout(() => {
      current.classList.remove("exiting");
      reveal();
    }, 260);
  } else {
    reveal();
  }
}

async function checkAuth() {
  try {
    const data = await api("/api/auth/status");
    if (data.authorized) {
      $("user-bar").classList.remove("hidden");
      $("user-login").textContent = data.login || "";
      return true;
    }
  } catch {}
  $("user-bar").classList.add("hidden");
  return false;
}

async function submitToken() {
  const token = $("tokenInput").value.trim();
  if (!token) return;
  const status = $("tokenStatus");
  status.style.color = "";
  status.textContent = "Проверяем токен...";
  try {
    const data = await api("/api/auth", { method: "POST", body: JSON.stringify({ token }) });
    $("user-bar").classList.remove("hidden");
    $("user-login").textContent = data.login || "";
    const pending = state.pendingMode;
    state.pendingMode = null;
    routeToMode(pending || "personal");
  } catch (e) {
    status.style.color = "var(--bad)";
    status.textContent = "Ошибка: " + e.message;
  }
}

async function doLogout() {
  stopPlayback();
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  $("user-bar").classList.add("hidden");
  $("score").classList.add("hidden");
  state.score = 0;
  showScreen("screen-welcome");
}

async function loadPlaylists() {
  const list = $("playlists");
  list.innerHTML = "<li>Загружаем...</li>";
  try {
    const data = await api("/api/playlists");
    list.innerHTML = "";
    for (const pl of data) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${pl.title}</span><span class="count">${pl.track_count || ""}</span>`;
      li.onclick = () => startGame({ kind: pl.kind });
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = `<li style="color:var(--bad)">Ошибка: ${e.message}</li>`;
  }
}

async function startGameFromLink() {
  const url = $("linkInput").value.trim();
  if (!url) return;
  const status = $("linkStatus");
  status.style.color = "";
  status.textContent = "Проверяем плейлист...";
  try {
    const info = await api(`/api/playlist-info?link=${encodeURIComponent(url)}`);
    status.textContent = `${info.title} · ${info.track_count} треков`;
    await startGame({ link: url });
  } catch (e) {
    status.style.color = "var(--bad)";
    status.textContent = "Ошибка: " + e.message;
  }
}

async function loadGenres() {
  const grid = $("genresGrid");
  grid.innerHTML = "";
  try {
    const genres = await api("/api/genres");
    for (const g of genres) {
      const btn = document.createElement("button");
      btn.className = "genre-card";
      btn.textContent = g.name;
      btn.onclick = () => startGame({ genre: g.id });
      grid.appendChild(btn);
    }
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--bad)">Ошибка: ${e.message}</div>`;
  }
}

let artistSearchTimer = null;
let artistSearchAbort = null;

function handleArtistSearchInput(q) {
  clearTimeout(artistSearchTimer);
  q = q.trim();
  if (q.length < 2) {
    $("artistResults").classList.add("hidden");
    return;
  }
  artistSearchTimer = setTimeout(() => doArtistSearch(q), 220);
}

async function doArtistSearch(q) {
  if (artistSearchAbort) artistSearchAbort.abort();
  artistSearchAbort = new AbortController();
  try {
    const r = await fetch(`/api/search-artists?q=${encodeURIComponent(q)}&limit=8`, {
      signal: artistSearchAbort.signal,
    });
    if (!r.ok) {
      const text = await r.text();
      let detail = text;
      try { detail = JSON.parse(text).detail || text; } catch {}
      renderArtistError(detail);
      return;
    }
    const items = await r.json();
    if (!items.length) renderArtistError("Ничего не нашлось");
    else renderArtistResults(items);
  } catch (e) {
    if (e.name !== "AbortError") renderArtistError(e.message);
  }
}

function renderArtistError(msg) {
  const ul = $("artistResults");
  ul.innerHTML = `<li style="color:var(--bad);justify-content:center">⚠ ${escapeHtml(msg)}</li>`;
  ul.classList.remove("hidden");
}

function renderArtistResults(items) {
  const ul = $("artistResults");
  if (!items.length) { ul.classList.add("hidden"); return; }
  ul.innerHTML = "";
  const selectedIds = new Set(state.selectedArtists.map((a) => a.id));
  for (const a of items) {
    const li = document.createElement("li");
    li.className = "artist-row";
    li.innerHTML = `
      ${a.cover ? `<img src="${a.cover}" alt="">` : `<div class="mode-icon" style="width:36px;height:36px;font-size:16px;flex-shrink:0">♫</div>`}
      <div>
        <div class="s-title">${escapeHtml(a.name)}</div>
        ${selectedIds.has(a.id) ? '<div class="s-artist">уже выбран</div>' : ""}
      </div>
    `;
    if (!selectedIds.has(a.id)) {
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        addArtist(a);
      });
    } else {
      li.style.opacity = "0.5";
    }
    ul.appendChild(li);
  }
  ul.classList.remove("hidden");
}

function addArtist(a) {
  if (state.selectedArtists.length >= MAX_ARTISTS) return;
  if (state.selectedArtists.some((x) => x.id === a.id)) return;
  state.selectedArtists.push(a);
  $("artistSearch").value = "";
  $("artistResults").classList.add("hidden");
  renderSelectedArtists();
}

function removeArtist(id) {
  state.selectedArtists = state.selectedArtists.filter((a) => a.id !== id);
  renderSelectedArtists();
}

function renderSelectedArtists() {
  const wrap = $("selectedArtists");
  wrap.innerHTML = "";
  for (const a of state.selectedArtists) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `
      ${a.cover ? `<img src="${a.cover}" alt="">` : `<span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center">♫</span>`}
      <span>${escapeHtml(a.name)}</span>
      <button class="chip-remove" data-id="${a.id}" title="Убрать">×</button>
    `;
    chip.querySelector(".chip-remove").onclick = () => removeArtist(a.id);
    wrap.appendChild(chip);
  }
  $("artistCount").textContent = String(state.selectedArtists.length);
  $("startArtists").disabled = state.selectedArtists.length === 0;
}

function startArtistGame() {
  if (!state.selectedArtists.length) return;
  startGame({ artistIds: state.selectedArtists.map((a) => a.id) });
}

async function startGame(source) {
  state.session += 1;
  state.source = source;
  state.score = 0;
  state.playedIds = [];
  state.preloaded = null;
  state.current = null;
  stopPlayback();
  updateScore();
  $("score").classList.remove("hidden");
  showScreen("screen-game", { dramatic: true });
  buildTicks();
  await nextRound();
}

function sourceParams(extra = {}) {
  const p = new URLSearchParams(extra);
  if (state.source.link) p.set("link", state.source.link);
  else if (state.source.kind !== undefined) p.set("playlist_kind", String(state.source.kind));
  else if (state.source.artistIds) p.set("artist_ids", state.source.artistIds.join(","));
  else if (state.source.genre) p.set("genre", state.source.genre);
  if (state.playedIds.length) p.set("exclude_ids", state.playedIds.join(","));
  return p.toString();
}

async function fetchRound() {
  return api(`/api/round?${sourceParams({ seed: String(Date.now()) })}`);
}

function loadAudio(trackInfo) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("error", onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Браузер не смог загрузить аудио")); };
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("loadeddata", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.src = trackInfo.preview_url;
    audio.load();
  });
}

async function nextRound() {
  state.attempt = 0;
  state.current = null;
  state.guessedTrack = false;
  state.guessedArtist = false;
  state.suggestionIndex = -1;
  $("attempts").innerHTML = "";
  $("result").classList.add("hidden");
  $("statusLine").innerHTML = "";
  $("guess").value = "";
  $("guess").disabled = false;
  $("submit").disabled = false;
  $("skip").disabled = false;
  $("play").disabled = true;
  $("play").textContent = "Загружаем...";
  hideSuggestions();
  updateBar(0);
  updateStepBadge();

  const mySession = state.session;
  try {
    const info = state.preloaded || await fetchRound();
    if (mySession !== state.session) return;
    state.preloaded = null;
    await loadAudio(info);
    if (mySession !== state.session) return;
    state.current = info;
    if (info.wrapped) {
      state.playedIds = [];
      setStatus("Все треки сыграны — пошёл новый круг!", "warn");
    }
    if (info.id) state.playedIds.push(String(info.id));
    $("play").disabled = false;
    updatePlayButton();
    fetchRound().then((next) => {
      if (mySession === state.session) state.preloaded = next;
    }).catch(() => {});
  } catch (e) {
    $("play").textContent = "▶ Слушать";
    $("play").disabled = false;
    setStatus("Не удалось загрузить трек: " + e.message, "bad");
  }
}

function buildTicks() {
  const ticks = $("barTicks");
  ticks.innerHTML = "";
  for (const sec of STEPS_SEC) {
    const t = document.createElement("div");
    t.className = "tick";
    t.style.left = (sec / MAX_LIMIT * 100) + "%";
    t.dataset.sec = String(sec);
    ticks.appendChild(t);
  }
}

function currentLimitSec() {
  return STEPS_SEC[Math.min(state.attempt, STEPS_SEC.length - 1)];
}

function updateBar(playedSec) {
  const limit = currentLimitSec();
  const pct = Math.min(100, (playedSec / MAX_LIMIT) * 100);
  $("bar-fill").style.width = pct + "%";
  $("barUnlocked").style.width = (limit / MAX_LIMIT * 100) + "%";
  $("barCursor").style.left = pct + "%";
  $("bar-label").textContent = `${playedSec.toFixed(1)} / ${limit.toFixed(1)} с`;
  for (const t of $("barTicks").children) {
    const sec = parseFloat(t.dataset.sec);
    t.classList.toggle("passed", sec <= limit + 0.001);
  }
}

function updateStepBadge() {
  const badge = $("barStepBadge");
  const limit = currentLimitSec();
  badge.textContent = `${limit}с`;
  badge.style.left = (limit / MAX_LIMIT * 100) + "%";
}

function attachBarSeek() {
  const bar = $("bar");
  let dragging = false;
  const seekFromEvent = (e) => {
    if (!state.current) return;
    const rect = bar.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const target = Math.min(ratio * MAX_LIMIT, currentLimitSec());
    audio.currentTime = target;
    updateBar(target);
  };
  bar.addEventListener("mousedown", (e) => { dragging = true; seekFromEvent(e); });
  window.addEventListener("mousemove", (e) => { if (dragging) seekFromEvent(e); });
  window.addEventListener("mouseup", () => { dragging = false; });
  bar.addEventListener("touchstart", (e) => { dragging = true; seekFromEvent(e); }, { passive: true });
  bar.addEventListener("touchmove", (e) => { if (dragging) seekFromEvent(e); }, { passive: true });
  bar.addEventListener("touchend", () => { dragging = false; });
}

async function togglePlayback() {
  if (!state.current) return;
  if (!audio.paused) {
    audio.pause();
    clearInterval(playingTimer);
    playingTimer = null;
    document.body.classList.remove("playing");
    updatePlayButton();
    return;
  }
  const limit = currentLimitSec();
  if (audio.currentTime >= limit - 0.05) audio.currentTime = 0;
  try {
    await audio.play();
  } catch (e) {
    setStatus("Браузер заблокировал воспроизведение: " + e.message, "bad");
    return;
  }
  document.body.classList.add("playing");
  updatePlayButton();
  startPlaybackTimer();
}

function startPlaybackTimer() {
  clearInterval(playingTimer);
  playingTimer = setInterval(() => {
    const t = audio.currentTime;
    const limit = currentLimitSec();
    if (t >= limit || audio.ended) {
      audio.pause();
      clearInterval(playingTimer);
      playingTimer = null;
      document.body.classList.remove("playing");
      updateBar(Math.min(t, limit));
      updatePlayButton();
    } else {
      updateBar(t);
    }
  }, 50);
}

function updatePlayButton() {
  const btn = $("play");
  if (!audio.paused) {
    btn.textContent = "⏸ Пауза";
  } else if (audio.currentTime > 0.05 && audio.currentTime < currentLimitSec() - 0.05) {
    btn.textContent = "▶ Продолжить";
  } else {
    btn.textContent = "▶ Слушать";
  }
}

function stopPlayback() {
  clearInterval(playingTimer);
  playingTimer = null;
  try { audio.pause(); } catch {}
  document.body.classList.remove("playing");
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyContains(haystack, needle) {
  const h = norm(haystack), n = norm(needle);
  if (!n) return false;
  return h.includes(n) || n.includes(h);
}

function checkGuess(input) {
  const t = state.current;
  return {
    titleMatch: fuzzyContains(t.title, input),
    artistMatch: t.artists.some((a) => fuzzyContains(a, input)),
  };
}

function updateScore(delta = 0) {
  if (delta) {
    state.score += delta;
    $("score").classList.add("pulse");
    setTimeout(() => $("score").classList.remove("pulse"), 500);
  }
  $("scoreValue").textContent = String(state.score);
}

function awardForCurrentRound(titleMatch, artistMatch) {
  let earned = 0;
  const tPoints = TRACK_POINTS[Math.min(state.attempt, TRACK_POINTS.length - 1)];
  const aPoints = ARTIST_POINTS[Math.min(state.attempt, ARTIST_POINTS.length - 1)];
  const parts = [];
  if (titleMatch && !state.guessedTrack) {
    state.guessedTrack = true;
    earned += tPoints;
    parts.push(`название +${tPoints}`);
  }
  if (artistMatch && !state.guessedArtist) {
    state.guessedArtist = true;
    earned += aPoints;
    parts.push(`исполнитель +${aPoints}`);
  }
  return { earned, parts };
}

function setStatus(text, cls = "") {
  $("statusLine").innerHTML = text ? `<span class="${cls}">${text}</span>` : "";
}

function recordAttempt(text, cls) {
  const li = document.createElement("li");
  li.className = cls;
  li.textContent = text;
  $("attempts").appendChild(li);
}

function revealAnswer(reason) {
  $("guess").disabled = true;
  $("submit").disabled = true;
  $("skip").disabled = true;
  $("cover").src = state.current.cover_url || "";
  const prefix = reason === "win" ? "✓ " : reason === "give-up" ? "— " : "✗ ";
  $("answer-title").textContent = prefix + state.current.title;
  $("answer-artists").textContent = state.current.artists.join(", ");
  const got = (state.guessedTrack ? 1 : 0) + (state.guessedArtist ? 1 : 0);
  $("round-score").textContent = got > 0
    ? `угадано: ${state.guessedTrack ? "название" : ""}${state.guessedTrack && state.guessedArtist ? " + " : ""}${state.guessedArtist ? "исполнитель" : ""}`
    : "ничего не угадано";
  $("result").classList.remove("hidden");
  hideSuggestions();
}

function onSubmit() {
  const value = $("guess").value.trim();
  if (!value || !state.current) return;
  hideSuggestions();
  const { titleMatch, artistMatch } = checkGuess(value);
  const { earned, parts } = awardForCurrentRound(titleMatch, artistMatch);
  if (earned > 0) updateScore(earned);
  const cls = state.guessedTrack && state.guessedArtist ? "right"
    : earned > 0 ? "partial" : "wrong";
  const mark = cls === "right" ? "✓" : cls === "partial" ? "◐" : "✗";
  const suffix = parts.length ? `  (${parts.join(", ")})` : "";
  recordAttempt(`${mark} ${value}${suffix}`, cls);
  $("guess").value = "";

  if (state.guessedTrack && state.guessedArtist) {
    setStatus("Угадано полностью!", "ok");
    revealAnswer("win");
    return;
  }
  if (earned > 0) {
    setStatus(`+${earned} очков. Осталось угадать ${state.guessedTrack ? "исполнителя" : "название"}.`, "warn");
  } else {
    setStatus("Мимо.", "bad");
  }
  advance();
}

function onSkip() {
  recordAttempt("— пропуск", "skip");
  advance();
}

function advance() {
  state.attempt += 1;
  if (state.attempt >= STEPS_SEC.length) {
    revealAnswer(state.guessedTrack || state.guessedArtist ? "partial" : "give-up");
    return;
  }
  updateStepBadge();
  if (audio.paused) {
    audio.currentTime = 0;
    updateBar(0);
    updatePlayButton();
  } else {
    updateBar(audio.currentTime);
  }
}

let searchTimer = null;
let searchAbort = null;
let searchSeq = 0;

function renderSuggestions(query) {
  clearTimeout(searchTimer);
  const q = query.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  searchTimer = setTimeout(() => doSearch(q), 220);
}

async function doSearch(q) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const mySeq = ++searchSeq;
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS}`, { signal: searchAbort.signal });
    if (!r.ok) { hideSuggestions(); return; }
    const items = await r.json();
    if (mySeq !== searchSeq) return;
    showSuggestions(items, q);
  } catch (e) {
    if (e.name !== "AbortError") hideSuggestions();
  }
}

function showSuggestions(items, query) {
  const ul = $("suggestions");
  if (!items || !items.length) { hideSuggestions(); return; }
  ul.innerHTML = "";
  items.forEach((t, idx) => {
    const li = document.createElement("li");
    if (idx === 0) li.classList.add("active");
    li.innerHTML = `
      <span class="s-title">${highlight(t.title, query)}</span>
      <span class="s-artist">${highlight((t.artists || []).join(", "), query)}</span>
    `;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      $("guess").value = `${(t.artists || []).join(", ")} - ${t.title}`;
      hideSuggestions();
      onSubmit();
    });
    ul.appendChild(li);
  });
  state.suggestionIndex = 0;
  ul.classList.remove("hidden");
}

function highlight(text, query) {
  const q = norm(query);
  if (!q) return escapeHtml(text);
  const nText = norm(text);
  const idx = nText.indexOf(q);
  if (idx < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + "<mark>" + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>" + escapeHtml(text.slice(idx + q.length));
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function hideSuggestions() {
  $("suggestions").classList.add("hidden");
  state.suggestionIndex = -1;
}

function moveSuggestion(dir) {
  const ul = $("suggestions");
  const items = ul.querySelectorAll("li");
  if (!items.length) return;
  state.suggestionIndex = (state.suggestionIndex + dir + items.length) % items.length;
  items.forEach((li, i) => li.classList.toggle("active", i === state.suggestionIndex));
}

function acceptActiveSuggestion() {
  const li = $("suggestions").querySelector("li.active");
  if (!li) return false;
  li.dispatchEvent(new MouseEvent("mousedown"));
  return true;
}

async function pickMode(mode) {
  let status = { authorized: false, server_ready: false };
  try { status = await api("/api/auth/status"); } catch {}
  const canPlay = mode === "personal" ? status.authorized : (status.server_ready || status.authorized);
  if (status.authorized) {
    $("user-bar").classList.remove("hidden");
    $("user-login").textContent = status.login || "";
  }
  if (!canPlay) {
    state.pendingMode = mode;
    const hint = mode === "personal"
      ? "Для своих плейлистов нужен личный токен. Войди — после этого появится список плейлистов."
      : "Для этого режима нужен токен. Войди — после этого откроется выбор " + (mode === "artists" ? "исполнителей." : "жанра.");
    $("authHint").textContent = hint + " Хранится только в памяти процесса.";
    showScreen("screen-auth");
    return;
  }
  routeToMode(mode);
}

async function routeToMode(mode) {
  if (mode === "artists") {
    state.selectedArtists = [];
    renderSelectedArtists();
    $("artistSearch").value = "";
    $("artistResults").classList.add("hidden");
    showScreen("screen-artists");
  } else if (mode === "genre") {
    await loadGenres();
    showScreen("screen-genres");
  } else {
    showScreen("screen-pick");
  }
}

spawnFireflies();
buildTicks();
attachBarSeek();
checkAuth();

$("brand").onclick = () => { stopPlayback(); showScreen("screen-welcome"); };
$("goPlay").onclick = () => showScreen("screen-modes");
$("goAbout").onclick = () => showScreen("screen-about");
$("backFromAbout").onclick = () => showScreen("screen-welcome");
$("backFromModes").onclick = () => showScreen("screen-welcome");
$("backFromArtists").onclick = () => showScreen("screen-modes");
$("backFromGenres").onclick = () => showScreen("screen-modes");
$("backFromAuth").onclick = () => showScreen("screen-modes");
$("backFromPick").onclick = () => showScreen("screen-modes");
$("backToModes").onclick = () => { stopPlayback(); showScreen("screen-modes"); };

document.querySelectorAll(".mode-card").forEach((c) => {
  c.onclick = () => pickMode(c.dataset.mode);
});

$("tokenSubmit").onclick = submitToken;
$("tokenInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitToken(); });
$("logout").onclick = doLogout;

$("loadPlaylists").onclick = loadPlaylists;
$("playFromLink").onclick = startGameFromLink;

$("artistSearch").addEventListener("input", (e) => handleArtistSearchInput(e.target.value));
$("artistSearch").addEventListener("blur", () => setTimeout(() => $("artistResults").classList.add("hidden"), 150));
$("startArtists").onclick = startArtistGame;

$("play").onclick = togglePlayback;
$("submit").onclick = onSubmit;
$("skip").onclick = onSkip;
$("next").onclick = nextRound;

$("guess").addEventListener("input", (e) => renderSuggestions(e.target.value));
$("guess").addEventListener("focus", (e) => { if (e.target.value) renderSuggestions(e.target.value); });
$("guess").addEventListener("blur", () => setTimeout(hideSuggestions, 120));
$("guess").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
  else if (e.key === "Escape") { hideSuggestions(); }
  else if (e.key === "Enter") {
    if (state.suggestionIndex >= 0 && acceptActiveSuggestion()) e.preventDefault();
    else onSubmit();
  }
});

showScreen("screen-welcome");
