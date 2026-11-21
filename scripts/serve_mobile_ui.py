from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import argparse
from urllib.parse import urlsplit,urlunsplit
from build_mobile_ui import CSP
ROOT=Path(__file__).resolve().parents[1]/'dist/mobile-ui'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
    def send_head(self):
        # Reproduit les URL HTML canoniques de Pages, sans dépendance distante.
        url=urlsplit(self.path)
        if url.path.endswith('.html'):
            target=url.path[:-10].rstrip('/')+'/' if url.path.endswith('index.html') else url.path[:-5]
            self.send_response(308);self.send_header('Location',urlunsplit(('', '',target,url.query,'')));self.send_header('Content-Length','0');self.end_headers();return None
        return super().send_head()
    def translate_path(self,path):
        value=super().translate_path(path)
        if not Path(value).exists() and Path(value+'.html').is_file():return value+'.html'
        return value
    def log_message(self,*args):pass
    def end_headers(self):
        self.send_header('Content-Security-Policy',CSP);self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()');self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');super().end_headers()
    def list_directory(self,path):self.send_error(403)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8770);args=parser.parse_args();print(f'Niveau 1 fictif uniquement : http://127.0.0.1:{args.port}/',flush=True);ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
