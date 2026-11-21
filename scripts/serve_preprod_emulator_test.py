from http.server import ThreadingHTTPServer
from pathlib import Path
import serve_family_lab
serve_family_lab.ROOT=Path(__file__).resolve().parents[1]/'dist/preprod-emulator-test'
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8773),serve_family_lab.Handler).serve_forever()
