# 大肥鱼 Android 客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为用户 Redmi K80 Pro 交付只在 App 内运行的 Godot 二维宠物 APK，消除移动浏览器的视频播放器呈现。

**Architecture:** 新建 `pet-native/`，以 Godot AnimatedSprite2D 播放由合法上游透明视频提取的二维帧图集。触摸、拖动与按钮在本机即时响应；聊天页通过 HTTPS 连接既有 pet-app 接口，模型密钥不进入 APK。应用不创建桌面悬浮窗、不运行 QQ/WSL。

**Tech Stack:** 固定 Godot 4.7.2 stable、GDScript、Python/FFmpeg/Pillow 素材转换、Android APK。优先使用已有 WSL Java/SDK 和 Windows 模拟器，不改动既有 android/ 工程。

**Spec:** `../specs/2026-11-13-dafeyu-pwa-design.md` 加上本计划的已确认变更：PWA 客户端调整为独立 Android App；用户明确只在 App 内，不要桌面悬浮。云端多人独立记忆、非商业素材许可、备份及付费预算边界不变。

## Global Constraints

- 不使用 WebView/VideoPlayer 展示角色，不携带模型密钥，不宣称真机验证已完成。
- 首个 APK 提供约10个基础动作片段，包含入睡/循环/醒来；更多动作以后按需转换。
- 保留 CC BY-NC-SA 4.0 素材署名及修改说明，Godot MIT、中文字体 OFL 分别保留。
- 只修改新客户端和本次脚本，保留现有 QQ 用户工作；不购买新服务。

## Review Focus

- 透明通道不能在 VP9 解码中丢失；图集裁切不可截断角色动作。
- 只加载当前及少量缓存动作，避免一次载入114组未压缩纹理。
- 拖动不可越出房间；滑动/拖动不能被误判成摸摸。
- 退出/切换账号时，迟到网络结果不可显示上一账号数据。
- Android 包为独立ID，不覆盖原QQ管理App；调试签名必须明确、保存以支持升级。

## Task 1: 工具链及转换器

Files: `scripts/pet-native-assets.py`、`test/pet_native_assets_test.py`、`pet-native/assets/`。

- [x] 先测试 alpha边界、图集布局、帧序和空帧拒绝；运行失败后实现。
- [x] 固定并校验 Godot 官方下载；只获取所需 Android 模板，优先复用 SDK/JDK。
- [x] FFmpeg 使用 libvpx-vp9 保留 alpha，12fps；按整段动作 alpha 联合边界裁切，统一256×256帧，16帧/图集。保留出处和转换参数。
- [x] 验证图集透明、帧数/首尾顺序及大小，下载明确OFL许可中文字体。

## Task 2: 原生房间与动作状态

Files: `pet-native/project.godot`、`pet-native/main.tscn`、`pet-native/main.gd`、`pet-native/pet_state.gd`、`pet-native/tests.gd`。

- [x] 先写 Godot 状态测试：替换动作不排队、三段睡眠与唤醒、拖动边界与点击阈值。
- [x] 实现竖屏自适应房间、角色触摸拖动、6个动作按钮、字幕反馈和许可页；暂停后停止渲染更新，回前台恢复。
- [x] 使用 AnimatedSprite2D/AtlasTexture，不创建视频或网页组件；限制动作缓存数量。
- [x] Godot headless 运行真实脚本测试及导入检查。

## Task 3: 独立云端账号和聊天入口

Files: `pet-native/api_client.gd`、`main.gd`、测试。

- [x] 验证URL和响应解析、拒绝不可信明文公网HTTP、每次请求有版本令牌。
- [x] 实现设置服务器地址、邀请注册、登录/退出、私人文字聊天和历史；首版会话仅保存在内存，不明文持久化密码/会话。
- [x] 默认服务器为现有动作预览，明确提示它尚未开放聊天；不把503伪装为正常回复。
- [x] 用本机 pet-app 测试账号验证真实HTTP契约；APK不打包本地 .env/账号数据。

## Task 4: APK、模拟器验证与交付

Files: `pet-native/export_presets.cfg`、`scripts/build-pet-native.sh`、`pet-native/README.md`、`artifacts/dafeyu-native-*.apk`。

- [x] 导出arm64 APK给K80 Pro，必要时单独导出x86_64测试包；验证签名、包ID和权限不含悬浮窗。
- [x] 现有模拟器安装/启动，实际触摸动作、拖动和睡眠唤醒；截图检查是否原生绘制且无播放器控件。
- [x] 一次独立只读审查新客户端，修复重要问题并回归。
- [ ] 通过原免费服务提供APK下载及SHA256；下载不开放真实账号或上传数据。
- [x] 明确模拟器/构建验证与K80 Pro真机验收区别，记录语音原生接入及正式云端资源待办。

## Execution ledger

- 2026-11-13：用户确认 Android Redmi K80 Pro，且角色只在App内；按已授权开发继续，不重复请求开始。
- Ruling: 新客户端独立目录/包ID，保持PWA和后端可用，避免覆盖已有未提交的 android/。
- Ruling: 首轮转常用动作图集，验证手感后扩大素材范围；源视频有固定动作，逐帧转换本身不会生成新的骨骼动作。
- Task 1–3 完成：3项Python图集测试、Godot动作/URL状态测试、真实场景边界/取消/切页回归、真实pet-app HTTP注册/聊天/迟到响应隔离通过。
- Task 4：独立审查指出高屏拖动越界和多指切页卡住，已修复；另修复首次零尺寸布局偏移并加回归。ARM64与x86_64包导出，v2/v3签名及16KiB ZIP对齐通过。
- API35独立模拟器：默认SwiftShader有Godot上游已知uniform限制，切换host/NVIDIA后显示正常；六按钮、拖动、sleep_start/loop/end实际触摸日志验证。Windows宿主Godot根证书读取告警不影响localhost契约，Android公网TLS仍待真机验证。
- ARM64包63,384,073字节，SHA256 a642dd296e71fd4d5231efebd33ed06287861c0e6e65cf2a0cd4341aa3c0a1dd。只包含arm64-v8a，默认公网仍是无账号动作预览。
- 进行中：免费预览服务下载发布与公网校验；K80 Pro真机验收需用户安装，原生语音、正式云端数据库与备份未上线。
