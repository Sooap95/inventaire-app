"""Origine de production simulée : aucun accès réel à GitHub Pages."""
from pathlib import Path
from urllib.parse import urlsplit
import argparse
from playwright.sync_api import sync_playwright

def run(site):
    root=Path(site).resolve();seen=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context()
        def route(r):
            seen.append(r.request.url)
            path=urlsplit(r.request.url).path
            target=root/'index.html' if path=='/' else root/path.lstrip('/')
            assert target.resolve().is_relative_to(root)
            if target.exists():r.fulfill(path=str(target))
            else:r.fulfill(status=404,body='absent')
        context.route('**/*',route)
        page=context.new_page();page.goto('https://sooap95.github.io/')
        page.wait_for_function("() => document.body.textContent.includes('Origine de production interdite')")
        assert not any(url.endswith('/app.js') or url.endswith('/sw.js') for url in seen)
        assert page.evaluate('navigator.serviceWorker.getRegistrations().then(a=>a.length)')==0
        browser.close()
    print('PASS : origine de production simulée refusée, application et SW non chargés, zéro requête réseau réelle')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');args=parser.parse_args();run(args.directory)
