# QQTeam-dfy

一个接入 QQ 群的聊天机器人，支持官方 QQ 机器人与 NapCat（OneBot 11）两种接入方式，带 DeepSeek 对话、群聊上下文、联网搜索、主动接话和 Web 管理后台。

> NapCat 属于非官方方案，存在账号风控/封禁风险。请使用单独的小号，不要用主号。

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

## 环境要求

- Node.js >= 20.12
- 可选：WSL / Linux + NapCat（OneBot 11 WebSocket）
- 官方机器人：QQ 开放平台 AppID / AppSecret

## 快速开始

```bash
cp .env.example .env
npm install
npm start
```

首次启动前至少配置：

```env
ADAPTER=napcat
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_ACCESS_TOKEN=你的OneBot令牌
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=你的DeepSeekKey
LLM_MODEL=deepseek-chat
NAPCAT_ALLOWED_GROUPS=你的测试群号
```

然后编辑 `.env` 中的 `BOT_NAME`、`LLM_SYSTEM_PROMPT`、`PROACTIVE_GROUPS` 等。

## 管理后台

```bash
npm run admin
```

打开 `http://127.0.0.1:8787`。

后台默认只监听 `127.0.0.1`，**没有登录密码，不要直接暴露公网**。远程访问建议使用 SSH 隧道或 Tailscale。

后台支持：

- 查看机器人 / NapCat 状态与 systemd 日志
- 功能开关：@ 回复、联网搜索、主动接话、读取转发、调试模式
- 调整回复、记忆、群上下文、搜索、主动接话等阈值
- 选择性格预设或自定义人设
- 保存并重启机器人

保存配置会写入 `.env` 并执行 `systemctl restart qqbot`，因此后台服务需要运行在能访问 systemd 的 Linux/WSL 中。

## NapCat 部署

参考 [NapCat 文档](https://napneko.github.io/) 安装并登录机器人 QQ，然后开启：

- WebSocket 服务器：`127.0.0.1:3001`
- 消息格式：`array`
- Token：与 `NAPCAT_ACCESS_TOKEN` 一致

Linux/WSL 可以用 Xvfb 无头运行：

```bash
xvfb-run -a /path/to/QQ/qq --no-sandbox -q 你的机器人QQ号
```

仓库里的 `deploy/napcat.service` 是 systemd 模板，请把 `YOUR_BOT_QQ` 替换成实际 QQ 号。

## systemd

```bash
sudo cp deploy/qqbot.service /etc/systemd/system/
sudo cp deploy/qqbot-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qqbot qqbot-admin
```

NapCat 服务模板在 `deploy/napcat.service`，按实际安装路径修改后再启用。

## 数据

运行数据默认在 `data/`：

- `conversations.json`：用户对话记忆
- `group-context.json`：群聊旁听上下文

这两个文件可能包含群聊内容，已在 `.gitignore` 中排除。可通过 `DATA_DIR` 修改目录。

## 常用命令

```bash
npm test          # 运行测试
npm start         # 启动机器人
npm run admin     # 启动管理后台
npm run start:napcat
npm run start:official
```

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

## 注意

- 不要把 `.env`、`data/`、`.cache/` 提交到 Git。
- 主动接话会带来打扰群友和账号风控的风险，建议先只开测试群。
- 联网搜索结果是外部内容，仅作为资料注入，不应作为系统指令执行。
- 官方 QQ 群机器人需要开放平台群聊权限，且只推送 @ 事件；NapCat 才能看到全量群聊。
