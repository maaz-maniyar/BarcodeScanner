import { products } from "./products.js";

// load UMD ZXing (simple + stable)
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

const video = document.getElementById("video");
const status = document.getElementById("status");

const PI_URL =
    new URLSearchParams(location.search).get("pi") ||
    "https://your-ngrok-url.ngrok-free.dev/add_item";

let reader;

// Start everything
(async () => {
    status.textContent = "Initializing…";

    await loadScript(
        "https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js"
    );

    reader = new ZXing.BrowserMultiFormatReader();

    await startCamera();
    startDecodingLoop();
})();

async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
    });

    video.srcObject = stream;
    await video.play();
    status.textContent = "Camera ready";
}

function startDecodingLoop() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    async function loop() {
        try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const result = await reader.decodeFromCanvas(canvas);

            if (result?.text) handleScan(result.text);
        } catch (err) {
            // ignore decode failures; normal
        }

        requestAnimationFrame(loop);
    }

    loop();
}

async function handleScan(code) {
    status.textContent = "Detected: " + code;

    const entry = products[code] || { name: code, price: 0 };

    await fetch(PI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
    });

    status.textContent = "Sent to Pi: " + entry.name;
}