"""Private A3 lot; no endpoint access or public deployment."""
from pathlib import Path
import hashlib,json,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
def build():
 approval=json.loads((ROOT/'config/preprod/a3-device-release.json').read_text())
 assert approval['A3Authorized'] is True and approval['enabledSlots']==['A'] and approval['costTargetCHF']==0
 assert not subprocess.check_output(['git','status','--porcelain','--','scripts/preprod_devices.py','scripts/check_preprod_cloud_shell.py','config/preprod/a3-device-release.json'],cwd=ROOT),'Commit the tested sources before issuing the lot'
 sources={'preprod_devices.py':ROOT/'scripts/preprod_devices.py','check_preprod_cloud_shell.py':ROOT/'scripts/check_preprod_cloud_shell.py','autorisation-a3.json':ROOT/'config/preprod/a3-device-release.json'}
 manifest={'format':'inventaire-a3-package','version':1,'scope':'A3','projectId':approval['projectId'],'projectNumber':approval['projectNumber'],'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':{name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in sources.items()}}
 raw=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();digest=hashlib.sha256(raw).hexdigest();directory='inventaire-a3-'+digest[:10]
 launcher='from pathlib import Path\nimport os,subprocess,sys\nos.chdir(Path(__file__).resolve().parent)\nsubprocess.run([sys.executable,"preprod_devices.py","--package-sha","'+digest+'",*sys.argv[1:]],check=True)\n'
 guide='A3 — AUTORISER LE PROFIL SAFARI DE L\'IPHONE\n\nSite : https://inventaire-maison-v02-recette-sync.pages.dev/\nDans Safari, toucher Identifier ce profil une seule fois. Attendre l\'identifiant et l\'attente d\'autorisation. Garder le meme Safari pour la recette.\n\nImporter ce ZIP dans Cloud Shell, puis executer :\nunzip -n Inventaire-Maison-A3-iPhone-CloudShell.zip -d '+directory+'\ncd '+directory+'\npython3 EXECUTER-A3.py\n\nChoisir 1 (autoriser), puis A. Coller l\'identifiant copie depuis Safari : la saisie est masquee, c\'est normal. Verifier les six derniers caracteres et taper CONFIRMER.\nNe pas transmettre le plan prive ou l\'identifiant dans le chat. Le fichier resultat-a3-*.json ne contient pas d\'identifiant et peut etre transmis si necessaire.\n\nRevenir dans le meme onglet Safari. Les quatre produits fictifs doivent apparaitre. Si necessaire, actualiser une fois ou utiliser Reessayer la connexion.\nVerifier Lait 1 L, Beurre 0 article, Aptamil 0 boite, oeufs 0 boite avant les essais.\nFaire + puis - sur Lait : 2 puis 1 sans confirmation. Les coches ne changent pas le stock.\n\nRevoquer : relancer EXECUTER-A3.py, choisir 2 puis A, verifier puis CONFIRMER. Reautoriser le meme profil : 1 puis A.\nEn cas de reponse perdue, conserver plan-a3-*.json et reprendre exactement ce plan :\npython3 EXECUTER-A3.py --resume NOM_DU_PLAN.json\nUn plan non confirme ou devenu perime ne sera pas applique.\n\nAucun produit, stock, regle, index ou compte Auth n\'est modifie par cet outil. Il ne modifie que members pour le profil confirme, dans la preproduction gratuite. Aucun changement Pages requis.\n\nAndroid et synchronisation sur deux appareils : en attente d\'un second appareil. Le profil B est volontairement desactive dans ce lot. Safari, Brave et PWA peuvent avoir des identites distinctes.\n'
 dest=ROOT/'artifacts/Inventaire-Maison-A3-iPhone-CloudShell.zip'
 with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for name,p in sources.items():z.write(p,name)
  z.writestr('manifest-a3.json',raw);z.writestr('EXECUTER-A3.py',launcher);z.writestr('LANCER-A3.txt',guide)
 (ROOT/'artifacts/LANCER-A3.txt').write_text(guide)
 print('Lot A3 prive prepare ; aucun appel cloud. Manifeste : '+digest)
if __name__=='__main__':build()
