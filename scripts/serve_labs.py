"""Serveur de recette : ne sert jamais l'application de production ni son SW."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse, ssl

ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        target = (ROOT / path.lstrip('/')).resolve()
        allowed = ('labs', 'src', 'vendor', 'tests/fixtures')
        if not any(target.is_relative_to(ROOT / prefix) for prefix in allowed) or not target.is_relative_to(ROOT):
            self.send_error(403, 'Seuls les laboratoires isoles sont servis')
            return
        super().do_GET()

    def do_HEAD(self):
        self.do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(403, 'Liste de fichiers desactivee')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--cert', help='Certificat TLS local déjà approuvé par les appareils de recette')
    parser.add_argument('--key', help='Clé du certificat local, jamais copiée dans Git')
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error('--cert et --key doivent être fournis ensemble')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    if args.cert:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(args.cert, args.key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
    protocol = 'https' if args.cert else 'http'
    print(f'Laboratoires : {protocol}://{args.host}:{args.port}/labs/backup/ et /labs/ocr/', flush=True)
    server.serve_forever()
