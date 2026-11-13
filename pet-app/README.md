# 大肥鱼 PWA

独立于 QQ/NapCat 的多人私人聊天应用。供家人朋友免费、非商业使用。当前提供邀请登录、个人文字聊天、显式长期记忆、114段动作点播、录音识别/语音合成接入、个人导出/删除，以及加密备份恢复命令。

## 本机运行

需要 Node.js 24，无新增生产 npm 依赖。在仓库根目录执行：

```powershell
Copy-Item pet-app/.env.example pet-app/.env
# 编辑 pet-app/.env，填写模型地址、模型和密钥。
node --env-file-if-exists=pet-app/.env pet-app/cli.mjs invite --admin
node --env-file-if-exists=pet-app/.env pet-app/server.mjs
```

打开命令行生成的邀请链接，为自己注册管理员账号。之后在应用底部生成普通邀请，私下发送给亲友。邀请一次使用、24小时有效。管理员首版不能从页面查看别人的聊天或重置他人密码；遗失密码暂需运维处理，不提供未经验证的自助重置。

默认仅监听本机 `127.0.0.1:8899`，不启动 QQ，不读取原机器人 `.env` 或聊天数据。开发数据保存在已忽略的 `.cache/pet-app-data/`。没有模型配置时页面明确提示，只能体验动作和个人记忆管理，不伪造正常 AI 对话。

2026-11-13 本机真实聊天已接入已配置的 DeepSeek。模拟器继续使用原端口和账号，会话随 SQLite 一致性快照迁入 `data/pet-app/`；切换前快照在 `data/pet-app-before-real-chat/`。这两个目录均不提交 Git。原测试回显的助手消息已移除，用户消息保留。实际端口及数据目录由忽略的 `pet-app/.env` 指定。

隐藏后台启动：`node scripts/start-pet-chat.mjs`。日志在 `.cache/pet-chat-server*.log`，PID 在 `.cache/pet-chat-server.pid`；未配置 Windows 开机自启。服务重启保留账号、会话、历史和显式记忆，Android App 退出进程后仍需重新登录。公网版仍只有动作预览，电脑关机后当前模拟器聊天服务不可用。

App 聊天使用独立模型适配器，不混入 QQ 群聊/点歌提示；模型不可用时返回错误，不降级成测试回显。模型密钥仅在后端 `.env`。

生产部署 `PET_HOST=0.0.0.0`；必须配置 HTTPS `PET_PUBLIC_URL`、持久化 `PET_DATA_DIR`。Secure Cookie 由公网地址决定。部署后家庭电脑关机不影响服务。

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

## 云端部署材料

`pet-app/Dockerfile` 用仓库根目录为构建上下文，只复制此应用，不复制 `.env`、QQ数据或本地备份。`pet-app/render.yaml` 是带付费实例和持久磁盘的草案，未经预算确认不得应用。现有免费测试服务保持原样；不将真实私人数据存放在免费实例临时文件系统。

正式上线前尚需：确认付费套餐和预算、设置模型/语音密钥、配置独立备份及每日调度、检查删除日志镜像、验证 iPhone/Android 真机和容量。不能只因开发测试通过就宣称这些外部条件已完成。

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

脚本目前使用Windows已安装的Chrome路径，可按本机浏览器路径调整。完整验证和外部待办见 `../docs/superpowers/plans/2026-11-13-dafeyu-pwa-validation.md`。公网动作预览为 https://qqbot-public-web-test.onrender.com ，不开放账号或聊天。
