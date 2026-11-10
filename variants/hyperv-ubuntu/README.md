# Hyper-V Ubuntu 变体：动态聊天背景 + 启动开场

这个目录把上游项目的美术素材改造成适合 **Windows 11 Hyper-V 里的 Ubuntu 虚拟机**（无 GPU 加速、软件渲染）使用的版本，并记录了可行性分析和接入方案。上游的 WSL 相关技术方案不在本变体中使用。

> 状态：素材和开场页已完成并实测；接入 Claude Desktop 的主进程代码正在开发和测试，测试通过后再加入本目录。

## 目标环境

| 项目 | 情况 | 影响 |
|---|---|---|
| 系统 | Ubuntu 24.04，GNOME（Wayland），运行在 Hyper-V 虚拟机里 | 不需要 WSLg、X11 强制或 Fcitx 适配 |
| 客户端 | 官方 apt 版 Claude Desktop 3.6556.2（Electron 44） | 上游只适配 4.29.0，不能直接安装 |
| 显卡 | 只有 `hyperv_drm`，没有 GPU 加速；渲染、合成、视频解码全靠 CPU | 素材要控制帧率和尺寸，并按电源状态降级 |
| 屏幕 | 1680×1050，GNOME 175% 分数缩放 | 1080p 素材正好合适 |
| CPU | 6 个 vCPU；用电池时性能约为插电的一半 | 插电和用电池分别设计 |
| 音频 | 虚拟机没有音频输出 | 开场无声 |

## 目录内容

```text
variants/hyperv-ubuntu/
├─ README.md                      本文档（方案与实测）
├─ preview.html                   效果预览页（用浏览器打开，可和上游原版对比）
└─ runtime/
   ├─ chat-background.mp4         聊天循环背景：1080p24，5 秒 120 帧，无声
   ├─ chat-background.jpg         背景首帧，用电池时作为静态背景
   └─ splash/
      ├─ splash.html              精简版开场页（重写）
      └─ video/
         ├─ awake.mp4             睁眼片段：1080p60，4 秒 240 帧，无音轨
         └─ awake-still.jpg       已睁眼静态帧，用电池时的开场画面
```

## 与上游的区别

**聊天背景**
- 由 1080p30 改为 **1080p24**，清晰度相同，实测 CPU 开销约少 21%。
- 遮罩透明度默认 **50%**（上游浅色 70%、深色 74%）。

**开场**
- 去掉线稿、上色、画布特效和合成音效，只保留人物睁眼片段。
- 片段从原片第 1 秒截到第 5 秒，**60 帧**，共 4 秒；30 帧版本观感不够流畅，3.5 秒版本节奏偏快。
- 保留了轻量特效：从暗处淡入并轻微推近、睁眼时的暖光、上飘的光点、右上角打字文字。这些动画都只改透明度和位移，不使用全屏画布或模糊滤镜。
- 文案为“Claude 启动……”和“欢迎回来，Master”。
- 按电源选择内容：插电播 60 帧视频；用电池时显示已睁眼的静态图，特效和文字时间线不变，视频文件完全不加载。
- 与上游启动代码的接口不变：通过标题 `CLAUDE_SPLASH_READY / PLAYING / DONE` 通知宿主，提供 `__claudeBeginPlayback`、`__claudeStopSound`，支持 `?launcher` 和 `?embedded` 参数。新增参数 `?power=ac|battery`；缺省时读取浏览器电池接口。视频无法解码时自动改用静态图。

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

## 实测数据

测试条件：插电，Edge 原生 Wayland 窗口，175% 缩放，测量前确认窗口正在渲染。CPU 以“占一个核心的百分比”计，整机 6 个核心合计 600%。

| 场景 | 丢帧 | 额外 CPU（单核） |
|---|---|---|
| 背景 1080p24，聊天区大小（约 1190×842 像素） | 0 | 约 +117%，约占整机 20% |
| 背景 1080p30（上游原版），同条件 | 0 | 约 +149% |
| 背景 4K60 原片 | 0 | 约 +280%，约占半台机器 |
| 开场插电（60 帧视频，全窗口） | 3/210（1.4%，3.5 秒版） | 约 2 个核心，持续约 4 秒 |
| 开场电池（静态图 + 特效） | 不播视频 | 约 1.5 个核心，持续约 4 秒 |
| 上游原版开场（全窗口） | 约 60%（182/301、190/301） | 光效和画布叠在视频上导致；单独播放同一视频不丢帧 |

结论：
- **合成是大头：** 主要开销是 gnome-shell 的窗口合成，它跟帧率和窗口大小有关，跟视频分辨率关系不大。所以降帧率比降分辨率更有效。
- **电池模式：** 用电池时 CPU 性能约减半，背景会占到整机约 40%，所以用电池时背景改用静态图。

## 可行性分析要点

以下都在 3.6556.2 上实测或读代码确认：

- **Electron Fuse：** `RunAsNode`、`EnableNodeOptionsEnvironmentVariable`、`EnableNodeCliInspectArguments` 都已关闭，不能用 `NODE_OPTIONS` 或 `--inspect` 注入。
- **CDP 不可用：** 应用发现 `--remote-debugging-port` 等调试或网络覆盖开关时会拒绝启动，远程调试注入行不通。
- **改包副本可行：** `EnableEmbeddedAsarIntegrityValidation` 虽然开着，但重新计算各文件完整性后重打包 `app.asar`，在 Linux 上可以正常启动（隔离环境中用探针入口实测；完整官方程序的启动还待验证）。副本只需复制主程序，其余文件用符号链接，共约 271MB；`chrome-sandbox` 链接到官方的 setuid 版本，渲染沙箱保持开启。
- **视频加载方式：** 聊天界面加载自远端 `https://claude.ai`，它的 CSP 允许 `media-src blob:`，所以上游用 blob 注入视频的方式可用。第三方模式的 `app://localhost` 页面不允许 blob 视频，会被拦截，这种页面只显示静态图。
- **主窗口识别：** 快捷输入窗口是 606×470，上游“第一个 500×350 以上的窗口”规则会误判。官方主窗口的最小尺寸是 600×400，用它来识别。
- **隐藏启动：** 主窗口没有显示出来时（开机隐藏启动）不播开场。
- **Cowork socket：** 路径取自 `XDG_RUNTIME_DIR`，隔离测试时需要重定向，避免和正在运行的实例冲突。
- **桌面入口：** 官方只会改写带 `X-Claude-Generated=true` 标记的用户级 `.desktop` 文件，不带标记的不会被覆盖。

## 接入方案（开发中）

- **副本位置：** 放在用户目录（默认 `~/.local/share/claude-moe/`），不修改 `/usr/lib/claude-desktop`，不需要 sudo。
- **入口改动：** 重打包后只改 `package.json` 的 `main`，指向新的启动脚本。启动脚本先挂上开场和背景，再原样加载官方入口 `index.pre.js`；它自身出错时官方程序照常运行。
- **启动器：** 每次启动都比对官方版本。apt 升级后自动重建副本，重建失败就启动官方原版。
- **背景暂停规则：** 开场播放时、窗口隐藏或失焦时、用电池时暂停；丢帧过多时自动定格为静态图。
- **验证顺序：** 先用独立的临时配置（单独的 HOME 和 `XDG_RUNTIME_DIR`）验证，不影响正在使用的账号；通过后再接管桌面入口。
- **回滚：** 删除副本目录和用户级 `.desktop` 文件即可，官方会重新生成自己的入口。

## 风险

- **安全性：** 副本在用户目录里，可以被同一用户的其他程序改写。官方文件归 root 所有，所以这比官方安装弱；启动前校验哈希只能缓解。
- **AppArmor：** 官方的放行规则只覆盖 `/usr/lib/claude-desktop` 路径。副本靠 SUID 沙箱运行，Cowork 和 `bwrap` 是否受影响需要回归测试。
- **远端页面变化：** 聊天页面结构可能随时变化，背景的选择器失效时会自动不显示，不影响聊天功能。
- **非官方：** 这是非官方改造，不在官方支持范围内。

## 预览

直接用浏览器打开 `preview.html`。它模拟聊天界面，可以切换背景素材、调整遮罩浓度、切换深浅主题，并分别预览插电和电池两种开场。对比项会引用仓库里上游的原版素材。

## 许可与来源

- 代码沿用上游的 MIT 许可（见仓库根目录 `LICENSE` 和 `NOTICE.md`）。
- 本目录的图片和视频由上游 `assets/original-videos/` 中的原片裁剪和转码而来，只改变了分辨率、帧率和时长，不增加任何素材授权。素材权利和来源标记以上游说明为准。上游原片本身没有嵌入来源元数据，转码过程没有添加或删除这类信息。
- Claude 名称和标志属于 Anthropic，本项目为非官方定制。
