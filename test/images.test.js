import test from 'node:test';
import assert from 'node:assert/strict';
import { collectImageUrls, ImageService } from '../src/images/image-service.js';
import { ImageGenerator } from '../src/images/image-generator.js';
import { silentLogger } from '../src/logger.js';

test('collectImageUrls supports array and CQ-string images', () => {
  assert.deepEqual(
    collectImageUrls([
      { type: 'image', data: { url: 'https://example.com/a.jpg' } },
      { type: 'text', data: { text: 'hi' } },
    ]),
    ['https://example.com/a.jpg'],
  );
  assert.deepEqual(
    collectImageUrls('[CQ:image,file=abc,url=https://example.com/b.png]'),
    ['https://example.com/b.png'],
  );
});

test('ImageService downloads an image and returns a data URL', async () => {
  const service = new ImageService({
    logger: silentLogger,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      async arrayBuffer() {
        return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      },
    }),
  });
  const [dataUrl] = await service.prepare(['https://example.com/a.jpg']);
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);
});

test('ImageGenerator detects drawing requests and builds a Pollinations URL', () => {
  const generator = new ImageGenerator({
    logger: silentLogger,
    width: 512,
    height: 512,
  });
  assert.equal(generator.shouldGenerate('帮我画一只在西安吃泡馍的猫'), true);
  assert.equal(generator.shouldGenerate('这张图片里是什么'), false);
  assert.equal(generator.buildPrompt('帮我画一只在西安吃泡馍的猫'), '在西安吃泡馍的猫');
  const url = generator.generate('画一张赛博朋克风格的西安城墙');
  assert.match(url, /^https:\/\/image\.pollinations\.ai\/prompt\//);
  assert.match(url, /width=512/);
});
