// scanner.js (final — cleaned & fixed)
// Place next to index.html and products.js

import { products } from './products.js';

// CONFIG: default PI endpoint (override at runtime with ?pi=)
const DEFAULT_PI = 'https://hypogeal-flynn-clamorous.ngrok-free.dev/add_item';
const PI_ADD_URL = (new URLSearchParams(location.search).get('pi')) || DEFAULT_PI;

// UI
const video = document.getElementById('video');
const status = document.getElementById('status');
const consoleEl = document.getElementById('console');
const btnRetry = document.getElementById('btn-retry');
const btnSwitch = document.getElementById('btn-switch');
const upload = document.getElementById('upload');
const itemsBox = document.getElementById('items');
const itemsList = document.getElementById('items-list');

function log(...args) {
    console.log(...args);
    if (!consoleEl) return;
    consoleEl.textContent += args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

// dynamic script loader
function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
}

// ZXing UMD reader holder
let codeReader = null;
async function ensureReader() {
    if (codeReader) return codeReader;
    await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
    try {
        codeReader = new ZXing.BrowserMultiFormatReader();
    } catch (e) {
        codeReader = null;
    }
    return codeReader;
}

// devices + camera
let deviceList = [];
let usingIndex = 0;
let stream = null;
let liveTimer = null;
let lastDecoded = null;

async function enumerateDevices() {
    try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        deviceList = devs.filter(d => d.kind === 'videoinput');
        log('video devices:', deviceList.map(d => d.label || d.deviceId));
    } catch (e) {
        log('enumerateDevices failed', e);
    }
}

async function pickDevicePreferRear() {
    // ensure devices are enumerated
    if (deviceList.length === 0) await enumerateDevices();
    if (!deviceList.length) return null;

    const lower = deviceList.map(d => ({ deviceId: d.deviceId, label: (d.label || '').toLowerCase() }));
    const prefer = lower.find(d => /back|rear|environment|camera 0|camera 1/.test(d.label));
    if (prefer) return prefer.deviceId;
    return deviceList[deviceList.length - 1].deviceId;
}

async function startCamera(deviceId = null) {
    stopCamera();
    status.textContent = 'requesting camera...';
    try {
        const constraints = deviceId
            ? { video: { deviceId: { exact: deviceId } } }
            : { video: { facingMode: { ideal: 'environment' } } };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        await video.play();
        status.textContent = 'camera live';
        log('camera started');
        return true;
    } catch (e) {
        log('startCamera failed', e);
        status.textContent = 'camera error — check permission';
        return false;
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    try { video.srcObject = null; } catch (e) {}
}

function stopLiveDecode() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

// Robust live decode: native BarcodeDetector first, then ZXing UMD fallback
async function startLiveDecode() {
    stopLiveDecode();

    // native path
    if ('BarcodeDetector' in window) {
        try {
            const formats = await BarcodeDetector.getSupportedFormats();
            const detector = new BarcodeDetector({ formats });
            status.textContent = 'scanning (native)…';
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            liveTimer = setInterval(async () => {
                try {
                    if (video.readyState < 2) return;
                    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const results = await detector.detect(canvas);
                    if (results && results.length) {
                        const raw = results[0].rawValue || results[0].rawText || results[0].raw;
                        if (raw && raw !== lastDecoded) { lastDecoded = raw; await handleDetected(raw); }
                    }
                } catch (e) { /* ignore per-frame errors */ }
            }, 300);
            log('using native BarcodeDetector');
            return;
        } catch (e) {
            log('native BarcodeDetector failed, falling back to ZXing', e);
        }
    }

    // ZXing fallback
    await ensureReader();
    if (!codeReader && !(window.ZXing && ZXing.BrowserMultiFormatReader)) {
        status.textContent = 'no barcode decoder available';
        log('no ZXing available');
        return;
    }

    status.textContent = 'scanning (zxing)…';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    liveTimer = setInterval(async () => {
        try {
            if (video.readyState < 2) return;
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            let result = null;
            try {
                if (codeReader && typeof codeReader.decodeOnceFromCanvas === 'function') {
                    result = await codeReader.decodeOnceFromCanvas(canvas);
                } else if (codeReader && typeof codeReader.decodeFromCanvas === 'function') {
                    result = await codeReader.decodeFromCanvas(canvas);
                } else if (window.ZXing && ZXing.BrowserMultiFormatReader) {
                    const tmp = new ZXing.BrowserMultiFormatReader();
                    if (typeof tmp.decodeFromCanvas === 'function') result = await tmp.decodeFromCanvas(canvas);
                    else if (typeof tmp.decodeOnceFromCanvas === 'function') result = await tmp.decodeOnceFromCanvas(canvas);
                }
            } catch (err) {
                // per-frame decode failure — normal
            }

            if (result && (result.text || (result.getText && result.getText()))) {
                const raw = result.text || (result.getText && result.getText());
                if (raw && raw !== lastDecoded) { lastDecoded = raw; await handleDetected(raw); }
            }
        } catch (e) {
            log('live loop err', e);
        }
    }, 300);
    log('using ZXing fallback');
}

// UI helpers
function showScan(name, price) {
    if (!itemsBox) return;
    itemsBox.hidden = false;
    const div = document.createElement('div'); div.className = 'item';
    const n = document.createElement('div'); n.textContent = name;
    const p = document.createElement('div'); p.textContent = '₹' + price;
    div.appendChild(n); div.appendChild(p);
    itemsList.prepend(div);
    while (itemsList.children.length > 8) itemsList.removeChild(itemsList.lastChild);
}

// POST to Pi
async function postAddItem(name, price) {
    try {
        const body = { name: String(name), price: Math.round(Number(price) || 0) };
        const res = await fetch(PI_ADD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '<no body>');
            throw new Error('server ' + res.status + ' ' + t);
        }
        log('posted', body);
        showScan(body.name, body.price);
        status.textContent = `sent → ${body.name} ₹${body.price}`;
    } catch (err) {
        log('post failed', err);
        status.textContent = 'post failed — check PI & CORS';
    }
}

// detection handler
async function handleDetected(raw) {
    log('detected', raw);
    const entry = products[String(raw)];
    if (entry) {
        await postAddItem(entry.name, entry.price);
    } else {
        await postAddItem(raw, 0);
    }
}

// upload decode
upload.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const img = new Image(); img.src = URL.createObjectURL(f);
    await new Promise(r => img.onload = r);
    const canvas = document.createElement('canvas'); const scale = 2;
    canvas.width = img.naturalWidth * scale; canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
        await ensureReader();
        let result = null;
        if (codeReader && typeof codeReader.decodeFromCanvas === 'function') {
            result = await codeReader.decodeFromCanvas(canvas);
        } else if (codeReader && typeof codeReader.decodeOnceFromCanvas === 'function') {
            result = await codeReader.decodeOnceFromCanvas(canvas);
        } else if (window.ZXing && ZXing.BrowserMultiFormatReader) {
            const tmp = new ZXing.BrowserMultiFormatReader();
            if (typeof tmp.decodeFromCanvas === 'function') result = await tmp.decodeFromCanvas(canvas);
            else if (typeof tmp.decodeOnceFromCanvas === 'function') result = await tmp.decodeOnceFromCanvas(canvas);
        }
        if (result && (result.text || (result.getText && result.getText()))) {
            const raw = result.text || (result.getText && result.getText());
            await handleDetected(raw);
        } else {
            throw new Error('no decode result');
        }
    } catch (e) {
        log('upload decode failed', e);
        alert('decode failed: ' + (e && e.name ? e.name : e));
    }
});

// controls
btnRetry.addEventListener('click', async () => { await init(); });
btnSwitch.addEventListener('click', async () => {
    if (!deviceList.length) await enumerateDevices();
    if (deviceList.length) {
        usingIndex = (usingIndex + 1) % deviceList.length;
        const id = deviceList[usingIndex].deviceId;
        stopCamera(); await startCamera(id); stopLiveDecode(); await startLiveDecode();
    } else {
        log('no video devices to switch');
    }
});

// init flow
async function init() {
    status.textContent = 'initialising…';
    log('init');
    try {
        await ensureReader();
        await enumerateDevices();
        const prefer = await pickDevicePreferRear();
        await startCamera(prefer);
        await startLiveDecode();
    } catch (e) {
        log('init failed', e);
        status.textContent = 'init failed';
    }
}

// auto-start
window.addEventListener('load', () => { init().catch(e => log('init exception', e)); });
