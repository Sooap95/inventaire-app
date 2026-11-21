"""Serveur local exclusif de la distribution fictive, jamais le dépôt brut."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlsplit,unquote
ROOT=Path(__file__).resolve().parents[1]/'dist/family-lab'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
    def log_message(self,*args):pass
    def do_GET(self):
        p=(ROOT/unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if not p.is_relative_to(ROOT) or p.is_dir() and p!=ROOT:self.send_error(404);return
        super().do_GET()
    def end_headers(self):
        self.send_header('Content-Security-Policy',"default-src 'self'; connect-src 'self' http://127.0.0.1:8180 ws://127.0.0.1:8180 http://127.0.0.1:9099; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self'; frame-ancestors 'none'; form-action 'none'")
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()')
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def list_directory(self,path):self.send_error(403)
if __name__=='__main__':
    if not (ROOT/'src/family/family-lab.bundle.js').exists():raise SystemExit('Exécuter npm run build:family-lab')
    print('Recette FICTIVE : http://127.0.0.1:8769/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8769),Handler).serve_forever()
