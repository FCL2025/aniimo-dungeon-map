"""Package the mobile interaction mockup as one offline HTML file (not an APK)."""
import base64
import json
import mimetypes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app'
FRONTEND = APP / 'frontend'


def build():
    data_path = FRONTEND / 'data.js'
    if not data_path.is_file():
        raise SystemExit('Missing app/frontend/data.js. Run scripts/prepare_portable.py first.')
    source = data_path.read_text(encoding='utf-8')
    data = json.loads(source.removeprefix('window.DUNGEON_DATA=').removesuffix(';'))
    # No recognition, capture, tracking workers, or OpenCV in the mobile preview.
    for record in data['maps']:
        record.pop('routes', None)
    paths = {m['image'] for m in data['maps']}
    paths.update(asset['image'] for asset in data['icons']['assets'].values())
    assets = {}
    for path in sorted(paths):
        asset = (FRONTEND / path).resolve()
        if not asset.is_relative_to(FRONTEND.resolve()):
            raise ValueError(f'Invalid asset path: {path}')
        mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        assets[path] = f'data:{mime};base64,' + base64.b64encode(asset.read_bytes()).decode('ascii')
    html = (APP / 'mobile-preview.html').read_text(encoding='utf-8')
    css = (APP / 'mobile-preview.css').read_text(encoding='utf-8')
    css = css.replace('frontend/maps/20034.png', assets['maps/20034.png'])
    html = html.replace('<link rel="stylesheet" href="mobile-preview.css">', f'<style>{css}</style>')
    html = html.replace('frontend/icons/Img_Map_Mark_GrabEgg_Lair.png', assets['icons/Img_Map_Mark_GrabEgg_Lair.png'])
    payload = 'window.DUNGEON_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
    payload += 'window.MOBILE_PREVIEW_ASSETS=' + json.dumps(assets, separators=(',', ':')) + ';'
    html = html.replace('<script src="frontend/data.js"></script>', '<script>' + payload.replace('</', '<\\/') + '</script>')
    for name in ('manual-map-core.js', 'mobile-preview.js'):
        code = (APP / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
        html = html.replace(f'<script src="{name}"></script>', f'<script>{code}</script>')
    output = ROOT / 'dist/mobile-preview/手機浮窗互動預覽.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding='utf-8')
    print(output)
    print(f'{len(data["maps"])} maps, {len(assets)} assets; {output.stat().st_size:,} bytes; no external requests required')


if __name__ == '__main__':
    build()
