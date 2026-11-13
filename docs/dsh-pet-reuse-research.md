# dsh-pet 动作与复用调查

核查日期：2026-11-13。调查后的执行更新：用户明确接受非商业复用并要求开发，已下载114个固定版本WebM、核对Git blob SHA并保存署名/许可。未整包运行上游项目、未引入不明字体/表情包/音效。已发布不接收账号与聊天数据的动作预览，详见 PWA 验证记录。

## 项目与固定版本

很可能对应用户所说的 DSH 桌宠：PC2005-cloud/dsh-pet。包描述明确为蓝色“大肥鱼”，但最终仍以用户对形象的确认为准。

- 仓库：https://github.com/PC2005-cloud/dsh-pet
- 核查提交：`4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca`
- 动画目录：https://github.com/PC2005-cloud/dsh-pet/tree/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca/dsh-pet/assets/webm
- 对该提交的完整 Git tree 清点：114 个 WebM 文件，共约 55.15 MiB；这不是 114 个独立交互功能，例如睡觉由开始、循环、醒来多段组成。

## 授权结论：代码与素材必须分开

1. 根目录与包内 LICENSE 均为 MIT，版权人为 PC2005-cloud。复用相应代码需保留版权及完整许可声明；不能据此把形象和其他素材一并宣称为 MIT。
2. README 的许可节单独规定动画、提示词和源视频允许开源使用，并要求参考角色形象授权。衍生/改版/换皮项目的 GitHub、官网等公开渠道要附原项目地址。
3. README 标明原型“溟月”作者为 B 站 @上善无形，DeepSeek 版女仆鲸鱼娘设计为 @ZipZipPipe，且不是 DeepSeek 官方形象。其引用的角色许可是 CC BY-NC-SA 4.0。
4. 已直接读取 @ZipZipPipe 的声明，确认其明确主张 CC BY-NC-SA 4.0 和禁止商业化。本文不是对整个角色历史权利链或每项第三方素材的完整法律审计。
5. CC BY-NC-SA 要求适当署名、链接许可、注明修改，非商业使用，分发改编作品时遵循相同或兼容许可。该义务针对受许可作品/改编物，不能简单推导为整个独立后端和所有业务代码都必须套用 CC。
6. 因此，“免费供家人朋友非商业使用，按要求署名和分享相关衍生素材”是可推进的方向；将来收费、广告、商业推广或其他商业使用，需另行获得相关权利人的许可，或替换为权利清晰的原创角色与素材。仅仅不向用户收费，不自动证明所有场景都属于非商业。
7. 字体 `上首软糖体.ttf`、表情包、声音、第三方图形及依赖需单独确认许可；当前清点没有找到逐项完整授权证据，不能无条件整包纳入分发。默认不引入它们，字体可用系统字体，音效/图片可用自制或明确允许的资源。

核查来源：

- README 许可：https://github.com/PC2005-cloud/dsh-pet/tree/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca#许可
- MIT：https://github.com/PC2005-cloud/dsh-pet/blob/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca/LICENSE
- 角色作者声明：https://www.bilibili.com/opus/1247156596114456581
- CC 协议摘要：https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
- CC 完整协议：https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.zh-hans

## 可参考的动作与交互

实际文件包含：待机呼吸、左右转向、跑动、点击挥手/害羞/生气/开心/挠痒、拖拽悬空、吃白饭/零食/火锅等、玩魔方/秋千/游戏、伸懒腰、吐泡泡、说话碎碎念、思考/工作/成功/出错、入睡/循环/醒来，以及节日动作。

README 还描述拖拽甩抛反弹、随机动作衔接、菜单点播、对话触发动作和触屏操作。实现原理可用于当前 PWA，不需要抓取未公开接口或绕过访问限制。

## 适配大肥鱼 PWA 的实际边界

- 授权满足后，可从公开仓库固定提交提取所需代码、动画、配置，并保留许可和来源；不把“已下载”当作“已完成逐项授权审查”。
- 上游对外 HTTP 接口按本机可信环境设计，无鉴权，不能直接公开给多用户使用；继续使用本项目自己的登录与隔离后端。
- 复用前端动画播放器、可分离的动作/物理逻辑与动作清单，接入已有大肥鱼聊天引擎，而不是整体搬入 DSH 宿主、Electron、单用户聊天存储及余额功能。
- 资源库可支持全部已获许可动作，但首屏只载入待机和少量常用资源，其余按需加载；约 55 MiB 不应在每次进入时全部下载。
- 透明视频兼容需实机验证。上游说明 Safari/WKWebView 需要 HEVC-alpha MOV；查到的 `assets-mov` Release 描述为 106 个素材，少于当前 114 个 WebM，不能假设已一一齐备。
- 上游制作说明包含水印处理工具；当前任务不执行这些工具，不移除权利/来源标识。直接复用已获许可发布资源，不以移除标识替代许可。

技术来源：

- 功能：https://github.com/PC2005-cloud/dsh-pet/blob/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca/FEATURES.md
- 配置：https://github.com/PC2005-cloud/dsh-pet/blob/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca/dsh-pet/assets/config.jsonc
- 制作与兼容：https://github.com/PC2005-cloud/dsh-pet/blob/4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca/MAKE-YOUR-OWN-PET.md
- MOV Release：https://github.com/PC2005-cloud/dsh-pet/releases/tag/assets-mov

## 后续执行条件

用户已接受非商业和共享条件；逐项资源清单及SHA见 `pet-app/public/assets/actions.json`，署名及原许可见 `pet-app/public/licenses/`。未新增商业授权，未联系任何作者，未购买新服务；复用现有免费服务发布了无私人数据的动作预览。
