import importlib.util
import unittest
from pathlib import Path
from PIL import Image

SPEC = importlib.util.spec_from_file_location('pet_native_assets', Path(__file__).resolve().parents[1] / 'scripts/pet-native-assets.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class NativeAssetTests(unittest.TestCase):
    def test_union_crop_keeps_motion_on_both_edges_and_transparency(self):
        left = Image.new('RGBA', (64, 36))
        left.paste((0, 100, 200, 255), (1, 5, 11, 25))
        right = Image.new('RGBA', (64, 36))
        right.paste((200, 100, 0, 255), (50, 6, 63, 26))
        left.putpixel((0, 0), (0, 0, 0, 3))  # VP9 alpha noise must not shrink the actual character to a tiny sprite.
        frames, bounds = module.normalize_frames([left, right], cell=64)
        self.assertEqual(bounds, (1, 5, 63, 26))
        self.assertTrue(all(frame.size == (64, 64) for frame in frames))
        self.assertEqual(frames[0].getpixel((0, 0))[3], 0)
        self.assertGreater(frames[0].getchannel('A').getbbox()[0], 0)
        self.assertLess(frames[1].getchannel('A').getbbox()[2], 64)

    def test_atlas_preserves_order_and_never_allocates_unbounded_pages(self):
        frames = [Image.new('RGBA', (16, 16), (i, 0, 0, 255)) for i in range(18)]
        pages, entries = module.pack_atlases(frames, columns=4, rows=4)
        self.assertEqual(len(pages), 2)
        self.assertEqual(len(entries), 18)
        self.assertEqual(entries[16], {'page': 1, 'rect': [0, 0, 16, 16]})
        self.assertEqual(pages[1].getpixel((17, 1))[0], 17)

    def test_empty_or_fully_opaque_video_is_not_accepted_as_transparent_pet(self):
        with self.assertRaises(ValueError):
            module.normalize_frames([])
        with self.assertRaises(ValueError):
            module.normalize_frames([Image.new('RGBA', (64, 36), (1, 2, 3, 255))])
        with self.assertRaises(ValueError):
            module.normalize_frames([Image.new('RGBA', (64, 36))])


if __name__ == '__main__':
    unittest.main()
