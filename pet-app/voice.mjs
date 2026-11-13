async function bounded(response, max = 10 * 1024 * 1024) {
  const reader = response.body.getReader(); let total = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > max) { await reader.cancel(); throw new Error('Audio provider response too large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}
const endpoint = (base, suffix) => base.replace(/\/+$/, '').endsWith(suffix) ? base.replace(/\/+$/, '') : `${base.replace(/\/+$/, '')}${suffix}`;
const signalFor = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);

export function configuredVoice(env = process.env) {
  const asr = env.PET_ASR_BASE_URL && env.PET_ASR_API_KEY ? { transcribe: async (bytes, mime, { signal } = {}) => {
    const form = new FormData(); const extension = mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    form.append('file', new Blob([bytes], { type: mime }), `recording.${extension}`); form.append('model', env.PET_ASR_MODEL || 'whisper-1');
    const response = await fetch(endpoint(env.PET_ASR_BASE_URL, '/audio/transcriptions'), { method: 'POST', headers: { Authorization: `Bearer ${env.PET_ASR_API_KEY}` }, body: form, signal: signalFor(signal) });
    if (!response.ok) throw new Error('ASR service failed');
    const data = JSON.parse((await bounded(response, 65536)).toString());
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) throw new Error('Invalid transcription');
    return data.text.trim();
  } } : undefined;
  const tts = env.PET_TTS_BASE_URL && env.PET_TTS_API_KEY ? { synthesize: async (text, { signal } = {}) => {
    const response = await fetch(endpoint(env.PET_TTS_BASE_URL, '/audio/speech'), { method: 'POST', headers: { Authorization: `Bearer ${env.PET_TTS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.PET_TTS_MODEL || 'tts-1', voice: env.PET_TTS_VOICE || 'alloy', input: text, response_format: 'mp3' }), signal: signalFor(signal) });
    if (!response.ok) throw new Error('TTS service failed');
    return { bytes: await bounded(response), mime: 'audio/mpeg' };
  } } : undefined;
  return { asr, tts };
}
