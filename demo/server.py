"""
EHS-AI 拍照识隐患 Demo · 本地代理服务器
--------------------------------------
作用：
1. 提供静态文件服务（index.html）
2. 代理 /api/analyze 请求到智谱开放平台，避免浏览器跨域(CORS)限制
   API Key 只从本机浏览器发出、经本进程直连官方接口，不落盘、不经第三方。

用法：
    cd demo
    python server.py            # 默认 http://localhost:8643
    python server.py 9000       # 自定义端口

仅依赖 Python 3 标准库。
"""
import json
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions"


class Handler(SimpleHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Api-Key")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/analyze":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            api_key = self.headers.get("X-Api-Key", "")
            if not api_key:
                raise ValueError("缺少 X-Api-Key 请求头（请在页面填写 API Key）")

            req = urllib.request.Request(
                UPSTREAM,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._cors()
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:2000]
            self._json(e.code, {"error": {"message": detail or str(e)}})
        except Exception as e:  # noqa: BLE001
            self._json(502, {"error": {"message": str(e)}})

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # 精简日志
        print("[proxy]", fmt % args)


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
    host = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"  # 0.0.0.0 = 局域网内其他人也可访问
    print(f"EHS-AI Demo -> http://localhost:{port}  (Ctrl+C 退出)")
    HTTPServer((host, port), Handler).serve_forever()
