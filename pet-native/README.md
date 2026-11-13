# 大肥鱼 Android 原生预览

仅在 App 内运行的 Godot 2D 客户端。独立包名 `com.dafeyu.pet`，不覆盖原 QQ 管理 App；不申请悬浮窗、录音、文件访问权限。角色由透明图集和 AnimatedSprite2D 绘制，无 WebView 或视频播放器。

提供摸摸、开饭、挥手、伸懒腰、吐泡泡、拖动、睡眠与唤醒，共10段动画。首次动作切换需加载纹理；仅缓存待机及当前动作。离开房间暂停动画，退出 App 不在后台显示角色。

0.1.1 修复触摸无法聚焦表单的问题，保留控件的触摸转鼠标事件，房间单独忽略重复的模拟鼠标事件；调深输入提示文字，预览服务器注册会明确提示尚未开放。

0.1.2 增加软键盘避让，输入框和发送按钮保持可见。本机模拟器已连接真实聊天后端，沿用原账号；公网默认地址仍仅用于动作预览，不代表手机已接入云端聊天。无需把模型密钥填写到 App。

## 安装与连接

给 Redmi K80 Pro 使用 `artifacts/dafeyu-native-arm64-debug.apk`。这是调试签名预览包，Android 需要允许下载所用浏览器安装未知应用。升级需使用同一调试签名；签名保存在本机忽略目录 `.cache/pet-godot/debug.keystore`，不要提交。

默认连接免费公开动作预览服务器，该服务尚未提供注册、聊天、记忆保存。房间动作离线可用；设置页可填已部署的 pet-app HTTPS 地址并使用邀请注册/登录。密码及会话只在内存中保存，退出后需重新登录；模型密钥不进入 APK。会话切换会清空历史并丢弃旧请求结果。

多人账号及独立记忆由 `pet-app/` 服务承担，原生客户端已通过本地真实 HTTP 契约验证。正式云端数据存储、备份及预算仍待确定；本次没有购买服务。原生录音和语音播放尚未接入。

## 可复现构建

固定 Godot 4.7.2。Windows Python 需要 Pillow，解码使用 WSL FFmpeg 的 libvpx-vp9，构建复用 WSL Android SDK/JDK21。工具下载脚本校验官方摘要或 ZIP CRC。

```powershell
python scripts/setup-pet-godot.py
python scripts/setup-pet-native-font.py
python scripts/decode-pet-native.py
python scripts/pet-native-assets.py --frames .cache/pet-native-frames --output pet-native/assets/frames --manifest pet-native/action_sources.json
python -m unittest discover -s test -p pet_native_assets_test.py
node scripts/test-pet-native-api.mjs .cache/pet-godot/Godot_v4.7.2-stable_win64_console.exe
wsl bash /mnt/g/dsh_workspace/qqbot/scripts/build-pet-native.sh
```

构建脚本运行状态和真实场景交互回归，导出独立 ARM64、x86_64 包，并检查签名、16KiB ZIP 对齐、SHA256。不同工作区须修改调用路径，可用 `PET_ANDROID_SDK`、`PET_JAVA_HOME` 指定已有工具链。

`api_contract_tests.gd` 使用临时 pet-app 测试实例，覆盖注册、Cookie、聊天及切换身份后的迟到响应；测试脚本不打入 APK。测试配置在项目目录外 `.cache/pet-native-api-fixture.json`，不得使用真实账号。

`form_input_tests.gd` 向真实场景注入触摸和键盘事件，验证四个设置字段与聊天框。API35 模拟器另实际验证软键盘、逐项填写、注册201、账号和历史查询200。临时测试后端的聊天只是回显，不能作为真实模型聊天验证。

本机专用模拟器 `Dafeyu_API35` 即使设置 `hw.keyboard=no`，仍可能暴露 `AT Translated Set 2 keyboard`，Godot 会主动抑制软键盘。2026-11-13 在确认该模拟器的 `/sys/bus/serio/drivers/atkbd/serio0` 后，通过 adb root 及解除该驱动绑定验证键盘弹出；只影响该测试模拟器，重启会恢复。勿将这一步用于手机或其他模拟器。仅检查 AVD 配置不足以证明软键盘可用。

## 素材与许可

动作取自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 固定版本 `4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca`。动画 PC2005-cloud，原型“溟月”上善无形，DeepSeek版设计 ZipZipPipe。角色及动画 CC BY-NC-SA 4.0：非商业、署名、修改素材同许可共享。本项目不是 DeepSeek 官方产品。

转换为12fps透明帧，按整段动作 alpha>16 的联合边界裁切、缩放至256像素方格并合并图集；Godot 使用保留 alpha 的有损 WebP纹理（质量0.85）。原视频文件名及 Git blob SHA 在 `action_sources.json`，生成参数与帧坐标在 `assets/actions.json`。修改后的图集保持相同许可，源码及图集随仓库提供。

Godot MIT、上游代码 MIT 与 Noto Sans CJK OFL 文本分别在 `licenses/`、`assets/fonts/OFL.txt`。未引入上游不明许可表情包、音效、字体或水印工具。
