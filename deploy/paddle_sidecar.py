#!/usr/bin/env python3
"""PaddleOCR sidecar for weavine-server.

POST /ocr   body: raw image bytes (png/jpg/webp)
response:   {"raw_text": "<newline-joined lines>", "avg_confidence": 0.0-1.0}

Runs PaddleOCR (PP-OCR) in-process behind a lock (the predictor is not
thread-safe). Enable with:
    python3 deploy/paddle_sidecar.py           # listens on 127.0.0.1:3031
Env:
    PADDLE_SIDECAR_PORT   (default 3031)
    PADDLE_SIDECAR_LANG   (default "ch")
"""
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image
from paddleocr import PaddleOCR

PORT = int(os.environ.get("PADDLE_SIDECAR_PORT", "3031"))
LANG = os.environ.get("PADDLE_SIDECAR_LANG", "ch")

print(f"[paddle-sidecar] loading PaddleOCR lang={LANG} ...", flush=True)
ocr = PaddleOCR(
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,  # paddle 3.x onednn crash on some CPUs
    lang=LANG,
)
lock = threading.Lock()
print("[paddle-sidecar] model ready", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        pass

    def do_GET(self):
        if self.path == "/health":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/ocr":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(n)
            img = np.array(Image.open(io.BytesIO(data)).convert("RGB"))
            with lock:  # predictor is not thread-safe
                results = ocr.predict(img)
            texts, scores = [], []
            for r in results:
                texts.extend(r.get("rec_texts", []))
                scores.extend(r.get("rec_scores", []))
            body = json.dumps(
                {
                    "raw_text": "\n".join(t for t in texts if t),
                    "avg_confidence": (sum(scores) / len(scores)) if scores else 0.0,
                }
            ).encode()
            self.send_response(200)
        except Exception as e:  # noqa: BLE001 — single entrypoint, report all
            body = str(e).encode()
            self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"[paddle-sidecar] listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
