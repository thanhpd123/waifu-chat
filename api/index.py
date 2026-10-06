"""
Điểm vào Serverless Function của Vercel cho backend Kei.

Vercel chỉ build frontend Vite thành file tĩnh; mọi request `/api/*` được
`vercel.json` rewrite về đây và chạy đúng Flask app trong `server/app.py`
(cùng code với khi chạy local bằng `python server/app.py`).
"""

import os
import sys
from urllib.parse import parse_qsl, urlencode

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

from app import app as flask_app  # noqa: E402

# Tham số mà rewrite trong vercel.json gắn vào để mang theo đường dẫn gốc.
_PATH_PARAM = "__kei_path"


def app(environ, start_response):
    """Khôi phục đường dẫn gốc (`/api/health`, `/api/chat/stream`…) trước khi
    chuyển cho Flask.

    Sau rewrite, tuỳ phiên bản runtime mà Flask có thể chỉ thấy `/api/index` →
    mọi route đều 404. `vercel.json` gửi kèm đường dẫn gốc qua query `__kei_path`
    nên dù runtime truyền path nào, Flask vẫn nhận đúng route.
    """
    query = parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
    original = [value for key, value in query if key == _PATH_PARAM]
    if original:
        environ["PATH_INFO"] = "/api/" + original[0].lstrip("/")
        environ["QUERY_STRING"] = urlencode([(k, v) for k, v in query if k != _PATH_PARAM])
    return flask_app(environ, start_response)
