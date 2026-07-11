const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

const CHARS = "01<>{}[]()/=+-_:;|.,*#@$%abcdefghijklmnopqrstuvwxyz0123456789".split("");
const SNIPPETS = [
  "const greet = () =>",
  "import { life } from",
  "while (alive) {",
  "function dream() {",
  "return future;",
  "git push origin",
  "npm run build",
  "console.log('hi')",
  "404 not found",
  "200 OK",
  "ssh igor@server",
  "make me proud",
];
const FONT_SIZE = 14;

let cols;
let drops;

function initDrops() {
  cols = Math.floor(canvas.width / FONT_SIZE);
  drops = new Array(cols).fill(0).map(() => Math.random() * -50);
}
initDrops();
window.addEventListener("resize", initDrops);

function draw() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${FONT_SIZE}px "JetBrains Mono", monospace`;

  for (let i = 0; i < cols; i++) {
    const useSnippet = Math.random() < 0.005;
    const text = useSnippet
      ? SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)]
      : CHARS[Math.floor(Math.random() * CHARS.length)];

    const x = i * FONT_SIZE;
    const y = drops[i] * FONT_SIZE;

    ctx.fillStyle = drops[i] > 0 && Math.random() < 0.02
      ? "rgba(220, 220, 230, 0.85)"
      : "rgba(120, 120, 130, 0.55)";
    ctx.fillText(text, x, y);

    if (y > canvas.height && Math.random() > 0.965) drops[i] = 0;
    drops[i]++;
  }
}

setInterval(draw, 55);

const avatar = document.getElementById("avatar");
const profile = document.querySelector(".profile");
if (avatar) {
  avatar.addEventListener("load", () => {
    if (avatar.naturalWidth > 0) profile.classList.add("has-photo");
  });
}

const bgmusic = document.getElementById("bgmusic");
const bgmusicToggle = document.getElementById("bgmusic-toggle");

function setMuted(muted, persist = true) {
  bgmusic.muted = muted;
  bgmusicToggle.classList.toggle("muted", muted);
  bgmusicToggle.classList.toggle("unmuted", !muted);
  bgmusicToggle.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
  if (persist) localStorage.setItem("bgmusic-muted", muted ? "1" : "0");
}

if (bgmusic && bgmusicToggle) {
  bgmusic.volume = 0.4;
  setMuted(true, false);
  bgmusicToggle.addEventListener("click", async () => {
    if (bgmusic.paused) {
      try { await bgmusic.play(); } catch {}
      setMuted(false);
    } else {
      setMuted(!bgmusic.muted);
    }
  });
}
