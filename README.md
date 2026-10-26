# QQTeam-dfy

一个接入 QQ 群的聊天机器人，支持官方 QQ 机器人与 NapCat（OneBot 11）两种接入方式，带 DeepSeek 对话、群聊上下文、联网搜索、主动接话和 Web 管理后台。

> NapCat 属于非官方方案，存在账号风控/封禁风险。请使用单独的小号，不要用主号。

- 仓库：<https://github.com/cbt12123/QQ-Team-dfy>
- 管理后台：`http://127.0.0.1:8787`

## 功能

- 群内 `@机器人` 对话，回复会带上 @
- DeepSeek / 任意 OpenAI 兼容接口
- 每个用户独立对话记忆，持久化到磁盘
- 旁听群聊最近 50 条消息，作为 @ 回复的上下文
- 读取合并转发聊天记录与“回复转发消息”
- 联网搜索：遇到“查资料 / 搜一下 / 推荐 / 最新 / 案例”等消息时先搜索再回答
- 主动接话：按概率、冷却和每小时上限参与群聊，不 @ 人
- 5 个性格预设 + 自定义人设
- Web 管理后台：状态、功能开关、阈值、性格、日志、重启
- 所有服务通过 systemd 守护

## 部署要求

- Node.js >= 20.12
- Linux / WSL（推荐 Ubuntu）
- NapCat + 一个单独的机器人 QQ 小号
- DeepSeek API Key
- 目标 QQ 群号

## 1. 克隆并安装

```bash
git clone https://github.com/cbt12123/QQ-Team-dfy.git
cd QQ-Team-dfy
npm install
```

## 2. 配置 `.env`

```bash
cp .env.example .env
```

编辑 `.env`，至少填写下面这些。**不要把 `.env` 提交到 Git。**

```env
ADAPTER=napcat

# NapCat 的 OneBot WebSocket
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_ACCESS_TOKEN=你的OneBotToken

# DeepSeek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=你的DeepSeekKey
LLM_MODEL=deepseek-chat

# 机器人名字
BOT_NAME=阿岚

# 允许 @ 回复的群，多个用英文逗号分隔；留空不限制
NAPCAT_ALLOWED_GROUPS=你的测试群号

# 允许主动接话的群
PROACTIVE_ENABLED=1
PROACTIVE_GROUPS=你的测试群号
```

其他可调项都在 `.env.example` 里有注释，也可以启动后直接在管理后台修改。

> Key、群号、Token 只在本地 `.env` 和管理后台里填写，不要写进 README、代码或提交记录。

## 3. 安装并登录 NapCat

参考 [NapCat 文档](https://napneko.github.io/) 安装并登录机器人 QQ，然后开启：

- WebSocket 服务器：`127.0.0.1:3001`
- 消息格式：`array`
- Token：与 `NAPCAT_ACCESS_TOKEN` 一致

Linux/WSL 可以用 Xvfb 无头运行：

```bash
xvfb-run -a /path/to/QQ/qq --no-sandbox -q 你的机器人QQ号
```

仓库里的 `deploy/napcat.service` 是 systemd 模板，请把 `YOUR_BOT_QQ` 替换成实际 QQ 号。

## 4. 启动机器人

```bash
npm start
```

看到下面这类日志说明连接成功：

```text
NapCat 已连接，等待群 @ 消息
```

在群里 @ 机器人发 `/ping` 测试。

## 5. 启动管理后台

```bash
npm run admin
```

打开：

```text
http://127.0.0.1:8787
```

后台可以：

- 查看机器人 / NapCat 状态和日志
- 开关 @ 回复、联网搜索、主动接话、读取转发、调试模式
- 调整回复、记忆、上下文、搜索、主动接话阈值
- 选择性格预设或自定义人设
- 保存配置并重启机器人

后台只监听 `127.0.0.1`，**没有登录密码，不要直接暴露公网**。远程访问建议用 SSH 隧道或 Tailscale。

## 6. systemd 常驻

```bash
sudo cp deploy/qqbot.service /etc/systemd/system/
sudo cp deploy/qqbot-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qqbot qqbot-admin
```

NapCat 服务模板在 `deploy/napcat.service`，按实际安装路径修改后再启用。

常用命令：

```bash
systemctl status qqbot qqbot-admin napcat
journalctl -u qqbot -f
systemctl restart qqbot
```

## 敏感信息处理

- `.env` 已被 `.gitignore` 排除，不会进仓库
- `data/` 中的对话记忆和群聊上下文已被排除
- `.cache/` 中的二维码、安装包、截图已被排除
- 管理后台不会返回 DeepSeek Key 明文
- 群号输入框默认隐藏，点击“显示”才展开
- 概览里的群号使用掩码显示
- 后台日志中的 groupId / userId / userName / Key 会自动脱敏
- 不要把管理后台、`.env`、日志截图发到公开群或仓库

如果不小心把 Key 推到公开仓库，立刻去 DeepSeek 控制台吊销并重新生成。

## 数据目录

默认在 `data/`：

- `conversations.json`：用户对话记忆
- `group-context.json`：群聊旁听上下文

可通过 `.env` 的 `DATA_DIR` 修改。删除这两个文件即可清空历史数据。

## 目录

```text
admin/             Web 管理后台
src/adapters/      官方 QQ Bot / NapCat 适配器
src/chat/          对话、记忆、群上下文、主动接话
src/search/        联网搜索
src/personas.js    性格预设
deploy/            systemd 模板
test/              自动化测试
```

## 常用命令

```bash
npm test              # 运行测试
npm start             # 启动机器人
npm run admin         # 启动管理后台
npm run start:official
npm run start:napcat
```

## 注意

- NapCat 不是官方接口，账号风险自行承担。
- 官方 QQ 群机器人需要开放平台群聊权限，且默认只推送 @ 事件；NapCat 才能看到全量群聊。
- 主动接话会打扰群友，建议先只开测试群并设置冷却/每小时上限。
- 联网搜索结果只是外部资料，不应当作系统指令执行。
