Smart Cart — Finalized Package
================================

Files included:
- index.html
  Mobile-first barcode scanner (uses native BarcodeDetector or ZXing fallback).
  IMPORTANT: edit PI_ADD_URL near the top to point to your Raspberry Pi:
    e.g. const PI_ADD_URL = 'http://192.168.1.12:5000/add_item';

- tft_display_patched.py
  Modified version of your tft_display.py:
    * Enables CORS (so browser can POST)
    * Adds /lookup route (reads products.csv)
    * Keeps existing behaviour for /add_item and rendering

  You can either replace your existing tft_display.py (backup first), or run this file.

- products.csv
  Sample product database used by the /lookup route.

Quick setup (on Raspberry Pi):
1. Install deps:
   sudo pip3 install flask flask_cors pillow evdev

2. Copy 'tft_display_patched.py' and 'products.csv' to a folder on the Pi.
   If you want to keep your original file, rename patched file to tft_display_patched.py and run it.

3. Run the server:
   python3 tft_display_patched.py

   The server listens on port 5000 and will update the TFT framebuffer (/dev/fb1).
   Make sure your TFT driver is working and you have permission to write /dev/fb1.

Quick setup (serve the web app & open on phone):
1. Edit index.html -> set PI_ADD_URL to your Pi address (or to an ngrok URL).
2. Serve the folder with:
   python3 -m http.server 8000
3. (Recommended) Run ngrok on the machine serving index.html:
   ngrok http 8000
   Open the HTTPS ngrok URL on your phone browser (camera needs secure context on some browsers).

How scanning flow works:
- Phone scans barcode → checks local `products` map
  - If found: phone sends {name, price} to PI_ADD_URL
  - If not found: phone sends {name: <barcode>, price: 0} to PI_ADD_URL
- Pi receives POST /add_item → adds item and TFT updates automatically

Notes & tips:
- price must be an integer (Rupees) — tft code expects int
- If POSTs fail, check Pi logs for CORS or 500 errors
- For better UX, edit index.html to show confirmation screens or price input for unknown barcodes
- For secure long-term usage, consider running a proper HTTPS server / PWA and limiting CORS origins

If you want:
- I can inject your actual PI_IP into index.html and repackage the zip.
- I can add a tiny admin web UI to edit products.csv on the Pi.

