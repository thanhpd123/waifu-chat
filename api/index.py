"""
Điểm vào Serverless Function của Vercel cho backend Kei.

Vercel chỉ build frontend Vite thành file tĩnh; mọi request `/api/*` được
`vercel.json` rewrite về đây và chạy đúng Flask app trong `server/app.py`
(cùng code với khi chạy local bằng `python server/app.py`).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

from app import app  # noqa: E402,F401 - Vercel tìm biến WSGI tên `app`
