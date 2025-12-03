// scanner.js
// Drop into your Vercel project (with index.html + products.js)
// Exports: none. Behavior: auto-starts on page load.

import { products } from './products.js';

// CONFIG: default PI endpoint (override at runtime with ?pi=)
const DEFAULT_PI = 'https://hypogeal-flynn-clamorous.ngrok-free.dev/add_item';
const PI_ADD_URL = (new URLSearchParams(location.search).get('pi')) || DEFAULT_PI;

// UI elements
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

// ZXing reader (UMD)
let codeReader = null;
async function ensureReader() {
    if (codeReader) return codeReader;
    await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
    codeReader = new ZXing.BrowserMultiFormatReader();
    return codeReader;
}

// device handling
let deviceList = [];
let usingIndex = 0;
let stream = null;

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
    await enumerateDevices();
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

// live decoding loop (throttled)
let liveTimer = null;
let lastDecoded = null;

async function startLiveDecode() {
    await ensureReader();
    if (!video || !video.srcObject) {
        status.textContent = 'camera not running';
        return;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const throttleMs = 300;

    stopLiveDecode();
    status.textContent = 'scanning...';

    liveTimer = setInterval(async () => {
        try {
            if (video.readyState < 2) return;
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            try {
                const result = await codeReader.decodeFromCanvas(canvas);
                if (result && result.getText) {
                    const raw = result.getText();
                    if (raw !== lastDecoded) {
                        lastDecoded = raw;
                        await handleDetected(raw);
                    }
                }
            } catch (_) {
                // expected - many frames won't decode
            }
        } catch (e) {
            log('live loop error', e);
        }
    }, throttleMs);
}

function stopLiveDecode() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
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

// upload image decode
upload.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await new Promise(r => img.onload = r);
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
        await ensureReader();
        const result = await codeReader.decodeFromCanvas(canvas);
        if (result && result.getText) await handleDetected(result.getText());
    } catch (e) {
        log('upload decode failed', e);
        alert('decode failed: ' + (e && e.name ? e.name : e));
    }
});

// retry and switch
btnRetry.addEventListener('click', async () => { await init(); });
btnSwitch.addEventListener('click', async () => {
    if (!deviceList.length) await enumerateDevices();
    if (deviceList.length) {
        usingIndex = (usingIndex + 1) % deviceList.length;
        const id = deviceList[usingIndex].deviceId;
        stopCamera();
        await startCamera(id);
        stopLiveDecode();
        await startLiveDecode();
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

// auto-start on load
window.addEventListener('load', () => { init().catch(e => log('init exception', e)); });
