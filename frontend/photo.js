const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const captureBtn = document.getElementById("capture");
const brightnessSlider = document.getElementById("brightnessSlider");
const brightnessVal = document.getElementById("brightnessVal");
const tempSlider = document.getElementById("tempSlider");
const tempVal = document.getElementById("tempVal");
const frame = document.getElementById("frame");

const tmp = document.createElement("canvas");
const tctx = tmp.getContext("2d");

let currentFilter = "none";
let currentTemp = 0;
let stream = null;
let lastFaces = [];
let lastDetect = 0;
let faceModelState = "idle";
const FACE_MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    if (currentFilter === "face") loadFaceModel();
  });
});

brightnessSlider.addEventListener("input", (e) => {
  frame.style.setProperty("--brightness", e.target.value);
  brightnessVal.textContent = e.target.value;
});

tempSlider.addEventListener("input", (e) => {
  currentTemp = Number(e.target.value);
  tempVal.textContent = currentTemp > 0 ? `+${currentTemp}` : String(currentTemp);
});

function tempFilter(t) {
  if (!t) return "";
  if (t > 0) {
    const sepia = (t / 100) * 0.35;
    const hue = -(t / 100) * 16;
    const sat = 1 + t / 350;
    return `sepia(${sepia.toFixed(2)}) hue-rotate(${hue.toFixed(1)}deg) saturate(${sat.toFixed(2)})`;
  } else {
    const u = -t;
    const hue = (u / 100) * 24;
    const sat = 1 - u / 400;
    const bri = 1 - u / 700;
    return `hue-rotate(${hue.toFixed(1)}deg) saturate(${sat.toFixed(2)}) brightness(${bri.toFixed(2)})`;
  }
}

async function loadFaceModel() {
  if (faceModelState !== "idle") return;
  if (typeof faceapi === "undefined") {
    setTimeout(loadFaceModel, 200);
    return;
  }
  faceModelState = "loading";
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    faceModelState = "ready";
  } catch (e) {
    faceModelState = "failed";
    console.error("face model load failed", e);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Браузер не поддерживает доступ к камере");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    status.classList.add("hidden");
    requestAnimationFrame(render);
  } catch (e) {
    showError("Камера недоступна: " + e.message);
  }
}

function showError(msg) {
  status.classList.remove("hidden");
  status.classList.add("error");
  status.textContent = msg;
}

function renderNormal() {
  ctx.imageSmoothingEnabled = true;
  ctx.filter = tempFilter(currentTemp) || "none";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
}

function renderShakal() {
  const w = 96;
  const h = Math.round((canvas.height / canvas.width) * w);
  tmp.width = w;
  tmp.height = h;
  tctx.imageSmoothingEnabled = true;
  const tf = tempFilter(currentTemp);
  tctx.filter = `contrast(1.25) saturate(0.55) brightness(1.05) hue-rotate(-4deg)${tf ? " " + tf : ""}`;
  tctx.drawImage(video, 0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.filter = "none";
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      2 + Math.random() * 3,
      2 + Math.random() * 3,
    );
  }
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 2, 2);
  }
}

async function renderFace(now) {
  ctx.imageSmoothingEnabled = true;
  ctx.filter = tempFilter(currentTemp) || "none";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";

  if (faceModelState === "failed" || typeof faceapi === "undefined") {
    drawHint("не получилось загрузить модель — проверь интернет");
    return;
  }
  if (faceModelState !== "ready") {
    drawHint("загружаем модель...");
    return;
  }

  if (now - lastDetect > 200) {
    lastDetect = now;
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 });
      const detections = await faceapi.detectAllFaces(canvas, opts);
      lastFaces = detections.map((d) => ({
        x: d.box.x,
        y: d.box.y,
        width: d.box.width,
        height: d.box.height,
        score: d.score,
      }));
    } catch (e) {
      console.error(e);
    }
  }

  if (!lastFaces.length) {
    drawHint("ищу лицо...");
    return;
  }

  ctx.lineWidth = Math.max(3, canvas.width / 320);
  ctx.strokeStyle = "#ff1744";
  ctx.fillStyle = "#ff1744";
  ctx.font = `bold ${Math.max(14, canvas.width / 60)}px "JetBrains Mono", monospace`;
  ctx.shadowColor = "rgba(255,23,68,0.75)";
  ctx.shadowBlur = 10;

  for (const b of lastFaces) {
    ctx.strokeRect(b.x, b.y, b.width, b.height);
    const text = `x:${b.x.toFixed(0)} y:${b.y.toFixed(0)} w:${b.width.toFixed(0)} h:${b.height.toFixed(0)}`;
    const ty = b.y > 28 ? b.y - 10 : b.y + b.height + 22;
    ctx.fillText(text, b.x, ty);
  }
  ctx.shadowBlur = 0;
}

function drawHint(text) {
  ctx.font = `bold 16px "JetBrains Mono", monospace`;
  ctx.fillStyle = "#ff1744";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 8;
  ctx.fillText(text, 16, canvas.height - 18);
  ctx.shadowBlur = 0;
}

async function render(now) {
  if (currentFilter === "shakal") renderShakal();
  else if (currentFilter === "face") await renderFace(now);
  else renderNormal();
  requestAnimationFrame(render);
}

const flashOverlay = document.createElement("div");
flashOverlay.className = "capture-flash-overlay";
document.body.appendChild(flashOverlay);

captureBtn.addEventListener("click", () => {
  flashOverlay.classList.add("active");
  captureBtn.classList.add("flash");
  setTimeout(() => flashOverlay.classList.remove("active"), 140);
  setTimeout(() => captureBtn.classList.remove("flash"), 400);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `photo-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

startCamera();
