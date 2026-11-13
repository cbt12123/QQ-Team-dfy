const FIELDS = ['opening', 'personal_voice', 'continuation'];
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Incrementally decode the ordered, flat spoken-reply JSON object. */
export class SpokenReplyDecoder {
  constructor(onText) {
    if (typeof onText !== 'function') throw new TypeError('onText must be a function');
    this.onText = onText;
    this.buffer = '';
    this.state = 'start';
    this.lastField = -1;
    this.output = '';
    this.finished = false;
  }

  fail() { throw new Error('Invalid spoken reply JSON'); }

  feed(chunk) {
    if (this.finished || typeof chunk !== 'string') this.fail();
    if (this.buffer.length + chunk.length > 65536) throw new Error('Spoken reply JSON exceeds 64 KB');
    this.buffer += chunk;
    for (const char of chunk) this.consume(char);
  }

  consume(char) {
    if (this.state === 'string') {
      if (this.unicode !== null) {
        if (!/^[0-9a-f]$/i.test(char)) this.fail();
        this.unicode += char;
        if (this.unicode.length === 4) {
          const decoded = String.fromCharCode(parseInt(this.unicode, 16));
          this.unicode = null;
          this.decoded(decoded);
        }
      } else if (this.escape) {
        this.escape = false;
        if (char === 'u') this.unicode = '';
        else if (Object.hasOwn(ESCAPES, char)) this.decoded(ESCAPES[char]);
        else this.fail();
      } else if (char === '\\') this.escape = true;
      else if (char === '"') {
        if (this.highSurrogate) this.fail();
        if (this.stringKind === 'key') {
          const index = FIELDS.indexOf(this.token);
          if (index < 0 || index <= this.lastField) this.fail();
          this.lastField = index;
          this.key = this.token;
          this.state = 'colon';
        } else {
          if (this.key === 'personal_voice') {
            if (!this.token.trim()) this.fail();
            this.hasPersonalVoice = true;
          }
          this.state = 'afterValue';
        }
      } else {
        if (char.charCodeAt(0) < 32) this.fail();
        this.decoded(char);
      }
      return;
    }
    if (/^[\x20\t\r\n]$/.test(char)) return;
    switch (this.state) {
      case 'start':
        if (char !== '{') this.fail();
        this.state = 'firstKey';
        break;
      case 'firstKey':
        if (char === '}') { this.state = 'done'; break; }
        // fall through
      case 'key':
        if (char !== '"') this.fail();
        this.beginString('key');
        break;
      case 'colon':
        if (char !== ':') this.fail();
        this.state = 'value';
        break;
      case 'value':
        if (char !== '"') this.fail();
        this.beginString('value');
        break;
      case 'afterValue':
        if (char === '}') this.state = 'done';
        else if (char === ',') this.state = 'key';
        else this.fail();
        break;
      default: this.fail();
    }
  }

  beginString(kind) {
    this.state = 'string';
    this.stringKind = kind;
    this.token = '';
    this.escape = false;
    this.unicode = null;
    this.highSurrogate = '';
    this.fieldStarted = false;
  }

  decoded(text) {
    // Iterate UTF-16 units: keep a high surrogate until its low surrogate arrives.
    for (let i = 0; i < text.length; i++) {
      const unit = text[i];
      const code = unit.charCodeAt(0);
      if (this.highSurrogate) {
        if (code < 0xDC00 || code > 0xDFFF) this.fail();
        this.append(this.highSurrogate + unit);
        this.highSurrogate = '';
      } else if (code >= 0xD800 && code <= 0xDBFF) this.highSurrogate = unit;
      else if (code >= 0xDC00 && code <= 0xDFFF) this.fail();
      else this.append(unit);
    }
  }

  append(text) {
    this.token += text;
    if (this.stringKind !== 'value') return;
    const addition = (!this.fieldStarted && this.output ? '\n\n' : '') + text;
    if (this.output.length + addition.length > 8000) throw new Error('Spoken reply exceeds 8000 characters');
    this.fieldStarted = true;
    this.output += addition;
    this.onText(addition);
  }

  finish() {
    if (this.finished || this.state !== 'done' || !this.hasPersonalVoice) this.fail();
    JSON.parse(this.buffer);
    this.finished = true;
    return this.output;
  }
}
