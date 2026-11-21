from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from build_mobile_ui import CSP
ROOT=Path(__file__).resolve().parents[1]/'dist/preprod-local'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def translate_path(self,path):
        value=super().translate_path(path)
        return value+'.html' if not Path(value).exists() and Path(value+'.html').is_file() else value
    def log_message(self,*args):pass
    def list_directory(self,path):self.send_error(403)
    def end_headers(self):
        self.send_header('Content-Security-Policy',CSP);self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()');self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');super().end_headers()
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8772),Handler).serve_forever()
