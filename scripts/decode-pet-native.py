"""Run in WSL where the existing alpha-capable FFmpeg is installed."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'pet-native/action_sources.json').read_text())
for action in manifest:
    output = root / '.cache/pet-native-frames' / action['key']
    output.mkdir(parents=True, exist_ok=True)
    source = root / 'pet-app/public/assets' / action['file']
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(source),
                    '-vf', 'fps=12', '-pix_fmt', 'rgba', '-y', str(output / 'frame_%04d.png')], check=True)
    print(action['key'], len(list(output.glob('*.png'))), 'decoded RGBA frames', flush=True)
