// scanner.js — FINAL VERSION (NO MISTAKES)

import { products } from './products.js';

const video = document.getElementById('video');
const status = document.getElementById('status');
const consoleEl = document.getElementById('console');
const btnRetry = document.getElementById('btn-retry');
const btnSwitch = document.getElementById('btn-switch');
const btnSnap = document.getElementById('btn-snap');
const btnUpload = document.getElementById('btn-upload');
const uploadInput = document.getElementById('upload');
const itemsBox = document.getElementById('items');
const itemsList = document.getElementById('items-list');

const PI_URL = 'https://hypogeal-flynn-clamorous.ngrok-free.dev';

// ---------------------------------------------------

function log(...a) {
    console.log(...a);
    consoleEl.textContent += a.join(" ") + "\n";
}

// ---------------------------------------------------
// Show scanned items
// ---------------------------------------------------
function showScan(name, price) {
    itemsBox.style.display = 'block';
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div>${name}</div><div>₹${price}</div>`;
    itemsList.prepend(div);
}

// ---------------------------------------------------
// POST to Pi: /add_item or /decode_image
// ---------------------------------------------------
async function postAddItem(name, price) {
    try {
        const res = await fetch(`${PI_URL}/add_item`, {
            method: "POST",
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({name,price})
        });
        log("POST add_item ok", await res.text());
    } catch (e) {
        log("POST add_item failed", e);
    }
}

async function sendToPiImage(dataUri) {
    try {
        const res = await fetch(`${PI_URL}/decode_image`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({image: dataUri})
        });
        const j = await res.json();
        log("decode_image response", j);

        if (j?.added) {
            showScan(j.added.name, j.added.price);
            alert(`Added: ${j.added.name} (₹${j.added.price})`);
        } else {
            alert("No barcode detected");
        }

    } catch (e) {
        log("sendToPiImage error", e);
    }
}

// ---------------------------------------------------
// handle detected code (from Quagga)
// ---------------------------------------------------
async function handleDetected(code) {
    log("Detected:", code);

    const entry = products[code];
    if (entry) {
        showScan(entry.name, entry.price);
        await postAddItem(entry.name, entry.price);
    } else {
        showScan(code, 0);
        await postAddItem(code, 0);
    }

    status.textContent = `Detected ${code}`;
}

// ---------------------------------------------------
// Load Quagga
// ---------------------------------------------------
function loadQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) return resolve(window.Quagga);

        const s = document.createElement('script');
        s.src = "https://unpkg.com/quagga@0.12.1/dist/quagga.min.js";
        s.onload = () => resolve(window.Quagga);
        s.onerror = () => reject(new Error("Quagga load failed"));
        document.head.appendChild(s);
    });
}

let currentDeviceId = null;

// ---------------------------------------------------
// Start live scan
// ---------------------------------------------------
async function startScanner() {
    status.textContent = "Starting camera…";

    await loadQuagga();
    const Quagga = window.Quagga;

    try { Quagga.stop(); } catch(e) {}

    const config = {
        inputStream: {
            type: "LiveStream",
            constraints: {
                facingMode: currentDeviceId ? undefined : "environment",
                deviceId: currentDeviceId || undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            target: video
        },
        decoder: { readers: ["code_128_reader"] },
        locator: { patchSize: "medium", halfSample: false },
        locate: true
    };

    Quagga.init(config, err => {
        if (err) {
            log("Quagga init error:", err);
            status.textContent = "Quagga init error";
            return;
        }

        Quagga.start();
        status.textContent = "Scanning…";
        log("Quagga started");

        // 🔥 IMPORTANT FIX: FORCE ATTACH STREAM TO PAGE VIDEO
        setTimeout(() => {
            try {
                const qs = Quagga._inputStream?._stream;
                if (qs) {
                    video.srcObject = qs;
                    video.play();
                    log("Attached Quagga stream → #video");
                }
            } catch (e) {
                log("force-attach error", e);
            }
        }, 500);

        Quagga.onDetected(data => {
            const code = data?.codeResult?.code;
            if (code) handleDetected(code);
        });
    });
}

// ---------------------------------------------------
// Snapshot → Pi decode
// ---------------------------------------------------
async function sendSnapshotToPi() {
    if (video.readyState < 2) return alert("Camera not ready");

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    canvas.getContext('2d')
        .drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUri = canvas.toDataURL("image/png");
    sendToPiImage(dataUri);
}

// ---------------------------------------------------
// Upload → Pi decode
// ---------------------------------------------------
uploadInput.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    sendToPiImage(canvas.toDataURL("image/png"));
});

// ---------------------------------------------------
// Switch camera
// ---------------------------------------------------
btnSwitch.addEventListener("click", async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    if (!cams.length) return;

    let idx = cams.findIndex(c => c.deviceId === currentDeviceId);
    idx = (idx + 1) % cams.length;
    currentDeviceId = cams[idx].deviceId;

    startScanner();
});

// Retry
btnRetry.addEventListener("click", startScanner);

// Snapshot
btnSnap.addEventListener("click", sendSnapshotToPi);

// Upload
btnUpload.addEventListener("click", () => uploadInput.click());

// ---------------------------------------------------
// Auto start
// ---------------------------------------------------
window.addEventListener("load", startScanner);
