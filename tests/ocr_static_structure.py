"""Contrôles de distribution et intégrité, sans exécuter l'application familiale."""
from pathlib import Path
import json,hashlib,unittest,sys,zipfile

ROOT=Path(__file__).resolve().parents[1]
SITE=Path(sys.argv.pop(1)).resolve()
class Distribution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release=next((SITE/'releases').iterdir())
        cls.manifest=json.loads((cls.release/'resources.json').read_text(encoding='utf-8'))
    def test_cloudflare_limits(self):
        files=[p for p in SITE.rglob('*') if p.is_file()]
        self.assertLess(len(files),1000)
        self.assertTrue(all(p.stat().st_size<=25*1024*1024 for p in files))
    def test_resource_hashes(self):
        for record in self.manifest['files']:
            path=SITE/'index.html' if record['path']=='/' else SITE/record['path'].lstrip('/')
            data=path.read_bytes()
            self.assertEqual(len(data),record['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),record['sha256'])
    def test_model_reconstruction_identical(self):
        self.assertEqual(len(self.manifest['virtualFiles']),1)
        for path,model in self.manifest['virtualFiles'].items():
            self.assertFalse((SITE/path.lstrip('/')).exists())
            payload=b''.join((SITE/p.lstrip('/')).read_bytes() for p in model['parts'])
            self.assertEqual(len(payload),model['bytes'])
            self.assertEqual(hashlib.sha256(payload).hexdigest(),model['sha256'])
            original=ROOT/'vendor/models/Xenova/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx'
            self.assertEqual(payload,original.read_bytes())
    def test_no_application_or_backend(self):
        self.assertFalse((SITE/'functions').exists())
        self.assertFalse((SITE/'_worker.js').exists())
        self.assertFalse((SITE/'.git').exists())
        for p in [SITE/'index.html',self.release/'app.js',self.release/'entry.js',self.release/'recognizer.worker.js']:
            text=p.read_text(encoding='utf-8')
            for forbidden in ['firebaseConfig','signInAnonymously','openfoodfacts.org','googleapis.com','sendBeacon(','report-uri','report-to']:
                self.assertNotIn(forbidden,text)
    def test_licenses_present_and_unmodified(self):
        sources=json.loads((self.release/'licenses/sources.json').read_text(encoding='utf-8'))
        self.assertGreaterEqual(len(sources),18)
        for source in sources:
            self.assertEqual(hashlib.sha256((self.release/'licenses'/source['file']).read_bytes()).hexdigest(),source['sha256'])
        self.assertIn('MIT',(self.release/'licenses/TrOCR-conversion-card.md').read_text(encoding='utf-8').upper())
        self.assertTrue((self.release/'licenses/onnxruntime-ThirdPartyNotices.txt').exists())
    def test_headers_and_archive(self):
        text=(SITE/'_headers').read_text(encoding='utf-8')
        for expected in ["default-src 'none'","worker-src 'self'","'wasm-unsafe-eval'",'no-referrer','nosniff']:
            self.assertIn(expected,text)
        self.assertNotIn("'unsafe-eval'",text)
        with zipfile.ZipFile(SITE.with_suffix('.zip')) as archive:
            self.assertIsNone(archive.testzip())
            self.assertIn('index.html',archive.namelist())
            self.assertIn('_headers',archive.namelist())

if __name__=='__main__':unittest.main()
