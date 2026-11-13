import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1]
out = root / 'pet-native/assets/fonts'
out.mkdir(parents=True, exist_ok=True)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Dafeyu-native-build'}), timeout=120) as response:
        return response.read()


metadata = json.loads(get('https://api.github.com/repos/notofonts/noto-cjk/contents/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'))
font = get(metadata['download_url'])
digest = hashlib.sha1(f'blob {len(font)}\0'.encode() + font).hexdigest()
if digest != metadata['sha'] or font[:4] != b'OTTO':
    raise ValueError('Font integrity mismatch')
(out / 'NotoSansCJKsc-Regular.otf').write_bytes(font)
license_text = get('https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE')
if b'SIL OPEN FONT LICENSE' not in license_text:
    raise ValueError('Expected OFL license not found')
(out / 'OFL.txt').write_bytes(license_text)
(out / 'source.json').write_text(json.dumps({'source': metadata['html_url'], 'blob_sha': digest, 'license': 'SIL-OFL-1.1'}, indent=2) + '\n')
print('Chinese font verified; SIL OFL license retained', len(font), 'bytes', flush=True)
