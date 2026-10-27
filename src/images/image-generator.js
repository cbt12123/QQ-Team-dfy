export class ImageGenerator {
  constructor({
    enabled = true,
    baseUrl = 'https://image.pollinations.ai/prompt',
    width = 1024,
    height = 1024,
    model = '',
    logger,
  } = {}) {
    this.enabled = enabled;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.width = width;
    this.height = height;
    this.model = model;
    this.logger = logger;
  }

  shouldGenerate(text) {
    const value = String(text ?? '').trim();
    if (!this.enabled || value.length < 4) return false;
    if (/(识别|描述|看看|读一下|分析).{0,6}(图|图片|照片)/.test(value)) return false;
    return /(?:画|绘制|生成|做)(?:一张|一幅|一个|一只|个|张|幅|只)?(?:图|图片|插画|海报|头像|壁纸)|(?:画|绘制)(?:一张|一幅|一个|一只|个|张|幅|只)|来一张|画一张|画个|画只/.test(
      value,
    );
  }

  buildPrompt(text) {
    const original = String(text ?? '').trim();
    const cleaned = original
      .replace(/^(?:@\S+\s*)+/u, '')
      .replace(/^(?:帮我|请|麻烦|给我|能不能|可以)\s*/u, '')
      .replace(/^(?:画|绘制|生成|做)(?:一张|一幅|一个|一只|个|张|幅|只)?/u, '')
      .replace(/^(?:图片|图|插画|海报|头像|壁纸)/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    return (cleaned || original).slice(0, 300);
  }

  url(prompt) {
    const params = new URLSearchParams({
      width: String(this.width),
      height: String(this.height),
      nologo: 'true',
    });
    if (this.model) params.set('model', this.model);
    return `${this.baseUrl}/${encodeURIComponent(prompt)}?${params.toString()}`;
  }

  generate(text) {
    if (!this.shouldGenerate(text)) return null;
    return this.url(this.buildPrompt(text));
  }
}
