const CQ_ENTITY_MAP = {
  '&#91;': '[',
  '&#93;': ']',
  '&#44;': ',',
  '&amp;': '&',
};

const SEGMENT_LABELS = {
  image: '[图片]',
  record: '[语音]',
  video: '[视频]',
  file: '[文件]',
  json: '[卡片]',
  xml: '[卡片]',
  forward: '[聊天记录]',
  mface: '[表情]',
  markdown: '[Markdown]',
};

export function decodeCqText(value) {
  return String(value ?? '').replace(/&#91;|&#93;|&#44;|&amp;/g, (entity) => CQ_ENTITY_MAP[entity]);
}

export function encodeCqText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/,/g, '&#44;');
}

function parseCqParams(raw) {
  const params = {};
  if (!raw) return params;
  for (const item of raw.split(',')) {
    if (!item) continue;
    const equals = item.indexOf('=');
    if (equals < 0) continue;
    const key = item.slice(0, equals).trim();
    params[key] = decodeCqText(item.slice(equals + 1));
  }
  return params;
}

function appendAt(parts, params, selfId, state) {
  const qq = String(params.qq ?? '');
  if (qq === String(selfId)) {
    state.mentioned = true;
    return;
  }
  if (qq === 'all') return;
  parts.push(`@${params.name || qq} `);
}

function parseCqString(source, selfId, state) {
  const parts = [];
  const input = String(source ?? '');
  const regex = /\[CQ:([a-zA-Z0-9_]+)((?:,[^\]]*)?)\]/g;
  let lastIndex = 0;

  for (let match = regex.exec(input); match; match = regex.exec(input)) {
    parts.push(decodeCqText(input.slice(lastIndex, match.index)));
    const type = match[1];
    const params = parseCqParams(match[2]?.replace(/^,/, ''));

    if (type === 'at') appendAt(parts, params, selfId, state);
    else if (type === 'text') parts.push(decodeCqText(params.text ?? ''));
    else if (type === 'face' || type === 'reply') {
      // 表情和引用回复不送入模型，避免无关噪音。
    } else if (SEGMENT_LABELS[type]) parts.push(SEGMENT_LABELS[type]);

    lastIndex = match.index + match[0].length;
  }

  parts.push(decodeCqText(input.slice(lastIndex)));
  return parts;
}

function analyzeArrayMessage(message, selfId) {
  const parts = [];
  const state = { mentioned: false };

  for (const segment of message) {
    if (!segment || typeof segment !== 'object') continue;
    const type = segment.type;
    const data = segment.data ?? {};

    if (type === 'at') appendAt(parts, data, selfId, state);
    else if (type === 'text') parts.push(String(data.text ?? ''));
    else if (type === 'face' || type === 'reply' || type === 'poke') {
      // 这些段没有可读文本。
    } else if (type === 'markdown') {
      parts.push(String(data.content ?? '[Markdown]'));
    } else if (SEGMENT_LABELS[type]) {
      parts.push(SEGMENT_LABELS[type]);
    }
  }

  return { parts, mentioned: state.mentioned };
}

/**
 * Convert a OneBot 11 group message into text and check whether this bot was
 * mentioned. Supports both array-form segments and raw CQ-code strings.
 */
export function analyzeOneBotMessage(event, selfId = event?.self_id) {
  const state = { mentioned: false };
  let parts;

  if (Array.isArray(event?.message)) {
    const result = analyzeArrayMessage(event.message, selfId);
    parts = result.parts;
    state.mentioned = result.mentioned;
  } else {
    parts = parseCqString(event?.raw_message ?? event?.message ?? '', selfId, state);
  }

  const messageText = parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { mentioned: state.mentioned, text: messageText };
}

export function truncateText(input, maxChars) {
  const chars = Array.from(String(input ?? ''));
  if (chars.length <= maxChars) return chars.join('');
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

/**
 * Split a long answer into chat-sized chunks, preferring paragraph and
 * sentence boundaries. The final chunk is truncated with an ellipsis.
 */
export function splitText(input, limit = 1200, maxParts = 4) {
  const text = String(input ?? '').trim();
  if (!text) return [];

  const chars = Array.from(text);
  if (chars.length <= limit) return [text];

  const parts = [];
  let rest = chars;
  const minimumCut = Math.floor(limit * 0.55);

  while (rest.length > 0 && parts.length < maxParts) {
    if (rest.length <= limit) {
      parts.push(rest.join('').trim());
      rest = [];
      break;
    }

    if (parts.length === maxParts - 1) {
      parts.push(`${rest.slice(0, Math.max(1, limit - 1)).join('').trimEnd()}…`);
      rest = [];
      break;
    }

    let cut = limit;
    const window = rest.slice(0, limit);

    for (let index = window.length - 1; index >= minimumCut; index -= 1) {
      if (window[index] === '\n') {
        cut = index + 1;
        break;
      }
    }

    if (cut === limit) {
      for (let index = window.length - 1; index >= minimumCut; index -= 1) {
        if ('。！？；.!?;'.includes(window[index])) {
          cut = index + 1;
          break;
        }
      }
    }

    parts.push(rest.slice(0, cut).join('').trim());
    rest = rest.slice(cut);
    while (rest[0] === '\n' || rest[0] === ' ' || rest[0] === '\t') rest.shift();
  }

  return parts.filter(Boolean);
}
