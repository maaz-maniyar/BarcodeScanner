// scanner.js — Quagga-based (robust for Code128)
// Place at public/scanner.js (overwrite previous)

import { products } from './products.js';

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

function log(...a){ console.log(...a); if(consoleEl) consoleEl.textContent += a.join(' ') + '\n'; }

// load Quagga UMD
function loadQuagga(){
    return new Promise((res,rej)=>{
        if(window.Quagga) return res(window.Quagga);
        const s=document.createElement('script');
        s.src = 'https://unpkg.com/quagga@0.12.1/dist/quagga.min.js';
        s.onload = ()=> res(window.Quagga);
        s.onerror = (e)=> rej(new Error('Quagga load failed'));
        document.head.appendChild(s);
    });
}

// show item list
function showScan(name, price){
    if(!itemsBox) return;
    itemsBox.style.display = 'block';
    const div = document.createElement('div'); div.className='item';
    const n = document.createElement('div'); n.textContent = name;
    const p = document.createElement('div'); p.textContent = '₹' + price;
    div.appendChild(n); div.appendChild(p);
    itemsList.prepend(div);
    while(itemsList.children.length > 8) itemsList.removeChild(itemsList.lastChild);
}

// post to PI
async function postAddItem(name, price){
    try{
        const body = { name: String(name), price: Math.round(Number(price)||0) };
        const res = await fetch(PI_ADD_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        if(!res.ok) { const t = await res.text().catch(()=>'<no body>'); throw new Error('server ' + res.status + ' ' + t); }
        log('posted', body);
        showScan(body.name, body.price);
        status.textContent = `sent → ${body.name} ₹${body.price}`;
    }catch(err){
        log('post failed', err);
        status.textContent = 'post failed — check PI & CORS';
    }
}

// handle detected code string
async function handleDetected(code){
    log('detected', code);
    const entry = products[String(code)];
    if(entry) await postAddItem(entry.name, entry.price);
    else await postAddItem(code, 0);
}

// START LIVE SCANNER using Quagga
let quaggaActive = false;
let currentDeviceId = null;
async function startLiveQuagga(deviceId = null){
    try{
        const Quagga = await loadQuagga();
        // stop first if running
        try{ Quagga.stop(); }catch(e){}
        // config
        const constraints = deviceId ? { deviceId: deviceId } : { facingMode: 'environment' };
        const config = {
            inputStream: {
                type: "LiveStream",
                constraints: {
                    ...constraints,
                    width: { min: 640, ideal: 1280 },
                    height: { min: 480, ideal: 720 },
                },
                target: video, // the video element
                singleChannel: false
            },
            locator: { patchSize: "medium", halfSample: true },
            numOfWorkers: navigator.hardwareConcurrency ? Math.max(1, navigator.hardwareConcurrency-1) : 1,
            decoder: { readers: ["code_128_reader","ean_reader","ean_8_reader","code_39_reader","upc_reader"] },
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
            log('Quagga started');
        });

        // on detected
        Quagga.offDetected(); // ensure single handler
        Quagga.onDetected(function(data){
            try{
                if(!data || !data.codeResult || !data.codeResult.code) return;
                const code = data.codeResult.code;
                // debounce double detections
                if(window.__lastQuagga === code) return;
                window.__lastQuagga = code;
                setTimeout(()=>{ window.__lastQuagga = null; }, 900);
                log('Quagga detected', code);
                handleDetected(code);
            }catch(e){ log('onDetected err', e); }
        });

        Quagga.onProcessed(function(result){
            // optional: we could draw bounding boxes for debug
        });

        // remember Quagga globally if needed
        window.__Quagga = Quagga;
    }catch(e){
        log('startLiveQuagga failed', e);
        status.textContent = 'camera error — check permission';
    }
}

function stopLiveQuagga(){
    try{
        if(window.__Quagga && window.__Quagga.stop) window.__Quagga.stop();
    }catch(e){}
    quaggaActive = false;
}

// upload handler using Quagga.decodeSingle (with rotations / upscale)
upload.addEventListener('change', async (ev)=>{
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    log('Upload selected', f.name, f.size);
    // prepare image element
    const img = new Image(); img.src = URL.createObjectURL(f);
    await new Promise(r=>img.onload=r);
    // try multiple rotations
    const rotations = [0,0,90,270]; // try 0 twice to handle orientation flags
    for(const rot of rotations){
        // draw rotated to canvas
        const canvas = document.createElement('canvas');
        let w = img.naturalWidth, h = img.naturalHeight;
        if(rot === 90 || rot === 270){ canvas.width = h; canvas.height = w; }
        else { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext('2d');
        ctx.save();
        if(rot === 90){ ctx.translate(canvas.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(img,0,0); }
        else if(rot === 270){ ctx.translate(0,canvas.height); ctx.rotate(-Math.PI/2); ctx.drawImage(img,0,0); }
        else ctx.drawImage(img,0,0);
        ctx.restore();

        // upscale small images
        const maxSide = Math.max(canvas.width, canvas.height);
        let scale = 1;
        if(maxSide < 800) scale = Math.ceil(800 / maxSide);
        if(scale > 1){
            const c2 = document.createElement('canvas');
            c2.width = canvas.width * scale; c2.height = canvas.height * scale;
            c2.getContext('2d').drawImage(canvas,0,0,c2.width,c2.height);
            // replace canvas with c2
            canvas.width = c2.width; canvas.height = c2.height;
            canvas.getContext('2d').drawImage(c2,0,0);
        }

        // try decode via Quagga.decodeSingle
        try{
            const Quagga = await loadQuagga();
            await new Promise((resolve, reject)=>{
                Quagga.decodeSingle({
                    src: canvas.toDataURL(),
                    numOfWorkers: 0,
                    decoder: { readers: ["code_128_reader","ean_reader","upc_reader","code_39_reader"] }
                }, function(result){
                    if(result && result.codeResult && result.codeResult.code){
                        log('Upload decode OK', result.codeResult.code);
                        handleDetected(result.codeResult.code);
                        resolve(result);
                    } else {
                        reject(result);
                    }
                });
            });
            return; // success -> exit
        }catch(err){
            log('Upload attempt failed rotation', rot, err && (err.name||err) );
            // continue to next rotation
        }
    }
    alert('Decode failed — try a clearer photo or use the generated test barcode');
});

// retry / switch buttons
btnRetry.addEventListener('click', async ()=>{ stopLiveQuagga(); await startLiveQuagga(currentDeviceId); });
btnSwitch.addEventListener('click', async ()=>{
    // try enumerate devices and cycle to next
    try{
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d=>d.kind==='videoinput');
        if(!cams.length){ log('no cameras found'); return; }
        let idx = cams.findIndex(c=>c.deviceId === currentDeviceId);
        idx = (idx + 1) % cams.length;
        currentDeviceId = cams[idx].deviceId;
        log('Switching to device', cams[idx].label || cams[idx].deviceId);
        stopLiveQuagga();
        await startLiveQuagga({ deviceId: currentDeviceId });
    }catch(e){ log('switch error', e); }
});

// init
window.addEventListener('load', async ()=>{
    status.textContent = 'initialising…';
    try{
        // quick test: can we get permission?
        await navigator.mediaDevices.getUserMedia({ video: true }).then(s=>{ s.getTracks().forEach(t=>t.stop()); }).catch(()=>{});
    }catch(e){}
    // start live (prefer rear)
    try{
        // choose rear device if available
        const devs = await navigator.mediaDevices.enumerateDevices();
        const cams = devs.filter(d=>d.kind==='videoinput');
        if(cams.length){
            // prefer labels with back/rear/environment
            const prefer = cams.find(c=>/back|rear|environment|camera 0|camera 1/i.test(c.label));
            currentDeviceId = prefer ? prefer.deviceId : cams[cams.length-1].deviceId;
        }
        await startLiveQuagga(currentDeviceId);
    }catch(e){ log('init error', e); status.textContent = 'init failed'; }
});
