# dsh-desktop-releases

[DeepSeek Harness 桌面版](https://github.com/Jack-Mayl/dsh-desktop) 的安装包发布仓库（electron-updater 更新源）。

## 项目全家福

| 仓库 | 内容 |
|---|---|
| [Jack-Mayl/dsh-desktop](https://github.com/Jack-Mayl/dsh-desktop) | 桌面版源码：Electron 壳、构建管线、VS Code 布局注入脚本 |
| [Jack-Mayl/deepseek-harness](https://github.com/Jack-Mayl/deepseek-harness) | 引擎源码（官方 fork）：插件市场、插件说明、desktop runtime 清单 |
| 本仓库 | 安装包发布 + 自动更新渠道 |

## 下载

到 [Releases](../../releases) 下载最新的 `DeepSeek.Harness-x.y.z-x64-setup.exe`（约 208MB）。

- Windows 10/11 64 位，双击安装，无需 Node 等任何前置依赖
- 首次启动自动解压内置引擎（约 30–60 秒）
- 已装用户会自动收到更新提示（启动时 + 每 4 小时）

## 功能亮点

- **VS Code 式三栏 IDE 布局**：文件树 + 多标签编辑器 + 对话栏
- **插件市场**：设置 → 插件 → 插件市场，搜索并一键安装 dsh 插件
- **图片桥接**：非多模态模型也能发图（视觉 MCP 识图）
- **全局人设 / Skill / MCP 管理**：设置面板直接管理，即时生效
- **双模式**：全屏对话 ↔ 分栏 IDE 一键切换

## 版本历史

| 版本 | 要点 |
|---|---|
| 0.3.1 | 修复插件市场丢失；IDE 布局与市场共存 |
| 0.3.0 | VS Code 三栏 IDE 布局、文件树、多标签编辑器、双模式、图片桥接、设置面板管理 |
| 0.2.4 | 修复主程序图标 |
| 0.2.3 | 插件说明 + 官方图标 |
| 0.2.2 | 插件市场（内置 pnpm，一键安装） |
| 0.2.0–0.2.1 | 插件市场初版 |
| 0.1.x | 首版：安装器 + 自动更新 |

## SmartScreen 提示

安装包未签名，首次运行 Windows SmartScreen 会拦截：点「更多信息」→「仍要运行」。
