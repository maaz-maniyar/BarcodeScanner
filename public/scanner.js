// scanner.js — Quagga-based (robust for Code128)
// Overwrite your public/scanner.js with this file (complete).
// Requires products.js alongside it.

import { products } from './products.js';

// CONFIG
const DEFAULT_PI = 'https://hypogeal-flynn-clamorous.ngrok-free.dev/add_item';
const PI_ADD_URL = (new URLSearchParams(location.search).get('pi')) || DEFAULT_PI;

// UI refs
const video = document.getElementById('video');
const status = document.getElementById('status');
const consoleEl = document.getElementById('console');
const btnRetry = document.getElementById('btn-retry');
const btnSwitch = document.getElementById('btn-switch');
const upload = document.getElementById('upload');
const itemsBox = document.getElementById('items');
const itemsList = document.getElementById('items-list');

function log(...a){
    console.log(...a);
    if(!consoleEl) return;
    try { consoleEl.textContent += a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n'; }
    catch(e){}
}

// Load Quagga UMD script (idempotent)
function loadQuagga(){
    return new Promise((res, rej) => {
        if(window.Quagga) return res(window.Quagga);
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/quagga@0.12.1/dist/quagga.min.js';
        s.onload = () => res(window.Quagga);
        s.onerror = (e) => rej(new Error('Quagga load failed'));
        document.head.appendChild(s);
    });
}

// UI: show scanned items
function showScan(name, price){
    if(!itemsBox) return;
    itemsBox.style.display = 'block';
    const div = document.createElement('div'); div.className = 'item';
    const n = document.createElement('div'); n.textContent = name;
    const p = document.createElement('div'); p.textContent = '₹' + price;
    div.appendChild(n); div.appendChild(p);
    itemsList.prepend(div);
    while(itemsList.children.length > 8) itemsList.removeChild(itemsList.lastChild);
}

// POST to PI
async function postAddItem(name, price){
    try{
        const body = { name: String(name), price: Math.round(Number(price)||0) };
        const res = await fetch(PI_ADD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if(!res.ok){
            const t = await res.text().catch(()=>'<no body>');
            throw new Error('server ' + res.status + ' ' + t);
        }
        log('posted', body);
        showScan(body.name, body.price);
        status.textContent = `sent → ${body.name} ₹${body.price}`;
    }catch(err){
        log('post failed', err);
        status.textContent = 'post failed — check PI & CORS';
    }
}

// handle detected code
async function handleDetected(code){
    log('detected', code);
    const entry = products[String(code)];
    if(entry) await postAddItem(entry.name, entry.price);
    else await postAddItem(code, 0);
}

// Quagga live control
let quaggaActive = false;
let currentDeviceId = null;

// loadQuagga is defined above

// Enhanced live start with bigger patch and fallback cropping decode
async function startLiveQuagga(deviceId = null){
    try{
        const Quagga = await loadQuagga();
        try{ Quagga.stop(); }catch(e){}
        const constraints = deviceId ? { deviceId } : { facingMode: 'environment' };

        const config = {
            inputStream: {
                type: "LiveStream",
                constraints: {
                    ...constraints,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                target: video,
                singleChannel: false
            },
            locator: {
                patchSize: "x-large",
                halfSample: false
            },
            numOfWorkers: navigator.hardwareConcurrency ? Math.max(1, navigator.hardwareConcurrency-1) : 1,
            decoder: {
                readers: ["code_128_reader"],
                multiple: false
            },
            locate: true
        };

        Quagga.init(config, function(err){
            if(err){
                log('Quagga init error', err);
                status.textContent = 'quagga init error';
                return;
            }
            Quagga.start();
            quaggaActive = true;
            status.textContent = 'scanning (quagga)…';
            log('Quagga started (enhanced config)');
        });

        Quagga.offDetected();
        Quagga.onDetected(function(data){
            try{
                if(!data) return;
                const code = data.codeResult && data.codeResult.code;
                if(code){
                    if(window.__lastQuagga === code) return;
                    window.__lastQuagga = code;
                    setTimeout(()=>{ window.__lastQuagga = null; }, 900);
                    log('Quagga detected (live)', code);
                    handleDetected(code);
                    return;
                }
                if(data.boxes && data.boxes.length){
                    tryFallbackDecodeFromQuaggaFrame(data);
                }
            }catch(e){ log('onDetected err', e); }
        });

        window.__Quagga = Quagga;
    }catch(e){
        log('startLiveQuagga failed', e);
        status.textContent = 'camera error — check permission';
    }
}

// fallback: crop largest box and run decodeSingle on an upscaled crop
async function tryFallbackDecodeFromQuaggaFrame(data){
    try{
        const boxes = (data.boxes||[]).filter(b=>b && b.length);
        if(!boxes.length) return;
        const box = boxes.reduce((best, cur)=>{
            const flat = Array.isArray(cur.flat) ? cur.flat() : [].concat(...cur);
            const [x1,y1,x2,y2,x3,y3,x4,y4] = flat;
            const minX = Math.min(x1,x2,x3,x4), maxX = Math.max(x1,x2,x3,x4);
            const minY = Math.min(y1,y2,y3,y4), maxY = Math.max(y1,y2,y3,y4);
            const area = (maxX-minX)*(maxY-minY);
            if(!best || area > best.area) return { coords:flat, area, minX, maxX, minY, maxY };
            return best;
        }, null);
        if(!box) return;

        const vidW = video.videoWidth || 640, vidH = video.videoHeight || 480;
        const temp = document.createElement('canvas');
        temp.width = vidW; temp.height = vidH;
        const tctx = temp.getContext('2d');
        tctx.drawImage(video, 0, 0, vidW, vidH);

        const flat = box.coords;
        const xs = [flat[0],flat[2],flat[4],flat[6]];
        const ys = [flat[1],flat[3],flat[5],flat[7]];
        const sx = Math.max(0, Math.floor(Math.min(...xs) - 8));
        const sy = Math.max(0, Math.floor(Math.min(...ys) - 8));
        const sw = Math.min(vidW, Math.ceil(Math.max(...xs) + 8)) - sx;
        const sh = Math.min(vidH, Math.ceil(Math.max(...ys) + 8)) - sy;
        if(sw <= 0 || sh <= 0) return;

        const upscale = 3;
        const crop = document.createElement('canvas');
        crop.width = sw * upscale; crop.height = sh * upscale;
        const cctx = crop.getContext('2d');
        cctx.drawImage(temp, sx, sy, sw, sh, 0, 0, crop.width, crop.height);

        const Quagga = window.Quagga;
        await new Promise((resolve, reject)=>{
            Quagga.decodeSingle({
                src: crop.toDataURL(),
                numOfWorkers: 0,
                decoder: { readers: ["code_128_reader"], multiple:false },
                locate: false
            }, function(result){
                if(result && result.codeResult && result.codeResult.code){
                    log('Fallback decode OK ->', result.codeResult.code);
                    handleDetected(result.codeResult.code);
                    resolve(result);
                } else {
                    log('Fallback decode failed (crop)', result);
                    reject(result);
                }
            });
        }).catch(()=>{ /* ignore */ });
    }catch(e){ log('tryFallbackDecodeFromQuaggaFrame err', e); }
}

// Enhanced upload handler: rotations, upscale, contrast, decodeSingle
upload.addEventListener('change', async (ev)=>{
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    log('Upload selected', f.name, f.size);
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await new Promise(r=>img.onload = r);

    const rotations = [0, 90, 270];
    for(const rot of rotations){
        const baseW = img.naturalWidth, baseH = img.naturalHeight;
        const canvas = document.createElement('canvas');
        if(rot === 90 || rot === 270){ canvas.width = baseH; canvas.height = baseW; }
        else { canvas.width = baseW; canvas.height = baseH; }
        const ctx = canvas.getContext('2d');
        ctx.save();
        if(rot === 90){ ctx.translate(canvas.width, 0); ctx.rotate(Math.PI/2); ctx.drawImage(img, 0, 0); }
        else if(rot === 270){ ctx.translate(0, canvas.height); ctx.rotate(-Math.PI/2); ctx.drawImage(img, 0, 0); }
        else { ctx.drawImage(img, 0, 0); }
        ctx.restore();

        const maxSide = Math.max(canvas.width, canvas.height);
        let scale = 1;
        if(maxSide < 1200) scale = Math.ceil(1200 / maxSide);
        if(scale > 1){
            const up = document.createElement('canvas');
            up.width = canvas.width * scale; up.height = canvas.height * scale;
            up.getContext('2d').drawImage(canvas, 0, 0, up.width, up.height);
            canvas.width = up.width; canvas.height = up.height;
            canvas.getContext('2d').drawImage(up, 0, 0);
        }

        // grayscale + contrast boost
        const ctx2 = canvas.getContext('2d');
        const imgd = ctx2.getImageData(0,0,canvas.width,canvas.height);
        const data = imgd.data;
        for(let i=0;i<data.length;i+=4){
            const r = data[i], g = data[i+1], b = data[i+2];
            let gray = (r*0.3 + g*0.59 + b*0.11);
            gray = Math.min(255, Math.max(0, (gray-128)*1.4 + 128));
            data[i]=data[i+1]=data[i+2]=gray;
        }
        ctx2.putImageData(imgd,0,0);

        try{
            const Quagga = await loadQuagga();
            const res = await new Promise((resolve,reject)=>{
                Quagga.decodeSingle({
                    src: canvas.toDataURL(),
                    numOfWorkers: 0,
                    decoder: { readers: ["code_128_reader"], multiple:false },
                    locate: true
                }, function(r){
                    if(r && r.codeResult && r.codeResult.code) resolve(r);
                    else reject(r);
                });
            });
            if(res && res.codeResult && res.codeResult.code){
                log('Upload decode OK ->', res.codeResult.code);
                await handleDetected(res.codeResult.code);
                return;
            }
        }catch(err){
            log('Upload attempt failed rotation', rot, err && (err.name||err));
        }
    }
    alert('Decode failed — try brighter light, a flat photo with barcode filling the frame, or display the barcode on another screen.');
});

// Retry / switch buttons
btnRetry.addEventListener('click', async ()=>{ stopLiveQuagga(); await startLiveQuagga(currentDeviceId); });
btnSwitch.addEventListener('click', async ()=>{
    try{
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d=>d.kind==='videoinput');
        if(!cams.length){ log('no cameras found'); return; }
        let idx = cams.findIndex(c=>c.deviceId === currentDeviceId);
        idx = (idx + 1) % cams.length;
        currentDeviceId = cams[idx].deviceId;
        log('Switching to device', cams[idx].label || cams[idx].deviceId);
        stopLiveQuagga();
        await startLiveQuagga(currentDeviceId);
    }catch(e){ log('switch error', e); }
});

function stopLiveQuagga(){
    try{ if(window.__Quagga && window.__Quagga.stop) window.__Quagga.stop(); }catch(e){}
    quaggaActive = false;
}

// init on load
window.addEventListener('load', async ()=>{
    status.textContent = 'initialising…';
    try{
        await navigator.mediaDevices.getUserMedia({ video: true }).then(s=>{ s.getTracks().forEach(t=>t.stop()); }).catch(()=>{});
    }catch(e){}
    try{
        const devs = await navigator.mediaDevices.enumerateDevices();
        const cams = devs.filter(d=>d.kind==='videoinput');
        if(cams.length){
            const prefer = cams.find(c=>/back|rear|environment|camera 0|camera 1/i.test(c.label));
            currentDeviceId = prefer ? prefer.deviceId : cams[cams.length-1].deviceId;
        }
        await startLiveQuagga(currentDeviceId);
    }catch(e){
        log('init error', e);
        status.textContent = 'init failed';
    }
});
