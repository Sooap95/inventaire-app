"""Distribution réservée aux tests : jamais le ZIP niveau 2."""
from pathlib import Path
import shutil,subprocess,json,hashlib
from build_family_lab import build as family_build
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'dist/preprod-emulator-test'
def build():
    family_build();shutil.copytree(ROOT/'dist/family-lab',DEST,dirs_exist_ok=True)
    subprocess.run(['node',str(ROOT/'security/scripts/build-preprod-bundle.mjs'),'--emulator-test'],cwd=ROOT,check=True)
    shutil.copy2(DEST/'src/preprod/preprod.bundle.js',DEST/'src/family/family-lab.bundle.js')
    text=(DEST/'index.html').read_text().replace('<title>Inventaire Maison</title>','<title>PRÉPRODUCTION — ÉMULATEURS LOCAUX</title>');(DEST/'index.html').write_text(text)
    assets=['./','./index.html','./manifest.json']+['./'+str(p.relative_to(DEST)) for p in (DEST/'src').rglob('*') if p.is_file() and p.suffix in ['.js','.css']]
    identity=hashlib.sha256((DEST/'src/family/family-lab.bundle.js').read_bytes()).hexdigest()
    worker=(DEST/'sw.js').read_text();start=worker.index("self.addEventListener('install'");worker="const CACHE='inventaire-preprod-emulator-test-"+identity+"';const CORE="+json.dumps(assets)+";\n"+worker[start:];worker=worker.replace("startsWith('inventaire-family-lab-')","startsWith('inventaire-preprod-emulator-test-')");(DEST/'sw.js').write_text(worker)
if __name__=='__main__':build()
