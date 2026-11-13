# 大肥鱼 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 提供可供受邀熟人使用的独立云端 PWA，支持私人聊天与记忆、动作点播、语音及可恢复备份。

**Architecture:** `pet-app/` 中创建独立 Node.js HTTP 应用，SQLite 保存账号与业务数据；复用 `src/chat/llm.js` 的兼容模型客户端，不启动 QQ。浏览器同源调用鉴权接口，素材来自固定版本 dsh-pet 并独立保留 MIT/CC 声明。

**Tech Stack:** Node.js >=24、node:sqlite、node:crypto、原生 HTML/CSS/JS、Web App Manifest/Service Worker、node:test；Playwright 仅用于开发验证。

**Spec:** ../specs/2026-11-13-dafeyu-pwa-design.md；许可调查 ../../dsh-pet-reuse-research.md。用户已接受非商业复用并明确要求开始开发，采用当前会话直接实施，不再重复询问是否开始。

## Global Constraints

- 家人朋友独立账号和记忆；登录身份来自服务端，会话/消息/音频/任务均按所有者过滤。
- 本地 WSL 关闭不影响云端正常聊天；持久化目录必须外部挂载，正式付费部署前另确认预算。
- 动作优先本地执行，私人 API 不进入 Service Worker 缓存。
- 代码 MIT 与角色/动画 CC BY-NC-SA 4.0 分开标识；不复制不明字体、声音、表情包。
- 保留现有 QQ 未提交修改，不提交或覆盖已有用户代码。新功能放 `pet-app/`，直接使用现有 LlmClient 接口。

## Review Focus

1. 伪造 user_id、消息/音频 ID 与邀请重用不能越权：Task 1/2/4 接口测试。
2. 删除发生于模型或语音请求期间不能重建记忆：Task 2/4 generation 测试。
3. 重复 requestId、刷新、超时或重启不造成双重记录：Task 2 幂等/恢复测试。
4. 退出/换账号、离线 SW 不残留私人内容：Task 3 浏览器场景与缓存检查。
5. 老备份恢复必须应用之后的删除记录，且损坏密文拒绝恢复：Task 5 测试。

## Task 1: 邀请登录与持久账号

Files: `pet-app/store.mjs`, `pet-app/server.mjs`, `pet-app/cli.mjs`, `pet-app/test/api.test.mjs`。

Interfaces: `createApp({dataDir,secureCookies,chat,asr,tts}) -> {server,store,close}`；`Store.createInvite({admin,expiresInMs}) -> token`；`Store.register({invite,username,password}) -> user`。

- [x] 先编写 HTTP 集成测试：邀请码一次使用；密码无明文；登录 cookie 与退出失效；未登录401；跨源修改403；恶意正文/限流拒绝。
- [x] `node --test pet-app/test/api.test.mjs`，观察缺失功能失败。
- [x] 实现 scrypt 密码、哈希会话/邀请、受鉴权账号与管理邀请接口、体积/速率限制和固定静态资源白名单。
- [x] 重跑测试，验证重开数据库保留账号且密码错误无法登录。

## Task 2: 私人聊天与记忆

Files: `pet-app/chat.mjs`, Task 1 store/server, `pet-app/test/chat.test.mjs`。

Interfaces: chat provider `reply({history,memories,text,signal}) -> Promise<string>`；`POST /api/messages {requestId,text}`，`GET /api/messages`；`GET/POST/DELETE /api/memories`，`DELETE /api/history`。

- [x] 先写双用户上下文、历史持久化、重复请求、模型失败、忙碌状态及进行中删除测试并运行失败。
- [x] 实现私人 SQL 范围、每账号生成互斥、持久化幂等任务、generation 检查、显式记忆管理；复用 LlmClient，以 App 人设和私人记忆调用，不套 QQ 场景。
- [x] 测试重启后 pending 标为 interrupted，重复 requestId 不自动再次计费；故障不落错误回复为记忆。

## Task 3: PWA 与合法动作资源

Files: `pet-app/public/*`, `pet-app/public/assets/actions.json`, `pet-app/THIRD_PARTY_NOTICES.md`, `scripts/fetch-pet-assets.mjs`。

Interfaces: `/api/me` 返回当前账号及 capability flags；动作清单 `{id,label,file,group}`；播放器一次一个主动动作，待机/睡眠状态可切换。

- [x] 写动作状态机测试并运行失败：睡眠可唤醒、rapid click 不排队、减少动画偏好、音频结束回待机。
- [x] 下载固定提交动作及许可，核对 blob SHA；不执行上游脚本，不复制字体/表情包。资源按需播放。
- [x] 实现登录/邀请、聊天、记忆与动作按钮、管理邀请、个人删除/导出和许可页；SW 只缓存公开应用外壳。
- [x] 浏览器验证至少两个账号、不串历史、动作点播、布局、退出、manifest 和缓存范围；缺少 MOV 的动作明确降级，不假装 Safari 已通过。

## Task 4: 按住录音与云端语音

Files: `pet-app/voice.mjs`, server/store, public app, `pet-app/test/voice.test.mjs`。

Interfaces: `POST /api/transcribe` 受限二进制音频 → text；`POST /api/messages/:id/audio` → 带所有者权限的短时音频引用；provider 走服务端配置的兼容 ASR/TTS。

- [x] 先测音频上限、所有者隔离、超时和删除中音频请求，观察失败。
- [x] 实现有界上传、外部语音调用、短时音频清理、录音取消/60秒截止、停止播放与文字降级。
- [x] 没有 ASR/TTS 凭据时返回明确 capability，页面不假装语音已经接通。

## Task 5: 加密备份与可恢复删除

Files: `pet-app/backup.mjs`, cli, `pet-app/test/backup.test.mjs`。

Interfaces: `createBackup({dataDir,destination,key})`、`restoreBackup({archive,dataDir,key,deletionJournal})`；AES-256-GCM 一致性快照；独立删除日志。

- [x] 先测备份恢复账号/记忆、篡改拒绝、旧快照重放删除且不带回会话，观察失败。
- [x] 实现 SQLite 一致性备份、加密封装、保留7份、独立删除日志同步和离线恢复命令；恢复目标必须空目录。
- [x] 提供本地拉取/独立存储调度说明；未配置独立存储不得声称生产备份就绪。

## Task 6: 验证、交付与部署材料

Files: `pet-app/README.md`, `pet-app/.env.example`, `pet-app/Dockerfile`, `pet-app/render.yaml`，本计划执行记录。

- [x] 运行 `node --test pet-app/test/*.test.mjs` 与原项目 `npm test`，如实报告已存在失败。
- [x] 实机之外的浏览器 QA 用已安装 Chrome；记录未覆盖 iPhone 真机/真实语音服务/付费生产部署。
- [x] 独立代理审查新应用一次，修复重要问题并补回归测试。
- [x] 只提交本次新应用/设计文档，保留其他未提交更改；不购买资源，不推送主分支。

## Execution ledger

- 2026-11-13：用户已明确接受非商业复用并要求开始开发。
- Ruling: 当前目录有大量未提交的用户代码，采用新 `pet-app/` 目录隔离新增文件；新建 feat/dafeyu-pwa 分支并保留工作树文件，不重置用户修改，不另建 worktree。代价是需严格限定提交路径。
- Ruling: 保留现有 QQ 记忆实现，PWA 用独立账号存储和私人上下文适配，复用模型客户端；避免新入口继承 QQ 身份语义。代价是暂不共享 QQ 档案，符合首版不互通范围。
- Task 1–6: 开发代码、回归与交付材料完成；生产资源、独立备份配置、真实语音和真机兼容仍是外部待办，未宣称上线。
- Review: 一次独立审查，3项Important均经失败→通过回归修复；新测试21通过，原正式测试146通过。
- Ruling: 复用原免费Render服务发布不接收私人数据的动作预览；完整聊天站点待持久化/预算确认。
- Ruling: 本地已有模型连接可安全复用，配置仅存Git忽略的pet-app/.env；真实模型HTTP聊天检查通过。
- Validation: 2026-11-13-dafeyu-pwa-validation.md。
- Ruling: 本计划采用集中提交新应用，避免分步提交意外混入用户大量未提交工作；最终提交仅限本次显式文件路径。
