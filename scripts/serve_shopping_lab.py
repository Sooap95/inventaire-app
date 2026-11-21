"""Application existante, mais uniquement avec fixtures et scripts locaux.
Le fichier source n'est jamais servi brut. Pas de SDK Firebase, SW, OFF ni média.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlsplit,unquote
import argparse,json,re

ROOT=Path(__file__).resolve().parents[1]
def page():
    text=(ROOT/'index.html').read_text(encoding='utf-8')
    text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
    text=re.sub(r'const firebaseConfig = \{[\s\S]*?\n\};','const firebaseConfig = {apiKey: "TON_LOCAL_TEST"};',text,count=1)
    fixtures=(ROOT/'tests/fixtures/shopping-products.json').read_text(encoding='utf-8')
    preamble='<script>if(!localStorage.getItem("inventaire-maison-v1")){localStorage.setItem("inventaire-maison-v1",JSON.stringify('+fixtures+'));}localStorage.setItem("app-lang",localStorage.getItem("app-lang")||"fr");localStorage.setItem("user-name","Test fictif");window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;</script>'
    text=text.replace('<body>','<body>'+preamble,1)
    text=text.replace('<h1 data-i18n="app_title">','<p role="status">TEST LOCAL — DONNÉES FICTIVES UNIQUEMENT</p><h1 data-i18n="app_title">',1)
    return text.encode('utf-8')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def do_GET(self):
        path=unquote(urlsplit(self.path).path)
        if path in ['/', '/index.html']:
            data=page();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        target=(ROOT/path.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT/'src') or not target.is_file():self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):self.send_error(404)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'; frame-ancestors 'none'; form-action 'none'")
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()')
        super().end_headers()
    def list_directory(self,path):self.send_error(403)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8767);args=parser.parse_args()
    print(f'Recette fictive uniquement : http://127.0.0.1:{args.port}/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
