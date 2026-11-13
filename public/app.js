import { PetActions } from './actions.js';

const $ = id => document.getElementById(id);
let user = null, capabilities = {}, epoch = 0, registering = false, sending = false, pet, assets = [], currentAudio, audioUrl, installPrompt;
let recorder, recordingStream, recordingTimer, cancelRecording = false, reducedTimer, holdingRecord = false;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dafeyu-account') : null;
const show = (id, visible) => { $(id).hidden = !visible; };
const error = (id, value = '') => { $(id).textContent = value; };
const bubble = text => { $('bubble').textContent = text; };

async function api(path, options = {}) {
  const { raw, ...init } = options;
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-Pet-Request': '1', ...(raw ? {} : init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: raw || (init.body ? JSON.stringify(init.body) : undefined),
  });
  const data = await response.json();
  if (!response.ok) { const err = Object.assign(new Error(data.error || '请求失败'), { status: response.status }); if (response.status === 401 && user) signedOut(); throw err; }
  return data;
}
function stopAudio() {
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  show('stop-audio', false); if (pet?.currentMode === 'speaking') pet.mode('idle');
}
function stopRecording(cancel = true) {
  holdingRecord = false;
  cancelRecording = cancel; clearTimeout(recordingTimer);
  if (recorder?.state === 'recording') recorder.stop();
  recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null;
  $('record').classList.remove('recording'); $('record').textContent = '🎙 按住说话';
  if (pet?.currentMode === 'listening') pet.mode('idle');
}
function signedOut() {
  epoch++; user = null; capabilities = {}; sending = false;
  stopAudio(); stopRecording(); pet?.reset();
  $('messages').replaceChildren(); $('memories').replaceChildren(); $('message-input').value = ''; $('memory-input').value = ''; $('invite-output').value = ''; $('password').value = '';
  $('account-label').textContent = ''; show('logout', false); show('auth-view', true); show('chat-view', false); show('memory-panel', false); show('admin-panel', false); show('invite-output', false);
  error('chat-error'); error('memory-error'); bubble('你好呀，欢迎来到我的小房间。');
}
function authMode(register) {
  registering = register; show('invite-label', register); show('display-label', register);
  $('login-tab').classList.toggle('selected', !register); $('register-tab').classList.toggle('selected', register);
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('invite').required = register; $('auth-title').textContent = register ? '给你留了一个位置。' : '来，坐一会儿。'; error('auth-error');
}
async function signedIn(data) {
  epoch++; user = data.user; capabilities = data.capabilities;
  $('account-label').textContent = user.displayName; show('logout', true); show('auth-view', false); show('chat-view', true); show('admin-panel', user.admin);
  $('password').value = ''; $('invite').value = '';
  bubble(`你来啦，${user.displayName}。`);
  const notes = [];
  if (!capabilities.chat) notes.push('云端对话模型尚未配置，动作和个人记忆可以先体验。');
  if (!capabilities.asr || !capabilities.tts) notes.push('部分语音能力尚未配置。');
  $('capability-note').textContent = notes.join(' '); show('capability-note', notes.length > 0);
  $('send').disabled = !capabilities.chat; $('record').disabled = !capabilities.asr;
  $('record-note').textContent = capabilities.asr ? '按住录音，松开发送识别；最多60秒。Esc 或移开手指取消。' : '语音识别尚未配置，可以使用文字。';
  await loadHistory();
}
async function loadHistory() {
  const version = epoch;
  const data = await api('/api/messages'); if (version !== epoch || !user) return;
  $('messages').replaceChildren();
  if (!data.messages.length) {
    const empty = document.createElement('p'); empty.className = 'empty-message'; empty.textContent = '这里还没有故事。\n从一句“你好”开始，也很好。'; $('messages').append(empty);
  }
  for (const message of data.messages) {
    const node = document.createElement('div'); node.className = `message ${message.role}`;
    const who = document.createElement('span'); who.className = 'message-speaker'; who.textContent = message.role === 'user' ? '你' : '大肥鱼';
    node.append(who, document.createTextNode(message.text));
    if (message.role === 'assistant' && capabilities.tts) { const button = document.createElement('button'); button.className = 'quiet'; button.textContent = '▷ 听这句'; button.addEventListener('click', () => playVoice(message.id, button)); node.append(button); }
    $('messages').append(node);
  }
  const pending = data.requests.find(x => x.state === 'pending');
  const failed = data.requests.find(x => ['failed', 'interrupted'].includes(x.state));
  if (pending) error('chat-error', '有一条消息仍在生成，稍后可刷新查看。');
  else if (failed) error('chat-error', failed.error + '（不会自动重复调用模型）');
  $('messages').scrollTop = $('messages').scrollHeight;
}
$('login-tab').addEventListener('click', () => authMode(false));
$('register-tab').addEventListener('click', () => authMode(true));
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); error('auth-error'); $('auth-submit').disabled = true;
  try {
    const body = { username: $('username').value, password: $('password').value };
    if (registering) { body.invite = $('invite').value.trim(); if ($('display-name').value.trim()) body.displayName = $('display-name').value.trim(); }
    await api(registering ? '/api/register' : '/api/login', { method: 'POST', body });
    await signedIn(await api('/api/me')); channel?.postMessage('account-changed');
  } catch (err) { error('auth-error', err.message); } finally { $('auth-submit').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); signedOut(); channel?.postMessage('account-changed'); }
  catch (err) { error('chat-error', `退出未完成：${err.message}`); }
});
channel?.addEventListener('message', () => { signedOut(); error('auth-error', '账号状态在另一个页面发生变化，请重新登录。'); });
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!user || sending) return;
  const text = $('message-input').value.trim(); if (!text) return;
  const version = epoch; sending = true; $('send').disabled = true; error('chat-error'); pet?.mode('thinking'); bubble('让我想一想…');
  try {
    const data = await api('/api/messages', { method: 'POST', body: { requestId: crypto.randomUUID(), text } });
    if (version !== epoch) return;
    $('message-input').value = ''; bubble(data.message.text.slice(0, 80)); await loadHistory();
  } catch (err) { if (version === epoch) { error('chat-error', `${err.message}。如网络中断，请先刷新查看记录。`); await loadHistory().catch(() => {}); } }
  finally { if (version === epoch) { sending = false; $('send').disabled = !capabilities.chat; pet?.mode('idle'); } }
});
$('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } });

async function loadMemories() {
  const version = epoch; const data = await api('/api/memories'); if (version !== epoch || !user) return;
  $('memories').replaceChildren();
  for (const memory of data.memories) {
    const li = document.createElement('li'), text = document.createElement('span'), button = document.createElement('button'); text.textContent = memory.text; button.textContent = '忘记'; button.className = 'quiet';
    button.addEventListener('click', async () => { if (!confirm('忘记这条记忆并清空聊天上下文？')) return; try { await api(`/api/memories/${memory.id}`, { method: 'DELETE' }); if (version === epoch) { await loadMemories(); await loadHistory(); } } catch (err) { error('memory-error', err.message); } });
    li.append(text, button); $('memories').append(li);
  }
  if (!data.memories.length) { const li = document.createElement('li'); li.textContent = '暂时还没有记忆，你可以慢慢告诉我。'; $('memories').append(li); }
}
$('open-memory').addEventListener('click', async () => { show('memory-panel', true); try { await loadMemories(); $('memory-panel').scrollIntoView({ behavior: 'smooth' }); } catch (err) { error('memory-error', err.message); } });
$('close-memory').addEventListener('click', () => show('memory-panel', false));
$('memory-form').addEventListener('submit', async event => { event.preventDefault(); const version = epoch; try { await api('/api/memories', { method: 'POST', body: { text: $('memory-input').value } }); if (version === epoch) { $('memory-input').value = ''; await loadMemories(); } } catch (err) { error('memory-error', err.message); } });
for (const [id, endpoint, warning] of [['clear-history', '/api/history', '清空聊天记录？长期记忆会保留。'], ['clear-memory', '/api/memories', '忘记全部记忆并清空聊天记录？此操作不能撤销。']]) {
  $(id).addEventListener('click', async () => { if (!confirm(warning)) return; const version = epoch; try { await api(endpoint, { method: 'DELETE' }); if (version === epoch) { stopAudio(); await loadHistory(); await loadMemories(); bubble('已经替你整理好了。'); } } catch (err) { error('memory-error', err.message); } });
}
$('export-data').addEventListener('click', async () => { const version = epoch; try { const data = await api('/api/export'); if (version !== epoch) return; const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = '我的大肥鱼记录.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (err) { error('memory-error', err.message); } });
$('create-invite').addEventListener('click', async () => { const version = epoch; try { const data = await api('/api/invites', { method: 'POST', body: {} }); if (version !== epoch) return; const url = new URL('/', location.origin); url.hash = `invite=${encodeURIComponent(data.invite)}`; $('invite-output').value = url.href; show('invite-output', true); } catch (err) { error('invite-error', err.message); } });

function renderActions(filter = '') {
  $('action-list').replaceChildren();
  for (const action of assets.filter(a => a.label.includes(filter) && a.group !== '睡觉')) {
    const button = document.createElement('button'); button.textContent = action.label; button.addEventListener('click', () => doAction(action.id)); $('action-list').append(button);
  }
}
function doAction(id) { if (!pet?.play(id)) bubble(pet?.sleeping ? '先叫我起床吧。' : '等我听完或者说完这句，再一起玩。'); }
$('open-actions').addEventListener('click', () => { show('action-library', true); $('action-search').focus(); });
$('close-actions').addEventListener('click', () => show('action-library', false));
$('action-search').addEventListener('input', () => renderActions($('action-search').value));
document.querySelectorAll('[data-quick]').forEach(button => button.addEventListener('click', () => { const action = assets.find(a => a.label.includes(button.dataset.quick)); if (action) doAction(action.id); }));
$('pet-touch').addEventListener('click', () => { if (pet?.sleeping) pet.wake(); else { const action = assets.find(a => a.label.includes('点击回应-开心')); if (action) doAction(action.id); } });
$('sleep').addEventListener('click', () => { if (pet?.sleeping) pet.wake(); else pet?.sleep(); });
$('pet-video').addEventListener('ended', () => pet?.ended());
$('pet-video').addEventListener('error', () => { show('pet-fallback', true); show('pet-video', false); bubble('这个浏览器播放动画有点困难，仍可以和我聊天。'); });

async function playVoice(messageId, button) {
  const version = epoch; stopAudio(); button.disabled = true; button.textContent = '正在准备语音…';
  try {
    const data = await api(`/api/messages/${messageId}/audio`, { method: 'POST', body: {} }); if (version !== epoch) return;
    const response = await fetch(`/api/audio/${data.id}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('语音读取失败'); const blob = await response.blob(); if (version !== epoch) return;
    audioUrl = URL.createObjectURL(blob); currentAudio = new Audio(audioUrl); currentAudio.addEventListener('ended', stopAudio, { once: true });
    currentAudio.addEventListener('error', () => { stopAudio(); error('chat-error', '语音播放失败，文字回复仍然可用。'); }, { once: true });
    try { await currentAudio.play(); if (version !== epoch) { stopAudio(); return; } pet?.mode('speaking'); show('stop-audio', true); }
    catch { stopAudio(); throw new Error('浏览器没有允许播放，请再点一次“听这句”'); }
  } catch (err) { if (version === epoch) error('chat-error', err.message); }
  finally { button.disabled = false; button.textContent = '▷ 听这句'; }
}
$('stop-audio').addEventListener('click', stopAudio);
async function beginRecording() {
  if (!user || !capabilities.asr || recorder?.state === 'recording') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { error('chat-error', '当前浏览器无法录音，请使用 HTTPS 或支持录音的浏览器。'); return; }
  const version = epoch; cancelRecording = false; holdingRecord = true; stopAudio();
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (version !== epoch || cancelRecording || !holdingRecord) { recordingStream.getTracks().forEach(track => track.stop()); return; }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined); const chunks = []; const began = Date.now();
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      if (version !== epoch || cancelRecording || Date.now() - began < 350) return;
      const blob = new Blob(chunks, { type: recorder.mimeType }); if (blob.size > 8 * 1024 * 1024) { error('chat-error', '录音过大，请录短一些。'); return; }
      error('chat-error', '正在听你刚才说的话…');
      try { const data = await api('/api/transcribe', { method: 'POST', raw: blob, headers: { 'Content-Type': blob.type } }); if (version !== epoch) return; $('message-input').value = data.text; error('chat-error'); $('message-input').focus(); }
      catch (err) { if (version === epoch) error('chat-error', err.message); }
    });
    recorder.start(); pet?.mode('listening'); $('record').classList.add('recording'); $('record').textContent = '● 正在听，松开结束'; recordingTimer = setTimeout(() => stopRecording(false), 60000);
  } catch (err) { stopRecording(); if (version === epoch) error('chat-error', err.name === 'NotAllowedError' ? '麦克风未授权，可以继续用文字聊天。' : '无法使用麦克风，请检查设备权限。'); }
}
$('record').addEventListener('pointerdown', event => { event.preventDefault(); $('record').setPointerCapture(event.pointerId); beginRecording(); });
$('record').addEventListener('pointerup', () => stopRecording(false));
$('record').addEventListener('pointercancel', () => stopRecording());
$('record').addEventListener('keydown', event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); beginRecording(); } });
$('record').addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); stopRecording(false); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') stopRecording(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopRecording(); stopAudio(); } });

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; show('install', true); });
$('install').addEventListener('click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; show('install', false); } });
const network = () => show('network-note', !navigator.onLine);
window.addEventListener('online', network); window.addEventListener('offline', network); network();
function consumeInvitation() {
  const invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!invitation) return;
  $('invite').value = invitation; authMode(true); history.replaceState({}, '', location.pathname);
  if (user) error('chat-error', '你已登录。若要用邀请创建另一个账号，请先退出。');
}
window.addEventListener('hashchange', consumeInvitation);
consumeInvitation();
try {
  const response = await fetch('/assets/actions.json'); if (!response.ok) throw new Error();
  assets = (await response.json()).actions;
  pet = new PetActions(assets, { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, onChange: state => {
    clearTimeout(reducedTimer); if (!state.action) return;
    const video = $('pet-video'); video.loop = state.action === pet.idle || state.action.label === '睡觉-循环' || state.mode === 'speaking' || state.mode === 'thinking';
    if (video.dataset.action !== state.action.id) { video.dataset.action = state.action.id; video.src = `/assets/${state.action.file}`; video.load(); }
    if (state.animate) video.play().catch(() => {}); else { video.pause(); video.currentTime = 0.05; if (!state.sleeping && state.action !== pet.idle) reducedTimer = setTimeout(() => pet.ended(), 1200); }
    $('pet-status').textContent = state.mode === 'listening' ? '正在听你说话' : state.mode === 'thinking' ? '正在想你的话' : state.mode === 'speaking' ? '正在说话' : state.sleeping ? '睡觉中' : state.action.label;
    $('sleep').textContent = state.sleeping ? '☀ 叫她起床' : '☾ 睡一会儿';
    if (state.action !== pet.idle && !['thinking', 'speaking', 'listening'].includes(state.mode)) bubble(state.sleeping ? '晚安，待会儿见。' : `一起${state.action.label.replace('点击回应-', '')}吧。`);
  } }); pet.emit(); renderActions();
} catch { show('pet-fallback', true); show('pet-video', false); $('pet-status').textContent = '动画暂不可用'; }
try { await signedIn(await api('/api/me')); } catch { /* Unauthenticated entry keeps the invitation/login form. */ }
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
