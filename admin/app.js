const state = {
  config: null,
  personas: [],
  personaId: "custom",
  dirty: false,
  busy: false,
  logs: "",
  tab: "overview",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const BOOLEAN_FIELDS = [
  "replyEnabled",
  "searchEnabled",
  "foodEnabled",
  "proactiveEnabled",
  "forwardEnabled",
  "weatherEnabled",
  "visionEnabled",
  "imageGenEnabled",
  "breezeEnabled",
  "svsEnabled",
  "voiceEnabled",
  "voiceAlways",
  "voiceSinging",
  "dryRun",
];

const FEATURE_META = {
  foodEnabled: {
    title: "附近美食",
    desc: "按位置和预算找店；外卖优先挑快餐小吃，标注配送待确认，不输出链接。",
  },
  replyEnabled: {
    title: "聊天回复",
    desc: "@ 时认真回应，平常自然参与。关闭后暂停回复，继续记录群聊上下文。",
  },
  searchEnabled: {
    title: "联网搜索",
    desc: "遇到“查资料 / 搜一下 / 推荐 / 最新 / 案例”等消息时，先搜索再回答。",
  },
  proactiveEnabled: {
    title: "主动接话",
    desc: "不用 @ 也会按概率参与群聊；受冷却、每小时上限和群白名单约束。",
  },
  forwardEnabled: {
    title: "读取转发记录",
    desc: "读取直接转发或回复中的聊天记录，并作为当前回答的上下文。",
  },
  weatherEnabled: {
    title: "天气查询",
    desc: "遇到天气、气温、下雨、带伞等问题时，调用 Open-Meteo 获取实时天气。",
  },
  visionEnabled: {
    title: "看图",
    desc: "下载群里的图片，交给 DeepSeek 视觉模型描述画面或读取图片文字。",
  },
  imageGenEnabled: {
    title: "生成图片",
    desc: "识别“画一张 / 生成图片 / 来一张”等请求，调用 Pollinations 生成图片并发送到群里。",
  },
  breezeEnabled: {
    title: "Breeze 语音",
    desc: "正常说话优先走 Breeze TTS 2 容器，失败自动回退 edge-tts；音色由文字描述控制。",
  },
  svsEnabled: {
    title: "歌曲合成",
    desc: "把“唱首歌”请求发给独立 DiffSinger 容器，返回 QQ 语音；失败时回退到念唱。",
  },
  voiceEnabled: {
    title: "语音回复",
    desc: "收到“发语音 / 说给我听 / 唱歌”等请求时，用 edge-tts 生成语音发送。",
  },
  voiceAlways: {
    title: "全部用语音",
    desc: "所有文字回复都转成语音；会增加延迟，不建议一直开。",
  },
  voiceSinging: {
    title: "允许唱歌",
    desc: "优先调用 SVS 容器唱真歌声；SVS 不可用时回退到 TTS 念唱。",
  },
  dryRun: {
    title: "调试模式",
    desc: "只把回复打印到日志，不真正发送到 QQ。测试时使用。",
  },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
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

function toast(message, type = "ok") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = "toast";
  }, 3200);
}

function setDirty(value = true) {
  state.dirty = value;
  const element = $("#saveState");
  element.textContent = value ? "有未保存修改" : "已同步";
  element.className = `save-state${value ? " dirty" : ""}`;
  $("#saveBtn").classList.toggle("primary", true);
}

function markDirty(event) {
  const source = event?.target;
  if (source?.dataset.field && source.type === "checkbox") {
    for (const peer of $$("[data-field]")) {
      if (peer !== source && peer.dataset.field === source.dataset.field)
        peer.checked = source.checked;
    }
  }
  setDirty(true);
}

function renderToggles(container, fields, quick = false) {
  container.innerHTML = "";
  for (const field of fields) {
    const meta = FEATURE_META[field];
    if (!meta) continue;
    const row = document.createElement("div");
    row.className = quick ? "quick-row" : "toggle-row";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = meta.title;
    const desc = document.createElement("p");
    desc.textContent = meta.desc;
    info.append(title, desc);

    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.field = field;
    input.setAttribute("aria-label", meta.title);
    input.addEventListener("change", markDirty);
    const span = document.createElement("span");
    label.append(input, span);
    row.append(info, label);
    container.append(row);
  }
}

function renderPersonas() {
  const grid = $("#personaGrid");
  grid.innerHTML = "";
  for (const persona of state.personas) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `persona-card${state.personaId === persona.id ? " selected" : ""}`;
    card.setAttribute("aria-pressed", String(state.personaId === persona.id));
    card.type = "button";
    const top = document.createElement("div");
    top.className = "persona-top";
    const name = document.createElement("span");
    name.className = "persona-name";
    name.textContent = persona.name;
    const tag = document.createElement("span");
    tag.className = "persona-tag";
    tag.textContent = persona.tag;
    top.append(name, tag);
    const desc = document.createElement("p");
    desc.textContent = persona.description;
    card.append(top, desc);
    card.addEventListener("click", () => applyPersona(persona));
    grid.append(card);
  }
  $("#personaBadge").textContent =
    state.personas.find((persona) => persona.id === state.personaId)?.name ??
    "自定义";
}

function applyPersona(persona) {
  state.config = collectForm();
  state.personaId = persona.id;
  state.config.botName = persona.botName;
  state.config.systemPrompt = persona.systemPrompt;
  state.config.temperature = persona.temperature;
  fillForm(state.config);
  renderPersonas();
  markDirty();
}

function fillForm(config) {
  for (const element of $$("[data-field]")) {
    const field = element.dataset.field;
    if (!(field in config)) continue;
    if (element.type === "checkbox") {
      element.checked = Boolean(config[field]);
    } else {
      element.value = config[field] ?? "";
    }
  }
  // 自定义字段不覆盖密码输入
  for (const field of ["llmApiKey", "amapApiKey"]) {
    const password = $(`[data-field="${field}"]`);
    if (password) password.value = "";
  }
}

function collectForm() {
  const config = { ...state.config };
  for (const element of $$("[data-field]")) {
    const field = element.dataset.field;
    if (["llmApiKey", "amapApiKey"].includes(field)) continue;
    if (element.type === "checkbox") config[field] = element.checked;
    else if (element.type === "number") {
      const value = Number(element.value);
      config[field] = Number.isFinite(value) ? value : null;
    } else config[field] = element.value;
  }
  for (const field of ["llmApiKey", "amapApiKey"]) {
    const password = $(`[data-field="${field}"]`);
    if (password?.value.trim()) config[field] = password.value.trim();
  }
  config.personaId = state.personaId;
  return config;
}

function maskGroupList(value) {
  const items = String(value ?? "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) return "未设置";
  return items
    .map((item) =>
      item.length > 6 ? `${item.slice(0, 3)}****${item.slice(-3)}` : "****",
    )
    .join(", ");
}

function setupReveals() {
  for (const button of $$(".reveal")) {
    button.addEventListener("click", () => {
      const field = button.dataset.reveal;
      const input = $(`[data-field="${field}"]`);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.textContent = visible ? "显示" : "隐藏";
    });
  }
}

function renderStatus(payload) {
  const { bot, napcat, config } = payload;
  const botOk = bot?.active;
  const napcatOk = napcat?.active;
  $("#instanceName").textContent = config.botName || "大肥鱼";
  $("#instanceDot").classList.toggle("ok", Boolean(botOk));
  const botStatus = $("#botStatus");
  botStatus.textContent = botOk ? "运行中" : "未运行";
  botStatus.className = `status-value ${botOk ? "ok" : "down"}`;
  $("#botSince").textContent = bot?.since
    ? serviceUptime(bot.since)
    : "点击重启尝试恢复";
  const napcatStatus = $("#napcatStatus");
  napcatStatus.textContent = napcatOk ? "运行中" : "未运行";
  napcatStatus.className = `status-value ${napcatOk ? "ok" : "down"}`;
  $("#napcatSince").textContent = napcat?.since
    ? serviceUptime(napcat.since)
    : "NapCat 服务未就绪";
  $("#modelStatus").textContent = config.model || "—";
  $("#keyStatus").textContent = config.hasApiKey
    ? "API Key 已配置"
    : "缺少 API Key";
  $("#amapKeyStatus").textContent = config.hasAmapKey
    ? "地图 Key 已配置"
    : "待配置地图 Key";
  $("#amapKeyStatus").className = `pill ${config.hasAmapKey ? "ok" : "down"}`;
  const enabledFeatures = BOOLEAN_FIELDS.filter(
    (key) => key !== "dryRun" && config[key],
  ).length;
  $("#featureStatus").textContent = `${enabledFeatures} 项能力`;
  $("#behaviorChance").textContent = config.proactiveEnabled
    ? `${Math.round((config.proactiveChance ?? 0) * 100)}%`
    : "已关闭";
  $("#behaviorWindow").textContent =
    `${config.proactiveFollowUpWindowSec ?? 120} 秒`;
  $("#behaviorLimit").textContent = `${config.proactiveMaxPerHour ?? "—"} 次`;
  const groups = String(config.napcatAllowedGroups || "").trim();
  $("#groupStatus").textContent = groups
    ? `白名单 ${groups.split(",").length} 个群`
    : "未限制群";
  const health = $("#healthBadge");
  const healthy = botOk && napcatOk;
  health.textContent = healthy ? "运行正常" : "需要检查";
  health.className = `pill ${healthy ? "ok" : "down"}`;

  $("#ovBot").textContent = botOk
    ? `运行中${bot.pid ? ` · PID ${bot.pid}` : ""}`
    : "未运行";
  $("#ovNapcat").textContent = napcatOk ? "运行中" : "未运行";
  $("#ovKey").textContent = config.hasApiKey ? "已配置" : "未配置";
  $("#ovGroups").textContent = groups ? maskGroupList(groups) : "未限制";
  $("#ovProactiveGroups").textContent = config.proactiveGroups
    ? maskGroupList(config.proactiveGroups)
    : "未开启群";
  $("#ovPrivate").textContent = config.privateAllowedUsers
    ? maskGroupList(config.privateAllowedUsers)
    : "未开放";
  $("#ovFather").textContent = config.familyFatherQq
    ? maskGroupList(config.familyFatherQq)
    : "未设置";
  $("#ovWeather").textContent = config.weatherEnabled
    ? config.weatherCity || "西安"
    : "已关闭";
  $("#ovContext").textContent =
    `${config.groupContextRenderMessages ?? "—"} 条 / ${config.groupContextMaxChars ?? "—"} 字符`;
}

async function refreshStatus() {
  try {
    const payload = await api("/api/status");
    state.config = { ...(state.config ?? {}), ...payload.config };
    state.personas = payload.personas ?? state.personas;
    renderStatus(payload);
    if (!state.dirty) {
      state.personaId = payload.config.personaId ?? "custom";
      fillForm(state.config);
      renderPersonas();
    }
    $("#footerTime").textContent =
      `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`;
  } catch (error) {
    $("#healthBadge").textContent = "连接失败";
    $("#healthBadge").className = "pill down";
    toast(error.message, "error");
  }
}

async function loadConfig() {
  const payload = await api("/api/config");
  state.config = payload.config;
  state.personas = payload.personas ?? [];
  state.personaId = payload.config.personaId ?? "custom";
  fillForm(state.config);
  renderToggles($("#featureToggles"), BOOLEAN_FIELDS);
  renderToggles(
    $("#quickToggles"),
    [
      "replyEnabled",
      "searchEnabled",
      "proactiveEnabled",
      "forwardEnabled",
      "weatherEnabled",
    ],
    true,
  );
  renderPersonas();
  // 动态生成的开关需要绑定
  for (const element of $$(
    "[data-toggle], #quickToggles input, #featureToggles input",
  )) {
    element.addEventListener("change", markDirty);
  }
  setDirty(false);
}

async function refreshLogs(lines = 160, full = true) {
  try {
    const payload = await api(`/api/logs?lines=${lines}`);
    if (full) {
      state.logs = payload.lines || "";
      filterLogs();
    } else renderLogLines($("#overviewLogs"), payload.lines || "暂无日志");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveConfig() {
  if (state.busy) return;
  const invalid = $$("[data-field]").find(
    (element) => !element.checkValidity(),
  );
  if (invalid) {
    const panel = invalid.closest(".panel");
    if (panel) activateTab(panel.id.replace("panel-", ""));
    invalid.reportValidity();
    return;
  }
  state.busy = true;
  const buttons = [$("#saveBtn"), $("#restartBtn"), $("#refreshBtn")];
  buttons.forEach((button) => (button.disabled = true));
  $("#saveBtn").textContent = "保存中…";
  try {
    const config = collectForm();
    const payload = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    state.config = payload.config;
    state.personaId = payload.config.personaId ?? "custom";
    setDirty(false);
    fillForm(state.config);
    renderPersonas();
    renderStatus({ ...(await api("/api/status")) });
    toast("配置已保存，机器人已重启");
    await refreshLogs(Number($("#logLines").value));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.busy = false;
    buttons.forEach((button) => (button.disabled = false));
    $("#saveBtn").textContent = "保存并应用 ↗";
  }
}

async function restartBot() {
  if (state.busy) return;
  if (!window.confirm("确定重启机器人？当前未保存的修改不会生效。")) return;
  state.busy = true;
  $("#restartBtn").disabled = true;
  try {
    const payload = await api("/api/restart", { method: "POST" });
    await refreshStatus();
    toast(
      payload.status?.active ? "机器人已重启" : "重启命令已发送，请查看日志",
    );
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.busy = false;
    $("#restartBtn").disabled = false;
  }
}

const PAGES = {
  overview: ["工作台", "OVERVIEW", "照看好状态，剩下的交给大肥鱼。"],
  features: ["功能管理", "CAPABILITIES", "想聊、想看、想听，给她多一点可能。"],
  thresholds: [
    "对话与记忆",
    "CONVERSATION",
    "什么时候接话、记住多少，在这里找到舒服的节奏。",
  ],
  media: ["语音与图像", "VOICE & VISION", "让声音有温度，让表达不止于文字。"],
  persona: [
    "人设与模型",
    "PERSONALITY",
    "一点性格，一点想法，慢慢成为熟悉的群友。",
  ],
  access: ["关系与范围", "CONNECTIONS", "认识熟悉的人，也照顾好彼此的边界。"],
  logs: ["运行日志", "ACTIVITY", "连接、思考、回复，每一步都有迹可循。"],
};

function serviceUptime(value) {
  const elapsed = Math.floor((Date.now() - Date.parse(value)) / 60000);
  if (!Number.isFinite(elapsed)) return "服务已启动";
  if (elapsed < 1) return "刚刚启动";
  if (elapsed < 60) return `已运行 ${elapsed} 分钟`;
  if (elapsed < 1440)
    return `已运行 ${Math.floor(elapsed / 60)} 小时 ${elapsed % 60} 分钟`;
  return `已运行 ${Math.floor(elapsed / 1440)} 天`;
}

function activateTab(key) {
  if (!PAGES[key]) key = "overview";
  state.tab = key;
  for (const item of $$(".tab")) {
    item.classList.toggle("active", item.dataset.tab === key);
    item.setAttribute(
      "aria-current",
      item.dataset.tab === key ? "page" : "false",
    );
  }
  for (const panel of $$(".panel"))
    panel.classList.toggle("active", panel.id === `panel-${key}`);
  const [title, eyebrow, description] = PAGES[key];
  $("#pageTitle").textContent = title;
  $("#pageEyebrow").textContent = eyebrow;
  $("#pageDescription").textContent = description;
  $("#breadcrumbPage").textContent = title;
  document.title = `${title} · 大肥鱼`;
  history.replaceState(null, "", `#${key}`);
  if (key === "logs") refreshLogs(Number($("#logLines").value));
}

function setupTabs() {
  for (const tab of $$(".tab"))
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  for (const link of $$("[data-go]"))
    link.addEventListener("click", () => activateTab(link.dataset.go));
  $(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    activateTab("overview");
  });
  window.addEventListener("hashchange", () =>
    activateTab(location.hash.slice(1)),
  );
  activateTab(location.hash.slice(1));
}

function renderLogLines(container, text) {
  container.replaceChildren();
  const lines = text.split("\n");
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const element = document.createElement("span");
    element.className = `log-line ${/\bERROR\b|失败/.test(line) ? "log-error" : /\bWARN\b/.test(line) ? "log-warn" : "log-info"}`;
    element.textContent = line || " ";
    fragment.append(element);
  }
  container.append(fragment);
}

function filterLogs() {
  const query = $("#logQuery").value.trim().toLowerCase();
  const lines = state.logs
    .split("\n")
    .filter((line) => !query || line.toLowerCase().includes(query));
  renderLogLines(
    $("#fullLogs"),
    lines.filter(Boolean).length
      ? lines.join("\n")
      : query
        ? "没有匹配的日志，换个关键词试试。"
        : "暂无运行日志",
  );
}

function setupInputs() {
  for (const element of $$("[data-field]")) {
    if (element.type === "checkbox")
      element.addEventListener("change", markDirty);
    else
      element.addEventListener("input", () => {
        if (
          !["botName", "systemPrompt", "temperature"].includes(
            element.dataset.field,
          )
        ) {
          markDirty();
          return;
        }
        if (state.personaId !== "custom") {
          state.personaId = "custom";
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
  $("#logQuery").addEventListener("input", filterLogs);
  $("#copyLogs").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.logs);
      toast("日志已复制");
    } catch {
      toast("复制失败，请手动选择日志文字", "error");
    }
  });
  $("#refreshBtn").addEventListener("click", () => {
    refreshStatus();
    refreshLogs(Number($("#logLines").value));
  });
  $("#restartBtn").addEventListener("click", restartBot);
  $("#saveBtn").addEventListener("click", saveConfig);
  $("#logRefresh").addEventListener("click", () =>
    refreshLogs(Number($("#logLines").value)),
  );
  $("#overviewLogRefresh").addEventListener("click", () =>
    refreshLogs(60, false),
  );
  $("#logLines").addEventListener("change", () =>
    refreshLogs(Number($("#logLines").value)),
  );
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  try {
    await loadConfig();
    await refreshStatus();
    await refreshLogs(60, false);
    setInterval(() => {
      refreshStatus();
      if (state.tab === "logs") refreshLogs(Number($("#logLines").value));
    }, 12000);
  } catch (error) {
    toast(error.message, "error");
  }
}

boot();
