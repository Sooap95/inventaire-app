"""Émulation locale des fichiers et en-têtes Pages. Aucune API ni journal de contenu."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlsplit,unquote
import argparse

def handler_for(directory, observer=None):
    root=Path(directory).resolve()
    headers={}
    for line in (root/'_headers').read_text(encoding='utf-8').splitlines():
        if line.startswith('  '):
            name,value=line.strip().split(':',1);headers[name]=value.strip()
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
        def log_message(self,*args):pass
        def safe(self):
            url=urlsplit(self.path);path=unquote(url.path)
            target=(root/path.lstrip('/')).resolve()
            if observer:observer(self.command,self.path)
            if url.query or not target.is_relative_to(root) or path.startswith('/_') or any(p.startswith('.') for p in Path(path).parts):
                self.send_error(403);return False
            return True
        def do_GET(self):
            if self.safe():super().do_GET()
        def do_HEAD(self):
            if self.safe():super().do_HEAD()
        def list_directory(self,path):self.send_error(403)
        def end_headers(self):
            for name,value in headers.items():self.send_header(name,value)
            super().end_headers()
    return Handler

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('--port',type=int,default=8766);args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_for(args.directory))
    print(f'Validation locale : http://127.0.0.1:{args.port}/ (pas une publication)',flush=True)
    server.serve_forever()
