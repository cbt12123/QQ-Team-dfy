import { analyzeOneBotMessage, decodeCqText, truncateText } from './text.js';

/**
 * Find merged-forward message IDs in either array-form or CQ-string form.
 */
export function collectForwardIds(message, max = 3) {
  const ids = [];

  if (Array.isArray(message)) {
    for (const segment of message) {
      if (segment?.type !== 'forward') continue;
      const id = segment.data?.id ?? segment.data?.message_id;
      if (id) ids.push(String(id));
    }
  } else {
    const input = String(message ?? '');
    const regex = /\[CQ:forward,([^\]]*)\]/g;
    for (let match = regex.exec(input); match; match = regex.exec(input)) {
      for (const part of match[1].split(',')) {
        const equals = part.indexOf('=');
        if (equals < 0) continue;
        if (part.slice(0, equals) === 'id') {
          ids.push(decodeCqText(part.slice(equals + 1)));
        }
      }
    }
  }

  return [...new Set(ids.filter(Boolean))].slice(0, max);
}

/**
 * Find message IDs referenced by reply/quote segments. A user often replies to
 * a forwarded chat record and then @s the bot; the forward itself is not part
 * of the current message.
 */
export function collectReplyIds(message, max = 2) {
  const ids = [];

  if (Array.isArray(message)) {
    for (const segment of message) {
      if (segment?.type !== 'reply') continue;
      const id = segment.data?.id ?? segment.data?.message_id;
      if (id) ids.push(String(id));
    }
  } else {
    const input = String(message ?? '');
    const regex = /\[CQ:reply,([^\]]*)\]/g;
    for (let match = regex.exec(input); match; match = regex.exec(input)) {
      for (const part of match[1].split(',')) {
        const equals = part.indexOf('=');
        if (equals < 0) continue;
        if (part.slice(0, equals) === 'id') {
          ids.push(decodeCqText(part.slice(equals + 1)));
        }
      }
    }
  }

  return [...new Set(ids.filter(Boolean))].slice(0, max);
}

/**
 * Turn the `get_forward_msg` response into a compact text block suitable for
 * the model. Forwarded content is untrusted chat data, never instructions.
 */
export function formatForwardMessages(messages, { maxMessages = 60, maxChars = 6000 } = {}) {
  if (!Array.isArray(messages) || !messages.length) return '';

  const lines = [];
  let chars = 0;
  let truncated = false;

  for (const item of messages) {
    if (lines.length >= maxMessages) {
      truncated = true;
      break;
    }

    const name = String(item?.sender?.card || item?.sender?.nickname || item?.sender?.user_id || '群友');
    let body = '';
    if (Array.isArray(item?.message)) {
      body = analyzeOneBotMessage({ message: item.message, self_id: null }).text;
    } else if (typeof item?.message === 'string') {
      body = analyzeOneBotMessage({ message: item.message, self_id: null }).text;
    } else if (typeof item?.raw_message === 'string') {
      body = analyzeOneBotMessage({ raw_message: item.raw_message, self_id: null }).text;
    }

    body = body.replace(/\s+/g, ' ').trim();
    if (!body) continue;

    const line = `${name}: ${truncateText(body, 500)}`;
    if (chars + line.length > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }

  if (!lines.length) return '';

  const header = truncated
    ? `[转发聊天记录，共 ${messages.length} 条，已截断]`
    : `[转发聊天记录，共 ${messages.length} 条]`;
  return `${header}\n${lines.join('\n')}`;
}
