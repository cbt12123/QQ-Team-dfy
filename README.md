# QQTeam-dfy

一个接入 QQ 群的聊天机器人，支持官方 QQ 机器人与 NapCat（OneBot 11）两种接入方式，带 DeepSeek 对话、群聊上下文、联网搜索、主动接话和 Web 管理后台。

> NapCat 属于非官方方案，存在账号风控/封禁风险。请使用单独的小号，不要用主号。

- 仓库：<https://github.com/cbt12123/QQ-Team-dfy>
- 管理后台：`http://127.0.0.1:8787`
- 从零部署：[Ubuntu / WSL 完整部署指南](docs/deployment.md)（含 NapCat、后台、自然接话、美食、更新和排错）

## 功能

- 群内 `@机器人` 对话，回复会带上 @
- 指定 QQ 私聊机器人，私聊有独立记忆，不进入群上下文
- “大肥鱼”人设：开朗、体贴、调皮、爱碎碎念，只对指定爸爸账号叫爸爸
- 天气查询：Open-Meteo，无需 Key，默认西安
- 看图：DeepSeek 视觉模型，读取图片内容/截图文字
- 生图：Pollinations 免 Key，生成后发到群或私聊
- 语音：Breeze TTS 2 正常说话，失败回退 edge-tts；唱歌暂停
- DeepSeek / 任意 OpenAI 兼容接口
- 每个用户独立对话记忆，持久化到磁盘
- 旁听群聊最近 50 条消息，作为 @ 回复的上下文
- 读取合并转发聊天记录与“回复转发消息”
- 联网搜索：遇到“查资料 / 搜一下 / 推荐 / 最新 / 案例”等消息时先搜索再回答
- 主动接话：按概率、冷却和每小时上限参与群聊，不 @ 人
- 不需要先 @ 才能开始聊天：主动接话开启后，普通消息（包括问句）按概率进入模型判断，模型可选择沉默。
- 机器人回复后，同一用户默认 120 秒内可自然续聊，无需再次 @；引用近期机器人消息也可续聊。续聊使用单独的短冷却，仍受每小时上限、静默时段及群白名单约束。明确 @ 别人或引用其他消息时跳过主动接话。
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

# 允许私聊机器人的 QQ；留空表示禁止私聊
NAPCAT_PRIVATE_ALLOWED_USERS=你的QQ号

# 大肥鱼的家庭设定：只有这个 QQ 会被叫“爸爸”
FAMILY_FATHER_QQ=你的QQ号
FAMILY_FATHER_CITY=西安
FAMILY_FATHER_JOB=程序员

# 其他亲友关系：QQ:称呼:城市:职业:备注，多个用逗号分隔
FAMILY_RELATIONS=2913487935:星河叔叔:上海:后端程序员:爸爸的发小,2823115642:妈妈:海口:应用数学博士:特别牛的学霸

# 天气（默认西安）
WEATHER_ENABLED=1
WEATHER_CITY=西安
WEATHER_LATITUDE=34.3416
WEATHER_LONGITUDE=108.9398

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

## 大肥鱼人设与家庭设定

管理后台的“性格”里选择 **大肥鱼**：

- 她知道自己的名字叫大肥鱼
- 性格开朗、体贴、有点调皮，会关心人，也会碎碎念
- 只有 `FAMILY_FATHER_QQ` 对应的账号会被她叫“爸爸”
- 其他群友不会被叫爸爸，避免公开认亲
- 家庭设定默认：爸爸在西安，是程序员

关系信息由服务端按消息发送者的 QQ 注入，不依赖模型自己猜。所以多群接入时，即使爸爸在别的群说话，也能正确识别。

其他亲友也通过 QQ 映射，可以带城市、职业和关系备注：

```env
FAMILY_RELATIONS=2913487935:星河叔叔:上海:后端程序员:爸爸的发小,2823115642:妈妈:海口:应用数学博士:特别牛的学霸
```

机器人对 `2913487935` 会称呼“星河叔叔”，并记住他是爸爸的发小、在上海做后端程序员；对 `2823115642` 会称呼“妈妈”，记住她在海口读应用数学博士、是特别牛的学霸。不会叫爸爸，也不会把关系套到别人身上。管理后台的“其他亲友关系”输入框默认隐藏。

## 看图与生图

### 看图

使用 DeepSeek 视觉模型 `deepseek-flash`，复用现有的 `LLM_API_KEY`：

```env
VISION_ENABLED=1
VISION_MODEL=deepseek-flash
VISION_MAX_IMAGES=3
VISION_TIMEOUT_MS=20000
```

在群里 @ 机器人并附上图片，例如：

```text
@大肥鱼 看看这张图里是什么
@大肥鱼 帮我读一下这张截图里的文字
```

私聊也支持。QQ 图片会先下载，再以 base64 图片输入模型。

### 生图

使用 [Pollinations](https://pollinations.ai/)，免 API Key：

```env
IMAGE_GEN_ENABLED=1
IMAGE_GEN_BASE_URL=https://image.pollinations.ai/prompt
IMAGE_GEN_WIDTH=1024
IMAGE_GEN_HEIGHT=1024
```

直接说：

```text
@大肥鱼 画一张赛博朋克风格的西安城墙
@大肥鱼 画一只在西安吃泡馍的猫
```

生成后会把图片发到群里/私聊，并附一句短文字。当前生图只支持 NapCat；官方机器人接入方式不会发送生成的图片。

注意：看图需要模型服务能访问图片 URL；生图由第三方 Pollinations 提供，网络不稳定时可能失败。

## 语音（Breeze TTS 2）

正常说话优先使用 [Breeze TTS 2](https://huggingface.co/BreezeBlue/Breeze-TTS-2)，通过独立 GPU 容器提供，失败时自动回退 edge-tts。

模型权重约 **7.6GB**，不提交到 Git。放到：

```text
/opt/qqbot/models/breeze-tts-2/
```

下载地址：<https://huggingface.co/BreezeBlue/Breeze-TTS-2>

构建并启动：

```bash
cd breeze
docker build -t qqbot-breeze:latest .
docker run -d --name qqbot-breeze --gpus all --ipc=host \
  -p 127.0.0.1:7860:7860 \
  -v /opt/qqbot/models:/models:ro \
  --restart unless-stopped \
  qqbot-breeze:latest
```

`BREEZE_INSTRUCTION` 控制音色，默认是可爱活泼的少女音：

```env
BREEZE_ENABLED=1
BREEZE_URL=http://127.0.0.1:7860
BREEZE_INSTRUCTION=一位可爱、活泼、声音清甜的少女，说话自然亲切，带一点调皮，像在跟爸爸聊天。
BREEZE_CFG_SCALE=4
BREEZE_SEED=42
BREEZE_TIMEOUT_MS=120000
```

显存：eager 约 7.7GB，16GB 显卡可用；`--fast-all` 约 14.4GB，不建议在 16GB 上和别的模型同时跑。

触发方式：

```text
@大肥鱼 发条语音说晚安
@大肥鱼 用语音说一句鼓励我的话
```

私聊也支持。Breeze 返回 PCM，机器人转成 mp3 后通过 NapCat 的 `record` 段发送，不会发文件卡片。

### 让机器人给亲友发语音

只有爸爸的私聊可以发起，且目标必须在 `FAMILY_RELATIONS` 里：

```text
给妈妈发语音，说我想她了
给星河叔叔发条语音，告诉她我周末过去
```

机器人会：

1. 生成语音
2. 通过 NapCat 私聊发给目标 QQ
3. 给爸爸回一句文字确认：“已经用语音发给妈妈了。”

不会把语音发回爸爸当前聊天，也不允许给未记录的 QQ 发。非爸爸账号发这类指令会被拒绝。目标必须是机器人好友，否则发送会失败。

### 文字 / 语音切换

默认是**自动模式**：文字回复，只有消息里说“发语音 / 用语音 / 说给我听”等才回语音。

每个聊天可以单独设置，设置按“群 + QQ”保存，重启不丢：

```text
/语音          之后默认语音
/语音 开       同上
/文字          之后默认文字
/语音 关       同上
/语音 自动     恢复“说发语音才回语音”
/语音 状态     查看当前模式
```

说明：

- `/文字` 后仍然可以直接说“发条语音”来单次触发语音。
- 群里设置只影响你这个 QQ 的消息，不影响其他群友。
- 后台“全部用语音”开关是全局覆盖；用户用 `/文字` 可以把自己切回文字。
- 命令本身的回复始终是文字，不会用语音回复。

> 授权：Breeze TTS 2 源码 Apache-2.0，模型权重和自托管输出仅允许研究/非商业使用；商用需联系 BreezeBlue 获取授权。

### edge-tts 后备

语音使用 [edge-tts](https://pypi.org/project/edge-tts/)，不需要 API Key。

```bash
python3 -m venv .venv-tts
.venv-tts/bin/pip install edge-tts
```

在 `.env` 配置：

```env
VOICE_ENABLED=1
VOICE_EDGE_BIN=/opt/qqbot/.venv-tts/bin/edge-tts
VOICE_NAME=zh-CN-XiaoyiNeural
VOICE_RATE=+8%
VOICE_PITCH=+6Hz
VOICE_MAX_CHARS=300
```

触发方式：

```text
@大肥鱼 发条语音说晚安
@大肥鱼 用语音说一句鼓励我的话
```

私聊也支持。生成的 mp3 会通过 NapCat 的 `record` 段发送，文件和临时音频会定期清理。

`VOICE_ALWAYS=1` 可以把所有文字回复都转成语音；默认关闭，避免延迟和刷屏。

### 真唱歌：DiffSinger 容器（当前暂停）

> 当前只做 Breeze 正常说话，SVS 容器已停止，`SVS_ENABLED=0`。以下保留为后续恢复用。

唱歌是独立的 SVS 服务，不占用机器人进程：

```text
QQ -> NapCat record -> 机器人 -> http://127.0.0.1:8765/sing
                                      |
                              qqbot-svs 容器（GPU）
                              DiffSinger + 绮萱声库
```

使用声库：**绮萱 v2.7.0**（Qixuan，中文可爱少女声线）。
声库与 vocoder 体积较大，不提交到 Git，需要放到 `/opt/qqbot/models`：

```text
/opt/qqbot/models/qixuan/Qixuan_v2.7.0_DiffSinger_OpenUtau/
/opt/qqbot/models/vocoder/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx
```

下载：

- 声库：<https://github.com/yqzhishen/qixuan-diffsinger/releases/tag/v2.7.0>
- vocoder：<https://github.com/openvpi/vocoders/releases/tag/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02>

构建并启动容器：

```bash
cd svs
# 本地已有 ubuntu-gpu-python:3.10 时可用它加速；不传则用公共 CUDA 镜像
docker build --build-arg BASE_IMAGE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 \
  -t qqbot-svs:latest .
docker run -d --name qqbot-svs --gpus all \
  -p 127.0.0.1:8765:8765 \
  -v /opt/qqbot/models:/models:ro \
  --restart unless-stopped \
  qqbot-svs:latest
```

或者：

```bash
cd svs
docker compose up -d
```

首次加载模型约 30～60 秒，之后 GPU 推理一段 4 秒唱段约 2～5 秒。

`.env` 配置：

```env
SVS_ENABLED=1
SVS_URL=http://127.0.0.1:8765
SVS_TIMEOUT_MS=30000
SVS_STEPS=20
```

触发：

```text
@大肥鱼 唱首歌
@大肥鱼 唱一首小星星
```

当前默认旋律是《小星星》；如果歌词不是小星星，会用同一旋律套歌词。后续可以加 MIDI/自定义旋律。

**授权说明**：绮萱声库使用条款允许非商业/商业作品和网络合成服务，但公开发布需标注“绮萱 / DiffSinger”和 AI 合成。机器人发送唱歌语音时会附带：

```text
AI 合成：绮萱 / DiffSinger
```

不要把声库文件、人物形象图或模型权重提交到本仓库。详细条款见声库压缩包内的 `Terms_of_Use.zh-CN.pdf`。

## 天气

默认使用 [Open-Meteo](https://open-meteo.com/)，免 API Key：

```env
WEATHER_ENABLED=1
WEATHER_CITY=西安
WEATHER_LATITUDE=34.3416
WEATHER_LONGITUDE=108.9398
```

遇到“天气 / 气温 / 下雨 / 带伞 / 多少度”等问题时，会先取实时天气再回答，并在回复里带上城市和温度。父亲问天气时，大肥鱼会以女儿口吻提醒带伞、加衣。

## 私聊权限

默认禁止私聊。只允许白名单里的 QQ 私聊机器人：

```env
NAPCAT_PRIVATE_ALLOWED_USERS=你的QQ号
```

多个 QQ 用英文逗号分隔。私聊消息有独立的对话记忆，不会写入群聊上下文，也不会触发主动接话。管理后台的“私聊白名单 QQ”也可以修改，输入框默认隐藏。

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
- 群号、私聊 QQ、爸爸 QQ、亲友关系输入框默认隐藏，点击“显示”才展开
- 概览里的群号、私聊 QQ、爸爸 QQ 使用掩码显示
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

## 附近美食与外卖候选

在管理后台「功能管理 → 附近美食」填写高德 **Web 服务** Key（需要 POI 2.0 检索权限与可用配额），保存并应用。Key 只写入服务端 `.env`，后台 API 只返回是否配置。

聊天示例：

```text
上海泗泾地铁站附近有什么餐厅推荐？30元以内想吃面。
我在西安市小寨地铁站，找1公里内的餐厅。
便宜点
近一点
换一批
```

群里沿用已有的 @ 必回、普通消息按概率参与及续聊机制；私聊直接处理。位置必须来自当前用户提供的信息，不会从亲友人设或其他群友的聊天里猜测。城市或具体位置不清楚会追问，地图返回多个相距较远的地标时会要求补充区县。支持高德 GCJ-02 坐标，格式为 `经度,纬度`。

使用高德 `/v5/place/text` 解析地标，再调用 `/v5/place/around` 搜索餐饮类 POI。返回简短的“店名＋参考人均＋相对搜索中心的直线距离＋地图评分”列表，不发送链接或长地址。未知评分省略，未知价格标为待确认。根据候选范围内的评分、距离与预算筛选；“便宜点”“近一点”可以调整排序，“换一批”排除本轮已经推荐的店。

**外卖按适合点外卖的候选处理。** 明确要求外卖时，优先筛选快餐、小吃、便当、面饭类店铺，排除茶艺馆、宴会餐厅等结果，并在回复中标注“配送待确认”。地图人均不是外卖到手价，门店是否在平台营业及能否配送需在 App 确认。也可发商家列表截图辅助挑选。不会再直接拒绝外卖请求，但不会声称拿到了实时可配送商家名单。


查询条件只在进程内临时保存，按平台、群、用户隔离，默认 10 分钟；原始对话仍按既有聊天记忆设置保存。`/reset` 同时清除当前对话和餐饮查询条件。

```env
FOOD_ENABLED=1
AMAP_API_KEY=你的高德Web服务Key
FOOD_RADIUS_METERS=3000
FOOD_MAX_RESULTS=3
FOOD_TIMEOUT_MS=12000
FOOD_SESSION_TTL_MINUTES=10
```

接口核验与接入范围见 [餐饮接口说明](docs/food-apis.md)。
