"""Télécharge uniquement des fichiers publics statiques. Aucune photo en entrée.
Les poids sont épinglés ; les fichiers volumineux ne sont jamais ajoutés à Git.
"""
from pathlib import Path
import hashlib, json, shutil, urllib.request

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor'
MODEL_REV = '02bea33ca09a70e2e2d91140a7e6e1a729606a5b'
TESS_REV = '87416418657359cb625c412a48b6e1d6d41c29bd'
records = []
lock_path = ROOT / 'docs/ocr-assets-manifest.json'
locked = {entry['path']: entry for entry in json.loads(lock_path.read_text())['files']} if lock_path.exists() else {}

def record(path, source):
    data = path.read_bytes()
    entry = {'path':path.relative_to(ROOT).as_posix(), 'bytes':len(data),
             'sha256':hashlib.sha256(data).hexdigest(), 'source':source}
    expected = locked.get(entry['path'])
    if locked and (not expected or expected['sha256'] != entry['sha256'] or expected['bytes'] != entry['bytes']):
        raise RuntimeError('Ressource différente du manifeste de référence : '+entry['path'])
    records.append(entry)

def download(url, target, expected=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and (not expected or hashlib.sha256(target.read_bytes()).hexdigest() == expected):
        record(target,url)
        return
    temporary = target.with_suffix(target.suffix + '.partial')
    print('Téléchargement statique :', target.relative_to(ROOT), flush=True)
    with urllib.request.urlopen(url,timeout=120) as response, temporary.open('wb') as out:
        shutil.copyfileobj(response,out)
    if expected and hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Empreinte du modèle invalide : '+target.name)
    temporary.replace(target)
    record(target,url)

def package_files(package, version, files, destination):
    source = ROOT / 'node_modules' / package
    metadata = json.loads((source/'package.json').read_text())
    if metadata['version'] != version:
        raise RuntimeError('Version npm inattendue : '+package)
    for relative in files:
        target = VENDOR/destination/Path(relative).name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source/relative,target)
        record(target,package+'@'+version+'/'+relative)

package_files('tesseract.js','6.0.1',[
    'dist/tesseract.esm.min.js','dist/worker.min.js','dist/tesseract.min.js.LICENSE.txt',
    'dist/worker.min.js.LICENSE.txt','LICENSE.md'], 'tesseract')
core = ROOT/'node_modules/tesseract.js-core'
core_version = json.loads((core/'package.json').read_text())['version']
package_files('tesseract.js-core',core_version,[p.name for p in core.glob('tesseract-core*')]+['LICENSE'],'tesseract/core')
package_files('@huggingface/transformers','3.8.1',[
    'dist/transformers.min.js','dist/ort-wasm-simd-threaded.jsep.mjs',
    'dist/ort-wasm-simd-threaded.jsep.wasm','LICENSE'],'transformers')
for language in ['fra','deu']:
    download(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{TESS_REV}/{language}.traineddata',
             VENDOR/'tesseract/lang'/f'{language}.traineddata')
model_files = {
    'onnx/encoder_model_quantized.onnx':'2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03',
    'onnx/decoder_model_merged_quantized.onnx':'51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08',
    **{name:None for name in ['config.json','generation_config.json','preprocessor_config.json',
                            'tokenizer.json','tokenizer_config.json','special_tokens_map.json','README.md']}
}
for filename, expected in model_files.items():
    download(f'https://huggingface.co/Xenova/trocr-small-handwritten/resolve/{MODEL_REV}/{filename}',
             VENDOR/'models/Xenova/trocr-small-handwritten'/filename, expected)
manifest = {'version':1,'tesseract':'6.0.1','transformers':'3.8.1','core':core_version,
            'trocrRevision':MODEL_REV,'tessdataRevision':TESS_REV,
            'totalBytes':sum(r['bytes'] for r in records),'files':records}
(VENDOR/'ocr-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Ressources prêtes :',round(manifest['totalBytes']/1024/1024,1),'Mio. Aucune donnée utilisateur téléchargée ou envoyée.')
