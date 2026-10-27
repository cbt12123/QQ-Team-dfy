function relationName(relation) {
  return typeof relation === 'string' ? relation : relation.name;
}

/**
 * Parse "给妈妈发语音，说我想她了" without letting the LLM choose a recipient.
 * Only names already present in FAMILY_RELATIONS are eligible.
 */
export function parseCrossVoice(text, relations = {}) {
  const value = String(text ?? '').trim();
  if (!value || !/(语音|声音)/.test(value)) return null;
  if (!/(发|转|给).{0,10}(语音|声音)|(?:语音|声音).{0,10}(发给|转给)|转告|告诉/.test(value)) {
    return null;
  }

  const targets = Object.entries(relations)
    .map(([userId, relation]) => ({ userId: String(userId), name: relationName(relation) }))
    .filter((item) => item.name)
    .sort((a, b) => b.name.length - a.name.length);

  const target = targets.find((item) => value.includes(item.name));
  if (!target) return null;

  let content = '';
  const tell = /(?:说|告诉|转告|内容是|就说)[：:，,\s]*(.+)$/.exec(value);
  if (tell) {
    content = tell[1];
  } else {
    const index = value.indexOf(target.name);
    content = value.slice(index + target.name.length);
    content = content
      .replace(/^[，,。！!\s]*(?:发|发一条|发条|发个|一段|个)?(?:语音|声音)[，,。！!\s]*/, '')
      .replace(/^[，,。！!\s]*(?:给|帮|麻烦|让)?(?:我|她|他)?[，,\s]*/, '')
      .replace(/^[：:，,\s]*(?:说|告诉|转告|内容是|就说)[：:，,\s]*/, '');
  }

  content = content
    .replace(/^(?:她|他|一声|一下|一句)[，,\s]*/, '')
    .replace(/^[：:，,\s]+/, '')
    .replace(/[。！!，,\s]+$/, '')
    .trim();

  return {
    targetUserId: target.userId,
    targetName: target.name,
    content,
  };
}
