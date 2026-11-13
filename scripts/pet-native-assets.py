"""Convert attributed alpha WebM actions to bounded sprite atlases, never video UI."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image


def normalize_frames(frames, cell=256):
    if not frames:
        raise ValueError('No decoded animation frames')
    bounds = None
    for frame in frames:
        alpha = frame.getchannel('A')
        if alpha.getextrema()[0] == 255:
            raise ValueError('Alpha channel was lost during decoding')
        box = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
        if box:
            bounds = box if bounds is None else (min(bounds[0], box[0]), min(bounds[1], box[1]), max(bounds[2], box[2]), max(bounds[3], box[3]))
    if bounds is None:
        raise ValueError('Animation is fully transparent')
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    ratio = (cell - 12) / max(width, height)
    size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
    result = []
    for frame in frames:
        image = Image.new('RGBA', (cell, cell))
        content = frame.crop(bounds).resize(size, Image.Resampling.LANCZOS)
        image.alpha_composite(content, ((cell - size[0]) // 2, (cell - size[1]) // 2))
        result.append(image)
    return result, bounds


def pack_atlases(frames, columns=4, rows=4):
    if not frames or columns < 1 or rows < 1:
        raise ValueError('Invalid atlas parameters')
    cell = frames[0].width
    capacity = columns * rows
    pages = [Image.new('RGBA', (cell * columns, cell * rows)) for _ in range(math.ceil(len(frames) / capacity))]
    entries = []
    for index, frame in enumerate(frames):
        if frame.size != (cell, cell):
            raise ValueError('All frames must have the same square size')
        page, slot = divmod(index, capacity)
        x, y = (slot % columns) * cell, (slot // columns) * cell
        pages[page].alpha_composite(frame, (x, y))
        entries.append({'page': page, 'rect': [x, y, cell, cell]})
    return pages, entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frames', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    selected = json.loads(args.manifest.read_text(encoding='utf-8'))
    output = []
    for action in selected:
        source = sorted((args.frames / action['key']).glob('*.png'))
        decoded = [Image.open(path).convert('RGBA') for path in source]
        normalized, bounds = normalize_frames(decoded)
        pages, entries = pack_atlases(normalized)
        directory = args.output / action['key']
        directory.mkdir(parents=True, exist_ok=True)
        names = []
        for index, page in enumerate(pages):
            name = f'page_{index:03d}.png'
            page.save(directory / name, optimize=True)
            names.append(f"res://assets/frames/{action['key']}/{name}")
        output.append({**action, 'fps': 12, 'pages': names, 'frames': entries, 'source_bounds': list(bounds)})
        print(action['key'], len(entries), 'frames,', len(pages), 'atlases; alpha verified', flush=True)
    (args.output.parent / 'actions.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
