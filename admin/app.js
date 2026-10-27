const state = {
  config: null,
  personas: [],
  personaId: 'custom',
  dirty: false,
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const BOOLEAN_FIELDS = [
  'replyEnabled',
  'searchEnabled',
  'proactiveEnabled',
  'forwardEnabled',
  'dryRun',
];

const FEATURE_META = {
  replyEnabled: { title: '@ 回复', desc: '关闭后机器人不再回复被 @ 的消息，但会继续记录群聊上下文。' },
  searchEnabled: { title: '联网搜索', desc: '遇到“查资料 / 搜一下 / 推荐 / 最新 / 案例”等消息时，先搜索再回答。' },
  proactiveEnabled: { title: '主动接话', desc: '不用 @ 也会按概率参与群聊；受冷却、每小时上限和群白名单约束。' },
  forwardEnabled: { title: '读取转发记录', desc: '读取直接转发或回复中的聊天记录，并作为当前回答的上下文。' },
  dryRun: { title: '调试模式', desc: '只把回复打印到日志，不真正发送到 QQ。测试时使用。' },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // ignore
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function toast(message, type = 'ok') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${type === 'error' ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = 'toast';
  }, 3200);
}

function setDirty(value = true) {
  state.dirty = value;
  const element = $('#saveState');
  element.textContent = value ? '有未保存修改' : '已同步';
  element.className = `save-state${value ? ' dirty' : ''}`;
  $('#saveBtn').classList.toggle('primary', true);
}

function markDirty() {
  setDirty(true);
}

function renderToggles(container, fields, quick = false) {
  container.innerHTML = '';
  for (const field of fields) {
    const meta = FEATURE_META[field];
    if (!meta) continue;
    const row = document.createElement('div');
    row.className = quick ? 'quick-row' : 'toggle-row';
    const info = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = meta.title;
    const desc = document.createElement('p');
    desc.textContent = meta.desc;
    info.append(title, desc);

    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.field = field;
    input.addEventListener('change', markDirty);
    const span = document.createElement('span');
    label.append(input, span);
    row.append(info, label);
    container.append(row);
  }
}

function renderPersonas() {
  const grid = $('#personaGrid');
  grid.innerHTML = '';
  for (const persona of state.personas) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `persona-card${state.personaId === persona.id ? ' selected' : ''}`;
    const top = document.createElement('div');
    top.className = 'persona-top';
    const name = document.createElement('span');
    name.className = 'persona-name';
    name.textContent = persona.name;
    const tag = document.createElement('span');
    tag.className = 'persona-tag';
    tag.textContent = persona.tag;
    top.append(name, tag);
    const desc = document.createElement('p');
    desc.textContent = persona.description;
    card.append(top, desc);
    card.addEventListener('click', () => applyPersona(persona));
    grid.append(card);
  }
  $('#personaBadge').textContent =
    state.personas.find((persona) => persona.id === state.personaId)?.name ?? '自定义';
}

function applyPersona(persona) {
  state.personaId = persona.id;
  state.config.botName = persona.botName;
  state.config.systemPrompt = persona.systemPrompt;
  state.config.temperature = persona.temperature;
  fillForm(state.config);
  renderPersonas();
  markDirty();
}

function fillForm(config) {
  for (const element of $$('[data-field]')) {
    const field = element.dataset.field;
    if (!(field in config)) continue;
    if (element.type === 'checkbox') {
      element.checked = Boolean(config[field]);
    } else {
      element.value = config[field] ?? '';
    }
  }
  // 自定义字段不覆盖密码输入
  const password = $('[data-field="llmApiKey"]');
  if (password) password.value = '';
}

function collectForm() {
  const config = { ...state.config };
  for (const element of $$('[data-field]')) {
    const field = element.dataset.field;
    if (field === 'llmApiKey') continue;
    if (element.type === 'checkbox') config[field] = element.checked;
    else if (element.type === 'number') {
      const value = Number(element.value);
      config[field] = Number.isFinite(value) ? value : null;
    } else config[field] = element.value;
  }
  const password = $('[data-field="llmApiKey"]');
  if (password?.value.trim()) config.llmApiKey = password.value.trim();
  config.personaId = state.personaId;
  return config;
}

function maskGroupList(value) {
  const items = String(value ?? '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) return '未设置';
  return items
    .map((item) => (item.length > 6 ? `${item.slice(0, 3)}****${item.slice(-3)}` : '****'))
    .join(', ');
}

function setupReveals() {
  for (const button of $$('.reveal')) {
    button.addEventListener('click', () => {
      const field = button.dataset.reveal;
      const input = $(`[data-field="${field}"]`);
      if (!input) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? '显示' : '隐藏';
    });
  }
}

function renderStatus(payload) {
  const { bot, napcat, config } = payload;
  const botOk = bot?.active;
  const napcatOk = napcat?.active;
  const botStatus = $('#botStatus');
  botStatus.textContent = botOk ? '运行中' : '未运行';
  botStatus.className = `status-value ${botOk ? 'ok' : 'down'}`;
  $('#botSince').textContent = bot?.since ? `启动于 ${bot.since}` : '点击重启尝试恢复';
  const napcatStatus = $('#napcatStatus');
  napcatStatus.textContent = napcatOk ? '已连接' : '未运行';
  napcatStatus.className = `status-value ${napcatOk ? 'ok' : 'down'}`;
  $('#napcatSince').textContent = napcat?.since ? `启动于 ${napcat.since}` : 'NapCat 服务未就绪';
  $('#modelStatus').textContent = config.model || '—';
  $('#keyStatus').textContent = config.hasApiKey ? 'API Key 已配置' : '缺少 API Key';
  const features = [
    config.replyEnabled && '@回复',
    config.searchEnabled && '搜索',
    config.proactiveEnabled && '主动接话',
    config.forwardEnabled && '转发',
  ].filter(Boolean);
  $('#featureStatus').textContent = features.join(' · ') || '全部关闭';
  const groups = String(config.napcatAllowedGroups || '').trim();
  $('#groupStatus').textContent = groups ? `白名单 ${groups.split(',').length} 个群` : '未限制群';
  const health = $('#healthBadge');
  const healthy = botOk && napcatOk;
  health.textContent = healthy ? '运行正常' : '需要检查';
  health.className = `pill ${healthy ? 'ok' : 'down'}`;

  $('#ovBot').textContent = botOk ? `运行中${bot.pid ? ` · PID ${bot.pid}` : ''}` : '未运行';
  $('#ovNapcat').textContent = napcatOk ? '已连接' : '未运行';
  $('#ovKey').textContent = config.hasApiKey ? '已配置' : '未配置';
  $('#ovGroups').textContent = groups ? maskGroupList(groups) : '未限制';
  $('#ovProactiveGroups').textContent = config.proactiveGroups
    ? maskGroupList(config.proactiveGroups)
    : '未开启群';
  $('#ovPrivate').textContent = config.privateAllowedUsers
    ? maskGroupList(config.privateAllowedUsers)
    : '未开放';
  $('#ovContext').textContent = `${config.groupContextRenderMessages ?? '—'} 条 / ${config.groupContextMaxChars ?? '—'} 字符`;
}

async function refreshStatus() {
  try {
    const payload = await api('/api/status');
    state.config = { ...(state.config ?? {}), ...payload.config };
    state.personas = payload.personas ?? state.personas;
    renderStatus(payload);
    if (!state.dirty) {
      fillForm(state.config);
      renderPersonas();
    }
    $('#footerTime').textContent = `更新于 ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    $('#healthBadge').textContent = '连接失败';
    $('#healthBadge').className = 'pill down';
    toast(error.message, 'error');
  }
}

async function loadConfig() {
  const payload = await api('/api/config');
  state.config = payload.config;
  state.personas = payload.personas ?? [];
  state.personaId = payload.config.personaId ?? 'custom';
  fillForm(state.config);
  renderToggles($('#featureToggles'), BOOLEAN_FIELDS);
  renderToggles($('#quickToggles'), ['replyEnabled', 'searchEnabled', 'proactiveEnabled', 'forwardEnabled'], true);
  renderPersonas();
  // 动态生成的开关需要绑定
  for (const element of $$('[data-toggle], #quickToggles input, #featureToggles input')) {
    element.addEventListener('change', markDirty);
  }
  setDirty(false);
}

async function refreshLogs(lines = 160, full = true) {
  try {
    const payload = await api(`/api/logs?lines=${lines}`);
    if (full) $('#fullLogs').textContent = payload.lines || '(暂无日志)';
    else $('#overviewLogs').textContent = payload.lines || '(暂无日志)';
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveConfig() {
  if (state.busy) return;
  state.busy = true;
  const buttons = [$('#saveBtn'), $('#restartBtn')];
  buttons.forEach((button) => (button.disabled = true));
  $('#saveBtn').textContent = '保存中…';
  try {
    const config = collectForm();
    const payload = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    state.config = payload.config;
    state.personaId = payload.config.personaId ?? 'custom';
    setDirty(false);
    fillForm(state.config);
    renderPersonas();
    renderStatus({ ...(await api('/api/status')) });
    toast('配置已保存，机器人已重启');
    await refreshLogs(Number($('#logLines').value));
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.busy = false;
    buttons.forEach((button) => (button.disabled = false));
    $('#saveBtn').textContent = '保存并重启';
  }
}

async function restartBot() {
  if (state.busy) return;
  if (!window.confirm('确定重启机器人？当前未保存的修改不会生效。')) return;
  state.busy = true;
  $('#restartBtn').disabled = true;
  try {
    const payload = await api('/api/restart', { method: 'POST' });
    await refreshStatus();
    toast(payload.status?.active ? '机器人已重启' : '重启命令已发送，请查看日志');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.busy = false;
    $('#restartBtn').disabled = false;
  }
}

function setupTabs() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      for (const item of $$('.tab')) item.classList.toggle('active', item === tab);
      for (const panel of $$('.panel')) {
        panel.classList.toggle('active', panel.id === `panel-${tab.dataset.tab}`);
      }
    });
  }
}

function setupInputs() {
  for (const element of $$('[data-field]')) {
    if (element.type === 'checkbox') element.addEventListener('change', markDirty);
    else element.addEventListener('input', () => {
      if (!['botName', 'systemPrompt', 'temperature'].includes(element.dataset.field)) {
        markDirty();
        return;
      }
      if (state.personaId !== 'custom') {
        state.personaId = 'custom';
        renderPersonas();
      }
      markDirty();
    });
  }
}

async function boot() {
  setupTabs();
  setupInputs();
  setupReveals();
  $('#refreshBtn').addEventListener('click', () => {
    refreshStatus();
    refreshLogs(Number($('#logLines').value));
  });
  $('#restartBtn').addEventListener('click', restartBot);
  $('#saveBtn').addEventListener('click', saveConfig);
  $('#logRefresh').addEventListener('click', () => refreshLogs(Number($('#logLines').value)));
  $('#overviewLogRefresh').addEventListener('click', () => refreshLogs(60, false));
  $('#logLines').addEventListener('change', () => refreshLogs(Number($('#logLines').value)));
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  try {
    await loadConfig();
    await refreshStatus();
    await refreshLogs(60, false);
    setInterval(refreshStatus, 12000);
  } catch (error) {
    toast(error.message, 'error');
  }
}

boot();
