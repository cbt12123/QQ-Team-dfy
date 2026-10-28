# 部署指南：Ubuntu / WSL + NapCat

本文部署服务器端机器人和管理后台。先跑通文字聊天，再开启主动接话、美食和语音。Windows 使用 WSL2 Ubuntu；原生 Ubuntu 服务器跳过第 1 节。最小部署不需要 Docker、GPU 或语音模型。

示例统一使用 `/opt/qqbot`，与仓库的 systemd 模板一致。Linux 安装步骤在 root shell 执行，这是当前模板的运行方式。若改用普通用户，需要同时调整服务的 `User`、`HOME`、文件权限和后台重启服务的权限。

## 准备清单

- WSL2 Ubuntu 或启用 systemd 的 Ubuntu 服务器。
- Node.js >= 20.12；下文以系统路径 `/usr/bin/node` 的 Node.js 24 为例。
- 用于机器人的 QQ 账号、一个测试群。
- 支持 OpenAI 兼容 Chat Completions 的模型服务与 API Key。
- 可选：高德 **Web 服务** Key，需要相应 POI 检索权限和可用配额。

NapCat 属于非官方 QQ 接入，建议使用单独的机器人账号。本文不涉及 Android 打包。

## 1. Windows：安装 WSL 和启用 systemd

在 Windows 管理员 PowerShell 中执行：

```powershell
wsl --install -d Ubuntu
wsl --update
wsl --list --verbose
```

首次打开 Ubuntu，按提示创建 Linux 用户。已有环境只需确认目标发行版使用 WSL2。下文的 `Ubuntu` 应替换成列表中的实际发行版名称。

在 Ubuntu 中检查 PID 1：

```bash
ps -p 1 -o comm=
```

如果输出是 `systemd`，不必修改。否则执行 `sudo nano /etc/wsl.conf`，保留原有设置，在已有 `[boot]` 节设置或新增：

```ini
[boot]
systemd=true
```

保存工作后，在 Windows PowerShell 重启 WSL。注意第一条命令会停止所有 WSL 发行版及其中的进程。

```powershell
wsl --shutdown
wsl -d Ubuntu
```

再次检查 PID 1。参考 [Microsoft 的 systemd 指南](https://learn.microsoft.com/en-us/windows/wsl/systemd)。

## 2. Linux：安装依赖和 Node.js

进入 Ubuntu 后，以下 Bash 命令在 root shell 中执行：

```bash
sudo -i
apt-get update
apt-get install -y git curl ca-certificates nano xvfb xauth dbus-x11 python3 python3-venv ffmpeg openssl
```

检查现有 Node.js，符合要求时可跳过安装：

```bash
node --version
npm --version
command -v node
```

没有时，可按 [NodeSource 的 Debian/Ubuntu 安装方式](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_24.x) 安装：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/qqbot-nodesource-setup.sh
bash /tmp/qqbot-nodesource-setup.sh
apt-get install -y nodejs
/usr/bin/node --version
```

两个机器人服务的 `ExecStart` 使用 `/usr/bin/node`。如果使用 nvm 或其他安装路径，必须改成实际绝对路径，不能依赖交互终端的 PATH。

## 3. 克隆项目和填写配置

新安装执行：

```bash
git clone https://github.com/cbt12123/QQ-Team-dfy.git /opt/qqbot
cd /opt/qqbot
npm install --omit=dev --no-package-lock
cp .env.example .env
chmod 600 .env
nano .env
```

已有部署不要再次复制示例文件覆盖 `.env`，更新方式见第 10 节。

在 `.env` 中修改现有同名行，**不要重复追加同名配置**。把 `YOUR_...` 替换成实际值；每项单行填写，不需要把文件 `source` 到 shell。

```env
ADAPTER=napcat
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_ACCESS_TOKEN=YOUR_RANDOM_ONEBOT_TOKEN
NAPCAT_ALLOWED_GROUPS=YOUR_TEST_GROUP_QQ
NAPCAT_PRIVATE_ALLOWED_USERS=YOUR_PERSONAL_QQ

LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=YOUR_MODEL_API_KEY
LLM_MODEL=deepseek-chat
BOT_NAME=大肥鱼
REPLY_ENABLED=1
BOT_DRY_RUN=0
DATA_DIR=./data

# 首次先测试文字聊天，额外功能之后再开
PROACTIVE_ENABLED=0
FOOD_ENABLED=0
VOICE_ENABLED=0
BREEZE_ENABLED=0
SVS_ENABLED=0
VISION_ENABLED=0
IMAGE_GEN_ENABLED=0
```

模型地址、Key 和模型名称必须在同一服务商账号下可用。未填写模型 Key 时只会演示复读。

群白名单留空表示不限制群；私聊白名单留空则禁止私聊。多个号码用英文逗号分隔。可以用以下命令生成 OneBot Token，再分别填入 `.env` 和 NapCat；它不是模型 Key，也不要求与 NapCat WebUI 的登录 Token 相同。

```bash
openssl rand -hex 24
```

## 4. 安装 NapCat、登录 QQ、配置 OneBot

此流程采用 Shell 安装，与仓库的 NapCat 服务模板对应。参考 [NapCat 官方安装文档](https://napneko.github.io/guide/boot/Shell)。以下命令仍在 root shell 中运行，默认安装到 `/root/Napcat`：

```bash
cd /root
curl -fL --connect-timeout 20 --max-time 1800 -o napcat.sh https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh
bash napcat.sh --docker n --cli n --github-proxy 0
test -x /root/Napcat/opt/QQ/qq
cd /root/Napcat/opt/QQ
xvfb-run -a ./qq --no-sandbox
```

按启动日志提示打开 WebUI、扫码登录。WebUI 常见端口为 `6099`，具体地址与登录 Token 以实际日志为准。让机器人 QQ 加入测试群；使用私聊时也需确认好友关系。

在 WebUI 新增或编辑 **OneBot 11 → WebSocket 服务器（正向 WS）**：

| 配置 | 值 |
| --- | --- |
| 启用 | 开 |
| 监听地址 | `127.0.0.1` |
| 端口 | `3001` |
| 消息格式 | `array` |
| Token | 与 `.env` 的 `NAPCAT_ACCESS_TOKEN` 一致 |
| 上报自身消息 | 关 |

保存后运行 `ss -lnt`，确认 `127.0.0.1:3001` 在监听。进程运行不代表 QQ 已登录或 OneBot 已就绪。

仓库的 `scripts/setup-napcat-config.mjs` 会覆盖指定配置文件，且默认路径依赖安装版本。新部署优先使用 WebUI，不要直接拿脚本覆盖已有配置。

## 5. 前台验证文字聊天

保持 NapCat 运行，另开一个 Ubuntu 终端执行：

```bash
sudo -i
cd /opt/qqbot
npm start
```

日志应出现 `NapCat 已连接`。在测试群里 @机器人发送 `/ping`，应收到 `pong`；再问一个普通问题，确认模型正常回答。没有 QQ 回复时，检查群白名单、`BOT_DRY_RUN=0` 和发送错误日志。

前台测试成功后按 `Ctrl+C` 停止机器人，避免随后与 systemd 实例同时运行。后台保存会调用 `systemctl restart qqbot`，请完成下一节后再使用后台保存配置。

## 6. 安装 systemd 服务和打开后台

停止前台机器人与 NapCat。若已有同名 unit，先查看并备份现有文件，保留自定义参数。

```bash
cd /opt/qqbot
cp deploy/qqbot.service /etc/systemd/system/qqbot.service
cp deploy/qqbot-admin.service /etc/systemd/system/qqbot-admin.service
cp deploy/napcat.service /etc/systemd/system/napcat.service
nano /etc/systemd/system/napcat.service
```

把 `YOUR_BOT_QQ` 改成已登录的机器人 QQ 号，核对 `WorkingDirectory`、QQ 路径、`User=root` 与前面的安装一致。其他 NapCat 安装方式参考 [官方 systemd 文档](https://napneko.github.io/guide/boot/Linux_startup)，不能照抄 Shell 路径。

```bash
systemctl daemon-reload
systemctl enable --now napcat qqbot qqbot-admin
systemctl is-active napcat qqbot qqbot-admin
journalctl -u qqbot -n 30 --no-pager
curl --fail http://127.0.0.1:8787/api/health
```

健康检查返回 `{"ok":true}` 代表后台 HTTP 可用，不验证 QQ 登录或模型功能。仍需确认日志中的 NapCat 连接，以及 QQ 中 `/ping` 和普通问答。

在 Windows 浏览器打开 [管理后台](http://127.0.0.1:8787)。后台默认仅监听本机，没有独立登录认证。远程 Linux 服务器可在自己的电脑上建立 SSH 转发后访问：

```bash
ssh -N -L 8787:127.0.0.1:8787 YOUR_SSH_USER@YOUR_SERVER
```

不要直接把后台、OneBot 端口暴露到公网。

### WSL 关掉终端后打不开

systemd 启用服务只在发行版启动后生效；服务本身不会阻止 WSL 退出，见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/wsl/systemd)。在 Windows PowerShell 中启动隐藏保活进程：

```powershell
$qqbotWslProcess = Start-Process -FilePath wsl.exe -ArgumentList @('-d','Ubuntu','--exec','/bin/sleep','infinity') -WindowStyle Hidden -PassThru
$qqbotWslProcess.Id
```

这只保持当前登录会话运行，不是 Windows 开机启动任务。注销或重启后需要重新运行；关机、休眠、`wsl --shutdown` 也会中断服务。需要无人值守时，可自行通过任务计划程序在登录后运行，或部署到长期在线的 Linux 主机。

## 7. 开启自然接话与人设

后台「功能管理」开启主动接话，「关系与范围」填写允许主动发言的群，「对话与记忆」调整概率和冷却。等价配置：

```env
PROACTIVE_ENABLED=1
PROACTIVE_GROUPS=YOUR_TEST_GROUP_QQ
PROACTIVE_CHANCE=0.35
PROACTIVE_COOLDOWN_SEC=120
PROACTIVE_MAX_PER_HOUR=10
PROACTIVE_DEBOUNCE_MS=3000
PROACTIVE_FOLLOWUP_WINDOW_SEC=120
PROACTIVE_FOLLOWUP_COOLDOWN_SEC=3
PROACTIVE_QUIET_HOURS=1-7
```

`0.35` 是进入模型判断的概率，不是必回复概率。普通问句同样按概率判断，模型可以沉默。机器人回复后，同一人可在续聊窗口内不再 @ 地聊天，仍受静默时段与每小时上限约束。明确 @ 别人时跳过主动接话。

群 @ 必回以回复开关、白名单和服务正常工作为前提。要使用“大肥鱼”预设，在「人设与模型」里选择；仅修改 `BOT_NAME` 不会自动套用人设。亲友关系不是启动必需项。

后台“保存并应用”会重启机器人。手工修改 `.env` 后需执行 `systemctl restart qqbot`。

## 8. 开启附近美食与外卖候选

在「功能管理 → 附近美食」填写高德 **Web 服务** Key，开启并保存。也可修改现有 `.env` 配置：

```env
FOOD_ENABLED=1
AMAP_API_KEY=YOUR_AMAP_WEB_SERVICE_KEY
FOOD_RADIUS_METERS=3000
FOOD_MAX_RESULTS=3
FOOD_TIMEOUT_MS=12000
FOOD_SESSION_TTL_MINUTES=10
```

[高德应用管理](https://console.amap.com/dev/key/app) 中需有 POI 2.0 文本定位与周边检索权限、配额。浏览器 JS 类型 Key 不能代替 Web 服务 Key。

测试时 @机器人，避免把概率沉默误认为故障：

```text
上海泗泾地铁站附近帮我找找外卖
30元以内想吃面
便宜点
换一批
上海泗泾地铁站附近餐厅
```

外卖请求筛选快餐、小吃、便当、面饭类候选，标注 **配送待确认**，不输出链接。人均不是平台到手价，候选不是平台实时配送名单。接口范围见 [餐饮接口说明](food-apis.md)。

位置不明确会追问。查询条件按平台、群、用户隔离并临时保存；`/reset` 清除当前对话和查询条件。群聊旁听记录按单独的保留时间过期，不会一起清除。

## 9. 可选功能

### edge-tts 语音：不需要 GPU

在 Ubuntu root shell 执行：

```bash
python3 -m venv /opt/qqbot/.venv-tts
/opt/qqbot/.venv-tts/bin/pip install edge-tts
/opt/qqbot/.venv-tts/bin/edge-tts --help
```

修改配置后重启机器人：

```env
VOICE_ENABLED=1
BREEZE_ENABLED=0
VOICE_EDGE_BIN=/opt/qqbot/.venv-tts/bin/edge-tts
VOICE_ALWAYS=0
```

测试“发条语音说晚安”；用 `/语音`、`/文字`、`/语音 自动` 调整当前聊天偏好。语音依赖网络，以及 NapCat 能读取生成的音频文件。本指南将机器人和 NapCat 部署在同一 Linux 环境。

### Breeze GPU 语音：额外部署

未部署时保持 `BREEZE_ENABLED=0`，否则会先等待 Breeze 失败，再尝试后备语音。

Git 仓库不含模型权重，也不含 `breeze/Dockerfile` 中 `COPY breeze-tts/` 所需的上游源码目录，仅克隆仓库无法直接完成镜像构建。需要自行按 [Breeze TTS 2 模型页面](https://huggingface.co/BreezeBlue/Breeze-TTS-2) 准备源码、模型和 GPU 服务，确认 `/v1/audio/speech` 接口兼容后再启用。

应用默认访问 `http://127.0.0.1:7860`，临时音频默认路径是 `/opt/qqbot/data/voice`。自定义部署目录时需核对代码中的 Breeze 路径。唱歌服务目前建议保持 `SVS_ENABLED=0`。

### 图片

先确认当前 `LLM_BASE_URL` 和 Key 下有支持图像输入的模型，再开启 `VISION_ENABLED=1` 并配置 `VISION_MODEL`。示例模型名称不是服务商可用性承诺。生图可独立设置 `IMAGE_GEN_ENABLED=1`，第三方服务的连通性需单独测试。

### 官方 QQ 机器人

使用 QQ 开放平台时，设置 `ADAPTER=official`、`QQ_APP_ID`、`QQ_APP_SECRET` 和可选的 `QQ_ALLOWED_GROUPS`。官方群标识是 `group_openid`，不是普通群号。普通群聊旁听、主动接话及本文 NapCat 私聊和媒体流程不适用于该接入；本文主要验收路径为 NapCat。

## 10. 更新、备份与回滚

先记录当前提交号和工作区状态。停止机器人与后台后，备份 `.env` 和数据，再更新代码：

```bash
cd /opt/qqbot
git status --short
git rev-parse HEAD
systemctl stop qqbot qqbot-admin
backup_dir="/opt/qqbot-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
cp -p .env "$backup_dir/.env"
if [ -d data ]; then cp -a data "$backup_dir/data"; fi
git pull --ff-only
npm install --omit=dev --no-package-lock
systemctl start qqbot qqbot-admin
journalctl -u qqbot -n 30 --no-pager
```

有本地修改时先处理，不要强制覆盖。拉取或安装失败时先解决或回滚，不要把最后一条启动命令当作更新成功。默认数据目录为 `data/`；自定义 `DATA_DIR` 时替换备份路径。QQ 登录状态位于 NapCat 运行用户的配置目录，需要单独备份。

不要用 `.env.example` 覆盖现有配置。回滚时切回之前记录的提交，重新安装依赖、启动并验收；需要恢复记忆文件时，先停止机器人再从备份还原。

修改 systemd unit 后要 `systemctl daemon-reload`；仅改 `.env` 不需要，只需重启机器人。

## 11. 排错与验收

| 现象 | 检查方向 |
| --- | --- |
| 后台打不开 | `qqbot-admin` 状态、8787 监听、WSL 是否退出；远程访问使用 SSH 转发 |
| NapCat 运行但 QQ 无回复 | 扫码登录、3001 监听、Token、群白名单；服务运行不等于 QQ 在线 |
| 反复连接失败 | 是否配置正向 WS、Token 是否一致、OneBot 是否已启动 |
| 只会复读 | 模型 Key 未配置，或机器人未重启读取配置 |
| 模型 401/404 或超时 | Key、可用配额、模型名称、API 地址与 Linux 网络 |
| 不主动接话 | 开关、主动群名单、概率、静默时段、冷却与上限；先 @ `/ping` 排除掉线 |
| 地图查询失败 | Web 服务 Key、POI 权限、配额与网络；高德 Key 不能获取平台实时配送数据 |
| 语音慢或回文字 | 未部署 Breeze 却启用了优先调用；edge-tts 路径、网络、音频发送错误 |
| `.env` 改了无效 | 改错目录、未重启、重复配置项，或进程环境变量覆盖文件 |
| 一条消息回复两次 | 前台与 systemd 实例同时运行，或其他工作区副本也在运行 |

常用只读排查命令：

```bash
systemctl status qqbot qqbot-admin napcat --no-pager
journalctl -u qqbot -n 80 --no-pager
journalctl -u napcat -n 80 --no-pager
ss -lnt
curl --fail http://127.0.0.1:8787/api/health
```

代码测试使用以下 **Linux Bash** 命令，只运行测试目录，避免默认发现机制误执行 `scripts/send-voice-test.mjs` 这个真实发送工具：

```bash
cd /opt/qqbot
node --test test/*.test.js
```

自动化测试不能代替真实 QQ 验收。至少确认：@ `/ping`、普通模型回答、开启后不 @ 接话、后台保存生效，以及美食查询返回无链接的简短候选。私聊、语音和图片按实际启用项分别验收。

配置、Key、聊天记录、QQ 登录文件仅放本地或自己的备份，不上传公开仓库。
