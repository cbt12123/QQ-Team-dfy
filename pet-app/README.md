# 大肥鱼 PWA

独立于 QQ/NapCat 的多人私人聊天应用。供家人朋友免费、非商业使用。当前提供邀请登录、个人文字聊天、显式长期记忆、114段动作点播、录音识别/语音合成接入、个人导出/删除，以及加密备份恢复命令。

## 本机运行

需要 Node.js 24。首次安装本应用的固定版本 PostgreSQL 依赖；本机仍默认使用 SQLite。在仓库根目录执行：

```powershell
npm ci --prefix pet-app --ignore-scripts
Copy-Item pet-app/.env.example pet-app/.env
# 编辑 pet-app/.env，填写模型地址、模型和密钥。
node --env-file-if-exists=pet-app/.env pet-app/cli.mjs invite --admin
node --env-file-if-exists=pet-app/.env pet-app/server.mjs
```

打开命令行生成的邀请链接，为自己注册管理员账号。之后在应用底部生成普通邀请，私下发送给亲友。邀请一次使用、24小时有效。管理员首版不能从页面查看别人的聊天或重置他人密码；遗失密码暂需运维处理，不提供未经验证的自助重置。

默认仅监听本机 `127.0.0.1:8899`，不启动 QQ，不读取原机器人 `.env` 或聊天数据。开发数据保存在已忽略的 `.cache/pet-app-data/`。没有模型配置时页面明确提示，只能体验动作和个人记忆管理，不伪造正常 AI 对话。

2026-11-13 本机真实聊天已接入已配置的 DeepSeek。模拟器继续使用原端口和账号，会话随 SQLite 一致性快照迁入 `data/pet-app/`；切换前快照在 `data/pet-app-before-real-chat/`。这两个目录均不提交 Git。原测试回显的助手消息已移除，用户消息保留。实际端口及数据目录由忽略的 `pet-app/.env` 指定。

隐藏后台启动：`node scripts/start-pet-chat.mjs`。日志在 `.cache/pet-chat-server*.log`，PID 在 `.cache/pet-chat-server.pid`；未配置 Windows 开机自启。服务重启保留账号、会话、历史和显式记忆，Android App 退出进程后仍需重新登录。本机与公网账号数据独立；公网聊天运行于 Render，不依赖电脑或 WSL。

App 聊天使用独立模型适配器，不混入 QQ 群聊/点歌提示；模型不可用时返回错误，不降级成测试回显。模型密钥仅在后端 `.env`。

生产部署 `PET_HOST=0.0.0.0`，配置 HTTPS `PET_PUBLIC_URL`。免费 Render 必须配置持久的 `DATABASE_URL`，不能用临时文件系统保存账号。Secure Cookie 由公网地址决定，家庭电脑关机不影响公网服务。

## 记忆与隔离

同一账号共享连续对话，不同账号在 SQL、模型输入、任务和音频层分别隔离。首版长期记忆由用户在“我的记忆”明确添加，不自动提取。删除记忆会清空聊天上下文并取消旧任务，避免从原文或进行中的回复恢复。所有 API 均不被 Service Worker 缓存，退出/换账号清理私人页面状态。

消息请求持久化幂等标识，失败和重启中断不会自动重复扣费。外部服务的计费无法保证绝对 exactly-once；网络错误后先刷新查看状态，再决定是否新发一条。

## 动作及手机兼容

114个动画约55MiB，按需加载，PWA 仅缓存最近16个动画和公开外壳。上游透明 WebM 在 Chrome 等浏览器验证；Safari/iPhone 的透明视频支持须实机另测，当前未整合 MOV 兼容包。播放失败会显示替代提示，不能把替代提示等同动画兼容通过。

动作包括喂饭、打招呼、伸懒腰、泡泡、睡觉/唤醒及完整动作库。一次一个主动动作，不无限排队。减少动态效果偏好时尽量保留状态文字。

重新获取素材：`node scripts/fetch-pet-assets.mjs`。脚本固定提交并验证 Git blob SHA，不执行上游脚本。使用前请阅读 THIRD_PARTY_NOTICES.md 和应用的许可页。

## 语音配置

`PET_ASR_*` 为兼容 `/audio/transcriptions` 的识别接口，`PET_TTS_*` 为兼容 `/audio/speech` 的合成接口。服务商可以不同于聊天提供商。未配置的能力会在页面提示。

录音需 HTTPS/localhost 和麦克风授权；按住录音、松开结束，识别结果填入输入框，由用户确认发送；最多60秒、8MiB。Esc 或系统取消可丢弃。回复旁“听这句”生成并播放语音，可以停止。首版不是实时全双工语音。

录音不持久保存，合成音频在数据库中最多有效10分钟，过期内容在下一次音频生成或启动时清理，不进入备份。后台/锁屏停止录音与播放。

## 备份与恢复

```powershell
# 仅在自己的终端生成和安全保存，不贴到聊天或提交仓库。
node pet-app/cli.mjs keygen
# 设置 PET_BACKUP_KEY（64位hex）和 PET_BACKUP_DIR 后：
node --env-file=pet-app/.env pet-app/cli.mjs backup
```

采用 SQLite 一致性快照、AES-256-GCM 加密，保留最近7份；排除会话、邀请和临时音频。备份密钥必须独立保存。生产应将 PET_BACKUP_DIR 和 PET_DELETION_MIRROR_DIR 放在独立可靠存储上，由运维每天调度 backup，并将加密档案和最新删除日志安全同步到本地。仅把它们放在同一云磁盘的另一个目录不是独立备份。本版本提供命令与目录镜像，不假装已经配置某个云存储账号或自动下载通道。

删除操作写入并落盘删除日志；配置镜像目录时同步追加到镜像，目录不可用时操作会报告失败，需管理员检查。备份恢复必须提供最新独立删除日志，拒绝缺少日志或覆盖非空目录，重放快照之后尚未应用的删除。不要以旧快照自带的旧日志冒充最新日志，否则无法保证之后的删除得到保留。

停止目标服务，设置 PET_RESTORE_ARCHIVE、空的 PET_RESTORE_TARGET、最新 PET_DELETION_JOURNAL 和原 PET_BACKUP_KEY，然后：

```powershell
node --env-file=pet-app/.env pet-app/cli.mjs restore --confirm-offline
```

恢复后旧会话与邀请失效，需重新登录。先在隔离目录核对账号、记忆和删除结果，再切换生产目录。生产恢复前另确认停写窗口。首版最多24小时数据损失、4小时人工恢复仅为配置完善后的目标，不是当前生产 SLA。

## 免费公网部署

当前复用免费 Render 服务 `qqbot-public-web-test` 与原域名，连接 Neon PostgreSQL 的独立 `dafeyu` schema。账号、会话、消息、记忆和删除日志在 PostgreSQL 事务中保存，不依赖 Render 磁盘。已验证真实 HTTPS 聊天、两账号隔离和重新部署后记录保留。原 `render.yaml` 是未使用的付费草案，不要直接应用或另建常驻免费实例。

`pet-app/.env.render.local` 只在本机保存 `DATABASE_URL`，已被 Git 忽略。模型和数据库凭据写入 Render 环境变量，不进入源码或 APK。新公网账号通过一次性邀请注册，本机 `native-ui-test` 测试账号未迁入公网。

现有服务构建命令不能经当前连接器修改，因此 `scripts/prepare-pet-render.mjs` 从锁定依赖生成独立的 pg 驱动包并保留许可，再把应用、公开素材和 APK 写入既有发布仓库。生成过程不复制环境文件或本机数据：

```powershell
npm ci --prefix pet-app --ignore-scripts
npm install --prefix .cache/pet-render-build esbuild@0.28.2 --ignore-scripts --no-audit --no-fund
node scripts/prepare-pet-render.mjs
node --env-file=pet-app/.env --env-file=pet-app/.env.render.local scripts/verify-pet-render-artifact.mjs
```

`deploy/pet-render-server.mjs` 是发布入口，缺少数据库或模型配置会拒绝启动，不回退到临时 SQLite。生成物使用 Node 24。Dockerfile 为可选源码部署入口，本次使用原生 Node 服务。

`deploy/render-keepalive.yml` 已安装在公共仓库默认 main 分支，每10分钟访问 `/health`，不调用模型、不查询数据库，让 Neon 仍可按需休眠。GitHub 调度可能延迟，Render 免费运行小时由工作区共享，不能承诺绝对不休眠。用 `node scripts/install-render-keepalive.mjs --status` 检查最近一轮；安装脚本复用已有 GitHub 凭据，不输出令牌。

SQLite 迁移命令如下。它在一致性读事务中取数据，目标非空拒绝覆盖，重复同一快照幂等；保留密码登录、消息顺序和删除记录，不迁移旧会话/邀请。源 SQLite 不修改。带 `--exclude-test-account` 会跳过已用于演示的 `native-ui-test`：

```powershell
node --env-file=pet-app/.env.render.local pet-app/migrate-postgres.mjs data/pet-app --exclude-test-account
```

上面的加密 `.dfbackup` 命令目前用于本机 SQLite，不能当作 Neon 备份恢复工具。公网用户可从网页导出自己的记录；独立自动备份、原生语音及 Redmi 真机验收仍待后续完成，不把数据库持久化当作自动异地备份。

## 验证

```powershell
node --test pet-app/test/*.test.mjs
```

开发集成测试中的模型/语音返回由受控测试提供商替代，用于检查隔离与错误处理，不能代替真实服务商端到端验证。原仓库 `npm test` 已有 `scripts/send-voice-test.mjs` 缺少QQ参数的基线失败；本应用不修复或执行该手动QQ发送流程。

浏览器回归（开发验证专用，不增加生产依赖）：

```powershell
npm install --prefix .cache/pet-qa playwright --no-package-lock --ignore-scripts
node scripts/check-pet-browser.mjs
node scripts/check-pet-races.mjs
```

脚本目前使用Windows已安装的Chrome路径，可按本机浏览器路径调整。历史PWA验证见 `../docs/superpowers/plans/2026-11-13-dafeyu-pwa-validation.md`；当前免费公网部署验证见 `../docs/superpowers/plans/2026-11-13-dafeyu-render-free.md`。公网入口为 https://qqbot-public-web-test.onrender.com ，已开放邀请注册和真实聊天。
