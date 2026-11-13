"""Portable, checksum-verified Godot setup. Fetch only Android entries from the template ZIP."""
import hashlib
import io
import json
import os
from pathlib import Path
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'pet-godot'
VERSION = '4.7.2-stable'


def request(url, headers=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Dafeyu-native-build', **(headers or {})}), timeout=120)


def download(asset):
    target = CACHE / asset['name']
    expected = asset.get('digest', '').removeprefix('sha256:')
    if not target.exists() or target.stat().st_size != asset['size'] or (expected and hashlib.sha256(target.read_bytes()).hexdigest() != expected):
        print('Downloading', asset['name'], flush=True)
        temporary = target.with_suffix(target.suffix + '.partial')
        with request(asset['browser_download_url']) as response, temporary.open('wb') as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        if temporary.stat().st_size != asset['size'] or (expected and hashlib.sha256(temporary.read_bytes()).hexdigest() != expected):
            raise ValueError('Official asset checksum mismatch')
        temporary.replace(target)
    if target.suffix == '.zip':
        with zipfile.ZipFile(target) as archive:
            for name in archive.namelist():
                if '/' not in name and ('win64' in name or 'linux.x86_64' in name):
                    output = CACHE / name
                    output.write_bytes(archive.read(name))
                    if name.endswith('x86_64'):
                        output.chmod(0o755)
    print('Verified', asset['name'], flush=True)


class RemoteZip(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.position = url, size, 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position

    def read(self, length=-1):
        if self.position >= self.size:
            return b''
        length = self.size - self.position if length < 0 else min(length, self.size - self.position)
        if length == 0:
            return b''
        start, end = self.position, self.position + length - 1
        with request(self.url, {'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'}) as response:
            if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                raise RuntimeError('Release server did not honor byte ranges; refusing full 1.2GB template download')
            value = response.read(length + 1)
        if len(value) != length:
            raise RuntimeError('Truncated ZIP range')
        self.position += length
        return value


def android_templates(asset):
    templates = CACHE / 'templates'
    templates.mkdir(exist_ok=True)
    needed = ['android_debug.apk', 'android_release.apk', 'version.txt']
    if all((templates / name).exists() for name in needed):
        print('Android templates already available', flush=True)
        return
    print('Reading official template ZIP directory (partial download)', flush=True)
    with zipfile.ZipFile(RemoteZip(asset['browser_download_url'], asset['size'])) as archive:
        for filename in needed:
            entry = next(info for info in archive.infolist() if info.filename == 'templates/' + filename)
            payload = archive.read(entry)  # ZipFile verifies the upstream entry CRC.
            (templates / filename).write_bytes(payload)
            print('Extracted', filename, len(payload), 'bytes; CRC verified', flush=True)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    with request(f'https://api.github.com/repos/godotengine/godot-builds/releases/tags/{VERSION}') as response:
        release = json.load(response)
    wanted = [f'Godot_v{VERSION}_win64.exe.zip', f'Godot_v{VERSION}_linux.x86_64.zip']
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks = [pool.submit(download, asset) for asset in release['assets'] if asset['name'] in wanted]
        tasks.append(pool.submit(android_templates, next(a for a in release['assets'] if a['name'] == f'Godot_v{VERSION}_export_templates.tpz')))
        for task in tasks:
            task.result()
    print('GODOT_TOOLS_READY', flush=True)


if __name__ == '__main__':
    main()
