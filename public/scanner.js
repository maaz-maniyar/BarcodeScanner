// ==========================================================
//  scanner.js — FINAL ZXing WASM VERSION (no Quagga, no bugs)
// ==========================================================

import { products } from "./products.js";

const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const consoleEl = document.getElementById("console");
const btnRetry = document.getElementById("btn-retry");
const btnSwitch = document.getElementById("btn-switch");
const btnSnap = document.getElementById("btn-snap");
const btnUpload = document.getElementById("btn-upload");
const uploadInput = document.getElementById("upload");
const itemsBox = document.getElementById("items");
const itemsList = document.getElementById("items-list");

const PI_URL = "https://hypogeal-flynn-clamorous.ngrok-free.dev";

let currentDeviceId = null;
let ZXReader = null;
let activeStream = null;

// ------------------------------------------------------------
// Logging helper
// ------------------------------------------------------------
function log(...msg) {
    console.log(...msg);
    consoleEl.textContent += msg.join(" ") + "\n";
}

// ------------------------------------------------------------
// Load ZXing WASM
// ------------------------------------------------------------
async function loadZXing() {
    if (ZXReader) return ZXReader;

    log("Loading ZXing…");

    await import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.js");

    ZXReader = new ZXingBrowser.BrowserMultiFormatReader();

    log("ZXing loaded.");
    return ZXReader;
}

// ------------------------------------------------------------
// Attach a MediaStream to the <video>
// ------------------------------------------------------------
async function attachStream(stream) {
    activeStream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
}

// ------------------------------------------------------------
// Scan one frame using ZXing
// ------------------------------------------------------------
async function tryDecodeFrame() {
    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);

    try {
        const result = await ZXReader.decodeFromCanvas(canvas);
        return result?.text || null;
    } catch (e) {
        return null;
    }
}

// ------------------------------------------------------------
// Loop decode
// ------------------------------------------------------------
async function scanLoop() {
    while (true) {
        const code = await tryDecodeFrame();
        if (code) {
            log("Detected:", code);
            await handleDetected(code);
            return;
        }
        await new Promise((r) => setTimeout(r, 150));
    }
}

// ------------------------------------------------------------
// Handle found barcode → lookup product → send to Pi
// ------------------------------------------------------------
async function handleDetected(code) {
    const item = products[code] || { name: code, price: 0 };

    itemsBox.style.display = "block";
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<div>${item.name}</div><div>₹${item.price}</div>`;
    itemsList.prepend(div);

    statusEl.textContent = `Detected ${item.name}`;

    try {
        const res = await fetch(`${PI_URL}/add_item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
        });
        log("Sent to Pi:", await res.text());
    } catch (e) {
        log("Pi add_item error:", e);
    }
}

// ------------------------------------------------------------
// Start the camera
// ------------------------------------------------------------
async function startCamera() {
    statusEl.textContent = "Starting camera…";

    if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
    }

    const constraints = {
        video: {
            facingMode: currentDeviceId ? undefined : "environment",
            deviceId: currentDeviceId || undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
        },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    await attachStream(stream);

    statusEl.textContent = "Scanning…";

    await loadZXing();
    scanLoop();
}

// ------------------------------------------------------------
// Switch camera
// ------------------------------------------------------------
btnSwitch.addEventListener("click", async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    if (!cams.length) return;

    let idx = cams.findIndex((c) => c.deviceId === currentDeviceId);
    idx = (idx + 1) % cams.length;

    currentDeviceId = cams[idx].deviceId;
    startCamera();
});

// Retry
btnRetry.addEventListener("click", startCamera);

// ------------------------------------------------------------
// Snapshot → Pi
// ------------------------------------------------------------
btnSnap.addEventListener("click", async () => {
    if (video.readyState < 2) return alert("Camera not ready");

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    await sendToPiImage(canvas.toDataURL("image/png"));
});

// ------------------------------------------------------------
// Upload photo → decode → Pi
// ------------------------------------------------------------
btnUpload.addEventListener("click", () => uploadInput.click());

uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);

    await sendToPiImage(canvas.toDataURL("image/png"));
});

// ------------------------------------------------------------
// Send uploaded/snapshot image to Pi
// ------------------------------------------------------------
async function sendToPiImage(dataUri) {
    try {
        const res = await fetch(`${PI_URL}/decode_image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: dataUri }),
        });
        const j = await res.json();
        log("Pi decode_image:", j);

        if (j?.added) {
            const { name, price } = j.added;
            showScan(name, price, true);
            alert(`Added: ${name} (${price})`);
        }
    } catch (e) {
        log("sendToPiImage error:", e);
    }
}

// ------------------------------------------------------------
// Show added item (for upload/snapshot)
// ------------------------------------------------------------
function showScan(name, price) {
    itemsBox.style.display = "block";
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<div>${name}</div><div>₹${price}</div>`;
    itemsList.prepend(div);
}

// ------------------------------------------------------------
// Auto-start
// ------------------------------------------------------------
window.addEventListener("load", startCamera);
