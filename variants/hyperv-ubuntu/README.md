# Hyper-V Ubuntu 变体：动态聊天背景 + 启动开场

这个目录把上游项目的美术素材和思路，改造成适合 **Windows 11 Hyper-V 里的 Ubuntu 虚拟机**（无 GPU 加速、软件渲染）的版本：
- 一个主题副本：只读使用官方 apt 安装，不修改它。
- 一组构建、切换和回滚脚本。
- 可行性分析和实测记录。

上游的 WSL 相关技术方案不在本变体中使用。

> 状态：已在 Claude Desktop 3.6556.2（Electron 44）上完成实测，作为日常客户端使用中。

## 目标环境

| 项目 | 情况 | 影响 |
|---|---|---|
| 系统 | Ubuntu 24.04，GNOME（Wayland），运行在 Hyper-V 虚拟机里 | 不需要 WSLg、X11 强制或 Fcitx 适配 |
| 客户端 | 官方 apt 版 Claude Desktop 3.6556.2 | 上游只适配 4.29.0，不能直接安装 |
| 显卡 | 只有 `hyperv_drm`，没有 GPU 加速；渲染、合成、视频解码全靠 CPU | 素材要控制帧率，按电源和焦点暂停 |
| 屏幕 | 1680×1050，GNOME 175% 分数缩放 | 1080p 素材正好合适 |
| CPU | 6 个 vCPU；用电池时性能约为插电的一半 | 插电和用电池分别设计 |
| 音频 | 虚拟机没有音频输出 | 开场无声 |

## 效果

**开场**
- 只保留人物睁眼片段：从原片第 1 秒截到第 5 秒，60 帧，共 4 秒，无声。
- 特效保持轻量：从暗处淡入并轻微推近、睁眼时的暖光、上飘的光点、右上角打字文字（“Claude 启动……”和“欢迎回来，Master”）。
- 插电时播放视频。用电池时改为已睁眼的静态图，特效和文字时间线不变。
- 视频播完时，如果对话界面还没加载好，就停在最后一帧并显示“正在连接 Claude……”，等界面加载好再直接淡入，最多等 20 秒。这样网络慢时不会先看到白屏或灰色的加载画面。
- 点击画面或按 Esc、空格、回车可以跳过。

**聊天背景**
- 1080p24 循环视频，只铺在聊天区，侧栏和标题栏不受影响。
- 上面盖一层 65% 的遮罩，浅色和深色主题各有对应颜色。
- 输入框默认透明：去掉底色，保留边框和阴影。
- 背景在以下情况暂停：开场播放时、窗口隐藏或失焦时、用电池时；丢帧过多时自动定格为静态画面。

## 目录内容

```text
variants/hyperv-ubuntu/
├─ README.md                    本文档
├─ preview.html                 效果预览页（浏览器直接打开，可和上游原版对比）
├─ runtime/                     装进主题副本的文件
│  ├─ moe-bootstrap.cjs         新入口：先挂上开场和背景，再原样加载官方入口
│  ├─ startup-cover.cjs         开场覆盖层（主窗口上方的临时视图）
│  ├─ chat-background.cjs       背景的主进程部分：注入、暂停规则
│  ├─ chat-background.js        背景的页面部分：识别聊天区、贴合、遮罩、丢帧降级
│  ├─ chat-background.mp4/.jpg  1080p24 循环背景及首帧
│  └─ splash/                   开场页、睁眼视频（60 帧）和已睁眼静态图
├─ scripts/
│  ├─ build.py                  从官方安装构建主题副本，并校验原文件不变
│  ├─ claude-moe                启动器：官方更新后自动重建，失败时启动官方版
│  ├─ install.sh                安装到用户目录；加 --desktop 接管桌面图标
│  ├─ switch.sh                 切换到主题版（含登录数据备份），或用 --official 切回官方版
│  └─ uninstall.sh              卸载并恢复官方入口
└─ tests/
   ├─ isolated-run.sh           用一次性的独立配置启动主题副本，不影响正在使用的 Claude
   └─ selftest.html             模拟聊天布局的测试页，用来验证背景
```

## 安装与使用

需要 Python 3.11 以上和官方 apt 版 Claude Desktop。所有脚本都用普通用户运行，不需要 sudo。

```bash
# 1. 安装并构建主题副本（桌面图标仍打开官方版）
bash variants/hyperv-ubuntu/scripts/install.sh

# 2. 可选：用独立配置试运行约 45 秒，事件记录写在工作目录里
#    可以用 CLAUDE_MOE_CONFIG 指定一个测试用的 config.json
bash variants/hyperv-ubuntu/tests/isolated-run.sh /tmp/claude-moe-test 45

# 3. 彻底退出 Claude（菜单 > 退出，或 Ctrl+Q），然后切换
bash variants/hyperv-ubuntu/scripts/switch.sh

# 切回官方版（主题副本保留）
bash variants/hyperv-ubuntu/scripts/switch.sh --official

# 卸载
bash variants/hyperv-ubuntu/scripts/uninstall.sh
```

`switch.sh` 依次做以下几件事：
1. 确认 Claude 已经退出。
2. 备份登录和会话数据，不含缓存，备份文件权限为 600，存放在 `~/.local/share/claude-moe/backups/`。
3. 让 Dock 图标、右键菜单快捷项和 `claude://` 链接改为打开主题版。如果桌面上还有一份单独复制的 Claude 图标，就把它备份，换成指向同一份启动文件的链接，这样以后切换版本时它也会跟着变。
4. 首次以诊断模式启动主题版。

开场里的称呼写在 `runtime/splash/splash.html` 的 `.welcome` 元素中，改完重新运行 `install.sh` 即可。

### 配置

配置文件是 `~/.local/share/claude-moe/config.json`。遮罩浓度 `wash` 改完**立即生效**，正在运行的 Claude 会马上更新所有打开的聊天页面；其他项改完要重启 Claude 才生效。

想对着真实界面比较不同浓度，用这条命令最方便，每次运行背景都会当场变化：

```bash
~/.local/share/claude-moe/bin/claude-moe --wash 0.75
```

把 `0.75` 换成其他数字就能来回对比。范围是 0 到 0.95，填写超出范围或不是数字时会提示错误，配置不会被修改。直接编辑 `config.json` 里的 `wash` 并保存，效果也一样。

全部配置项：

| 键 | 默认值 | 说明 |
|---|---|---|
| `splash` | `true` | 是否播放开场 |
| `splashWaitForApp` | `true` | 开场播完后，是否等对话界面加载好再结束 |
| `splashMaxWait` | `20` | 最多等几秒，0 到 60；设为 0 表示不等待 |
| `background` | `true` | 是否显示聊天背景 |
| `wash` | `0.65` | 遮罩浓度，0 到 0.95，数值越大背景越淡；修改后立即生效 |
| `composer` | `"transparent"` | 输入框样式：`transparent` 去掉底色，`solid` 保留底色 |
| `pauseWhenUnfocused` | `true` | Claude 不在前台时暂停背景 |
| `diagnostics` | `false` | 记录背景位置和丢帧情况，写在 `~/.config/Claude/claude-moe/status.json` |

事件日志只记录事件类型、耗时、尺寸和元素属性名，不记录任何对话内容。

## 工作原理

- **改包副本**：Electron 的 `RunAsNode`、`NODE_OPTIONS`、`--inspect` 相关 Fuse 都已关闭；应用发现 `--remote-debugging-port` 等调试开关会拒绝启动。所以采用改包副本：副本只复制主程序，其余文件都是指向官方安装的符号链接，共约 290MB。重打包 `app.asar` 时只改 `package.json` 的 `main`，新增三个脚本，官方原有的 614 个打包文件逐个比对，必须完全一致。`EnableEmbeddedAsarIntegrityValidation` 虽然开着，重新计算各文件的完整性后可以正常启动。
- **沙箱**：`chrome-sandbox` 链接到官方的 setuid 版本，渲染进程的沙箱保持开启。
- **主窗口识别**：用“没有父窗口、可见、最小尺寸 600×400”来识别官方主窗口，并且要等窗口构造完成后再判断，因为触发 `browser-window-created` 事件时最小尺寸还没生效。快捷输入窗口是 606×470 但创建时隐藏，不会误判。开机隐藏启动时不播开场。
- **背景注入**：聊天界面加载自远端 `https://claude.ai`，它的 CSP 允许 blob 视频，背景脚本运行在隔离环境中。在桌面版里，Chat、Code 和 Project 是同一个页面（`/epitaxy`），注入一次后靠监听页面结构变化跟着界面切换，流式输出的文字不会触发重新扫描。页面的权限策略禁止 `unload` 事件，所以清理工作放在 `pagehide` 里做。
- **遮罩浓度实时生效**：主进程监视配置文件所在的目录。因为很多编辑器保存时会替换文件本身，所以监视目录而不是单个文件。检测到 `wash` 变化后，等 0.2 秒避免重复触发，再把新值推送到所有已打开的聊天页面，之后打开的页面也使用新值。
- **开场等待界面**：主进程每 0.4 秒在另一个隔离环境里检查 claude.ai 页面：出现输入框，或者非对话页已加载完，就算就绪，然后通知开场页结束。这项检查只看元素是否存在，不读取内容，最多检查 40 秒。
- **桌面入口**：用户级 `.desktop` 文件不带 `X-Claude-Generated=true` 标记，官方程序就不会覆盖它。Claude 自己生成的入口会另存一份，切回官方版时原样恢复。重复安装时也以这份备份为模板，所以“继续上次会话”等右键菜单项不会丢失。
- **桌面图标**：桌面上手动复制的 Claude 图标，是一个独立文件（`Exec=claude-desktop`），会一直打开官方版。安装时把它备份到 `~/.local/share/claude-moe/desktop-icons/`，再换成指向上述入口的链接，并设为可执行、标记为允许启动；卸载时会恢复原文件。
- **开机自启**：Claude 写入的自启项会直接调用程序路径，主题版在启动和退出时把它改为经过启动器，`switch.sh` 和 `uninstall.sh` 也会同步修改。
- **浏览器扩展**：主题版会把浏览器扩展的 Native Messaging 清单写成副本路径，卸载时会改回官方路径。
- **防止误重建**：主题版运行时，构建脚本拒绝重建，避免替换正在运行的文件；启动器会在下次启动时重建。

## 实测数据

**预览阶段**：插电，Edge 原生 Wayland 窗口，175% 缩放，测量前确认窗口在渲染。CPU 以“占一个核心的百分比”计，整机 6 个核心合计 600%。

| 场景 | 丢帧 | 额外 CPU（单核） |
|---|---|---|
| 背景 1080p24，聊天区大小（约 1190×842 像素） | 0 | 约 +117%，约占整机 20% |
| 背景 1080p30（上游原版），同条件 | 0 | 约 +149% |
| 背景 4K60 原片 | 0 | 约 +280% |
| 开场插电（60 帧视频，全窗口） | 3/210（1.4%） | 约 2 个核心，持续约 4 秒 |
| 开场电池（静态图 + 特效） | 不播视频 | 约 1.5 个核心，持续约 4 秒 |
| 上游原版开场（全窗口） | 约 60% | 光效和画布叠在视频上导致；单独播放同一视频不丢帧 |

**实际使用**：主题版运行在真实的 Claude 里。
- 开场在 0.6 到 0.7 秒挂上，约 6 秒播完（网络正常时，界面在开场结束前就已就绪，所以不会额外等待）。
- 背景在 Code 页播放 319 帧丢 1 帧，贴合误差为 0。
- 背景播放时 Claude 加 gnome-shell 约占 1 个核心，整机 18%。
- 和官方版相比，没有新增日志错误。

**结论**
- 主要开销是 gnome-shell 的窗口合成，降帧率比降分辨率更有效。
- 用电池时 CPU 性能约减半，所以背景暂停、开场改用静态图。

## 素材再生成

在仓库根目录用 FFmpeg 6 执行：

```bash
ffmpeg -i assets/original-videos/live2d_4k60_loop.mp4 \
  -vf "scale=1920:1080:flags=lanczos,fps=24" -an -c:v libx264 -preset slow -crf 21 \
  -profile:v high -level 4.0 -pix_fmt yuv420p -g 48 -movflags +faststart \
  variants/hyperv-ubuntu/runtime/chat-background.mp4
ffmpeg -i variants/hyperv-ubuntu/runtime/chat-background.mp4 -frames:v 1 -q:v 3 \
  variants/hyperv-ubuntu/runtime/chat-background.jpg

ffmpeg -ss 1.0 -t 4.0 -i assets/original-videos/live2d_awake_4k60.mp4 \
  -vf "scale=1920:1080:flags=lanczos" -an -c:v libx264 -preset slow -crf 20 \
  -profile:v high -level 4.2 -pix_fmt yuv420p -g 60 -movflags +faststart \
  variants/hyperv-ubuntu/runtime/splash/video/awake.mp4
ffmpeg -ss 4.4833 -i assets/original-videos/live2d_awake_4k60.mp4 -frames:v 1 \
  -vf "scale=1920:1080:flags=lanczos" -q:v 2 \
  variants/hyperv-ubuntu/runtime/splash/video/awake-still.jpg
```

## 已知问题

- **输入框仍有白底**：Chat 和 Code 对话里的输入框，在透明模式下背后还有白色。透明模式会特意保留输入元素本身和紧贴它的一层，白色应该画在这两层之一，或者在一个单独的背景层上，还没进一步处理。
- **右键菜单不会自动更新**：主题版的桌面入口不带官方标记，官方以后新增的右键菜单快捷项不会自动出现。要用上新的菜单项，按以下步骤操作：
  1. 运行 `switch.sh --official` 切回官方版。
  2. 删除 `~/.local/share/applications/com.anthropic.Claude.desktop` 和备份 `~/.local/share/claude-moe/com.anthropic.Claude.desktop.before-moe`。
  3. 启动一次官方版，让它重新生成入口，然后退出。
  4. 运行 `switch.sh`，切回主题版。
- **诊断记录有局限**：桌面版内部切换页面时不会触发浏览器的页面内导航事件，所以诊断模式只在页面加载后记录几次。
- **网络慢时的加载画面**：开场结束后如果看到灰色的占位界面或白屏，原因是 claude.ai 的账号接口和资源加载慢，跟主题无关，官方版也会这样。实测在公共 Wi-Fi 或虚拟机刚开机的几分钟里出现过：账号信息要 7 到 11 秒才返回，资源预连接超时，正常时只要约 1 秒。现在开场会尽量等到界面加载好再结束；超过等待上限后，仍会显示 claude.ai 自己的加载画面。加载慢时尽量不要反复重启 Claude，否则每次都要从头加载。

## 风险

- **安全性**：副本在用户目录，同一用户的其他程序能改写它。官方文件归 root 所有，所以这比官方安装弱；启动前的哈希校验只能缓解。
- **AppArmor**：官方的放行规则只覆盖 `/usr/lib/claude-desktop` 路径，副本靠 SUID 沙箱运行。目前 Claude Code 使用正常，Cowork 的辅助进程能正常启动，但 Cowork 功能本身还没实际测过。
- **远端页面变化**：聊天页面结构随时可能改变，背景找不到聊天区时会自动不显示，不影响聊天功能。
- **非官方**：这是非官方改造，不在官方支持范围内。

## 许可与来源

- 接入代码基于上游 `claude-moe-theme` 的 MIT 代码改写，见仓库根目录的 `LICENSE` 和 `NOTICE.md`。
- 本目录的图片和视频由上游 `assets/original-videos/` 中的原片裁剪和转码而来，只改变了分辨率、帧率和时长，不增加任何素材授权。素材权利和来源标记以上游说明为准。
- Claude 名称和标志属于 Anthropic，本项目为非官方定制。
