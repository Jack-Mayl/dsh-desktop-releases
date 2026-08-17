# dsh-desktop — DeepSeek Harness 桌面版

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）打包成 **Windows 桌面应用**：
传统 NSIS 安装器 + 内置引擎 + 便携 Node + 自动更新 + VS Code 式 IDE 布局。

配套引擎源码（含插件市场/插件说明等定制）：见 [Jack-Mayl/deepseek-harness](https://github.com/Jack-Mayl/deepseek-harness)。
安装包发布：[Jack-Mayl/dsh-desktop-releases](https://github.com/Jack-Mayl/dsh-desktop-releases)。

## 功能总览

| 功能 | 说明 |
|---|---|
| **一键安装** | 205MB 安装包，双击即装，无需 Node/pnpm 等任何前置依赖 |
| **自动更新** | GitHub Releases 渠道；启动检查 + 每 4 小时复查 + 失败 60s 重试；托盘一键安装 |
| **VS Code 三栏 IDE 布局** | 左「文件/会话」双 Tab + 中多标签编辑器 + 右「对话/详情」，可拖宽 |
| **文件树** | 懒加载、Git 状态角标、重命名、回收站删除、新建、递归搜索 |
| **多标签编辑器** | shiki 高亮（明暗自适应）、编辑 + Ctrl+S、拖拽排序、状态持久化 |
| **双模式** | 全屏对话 ↔ 分栏 IDE 一键切换 |
| **图片桥接** | 非多模态模型也能发图（附件落盘 → 视觉 MCP 识图） |
| **设置面板管理** | 全局人设（所有会话生效）、Skill/MCP 的开关/删除/添加，即时生效 |
| **插件市场** | 设置 → 插件 → 插件市场：搜索 GitHub `topic:dsh-plugin` 生态，一键安装 |
| **插件说明** | 插件列表显示官方 package.json#description，支持按说明搜索 |
| **官方图标** | 主程序/快捷方式/托盘/安装器统一使用 dsh 官方 favicon |

## 目录结构

```
├── src/main/                 # Electron 主进程
│   ├── main.ts               #   窗口、单实例、生命周期
│   ├── dsh-engine.ts         #   引擎子进程管理 + runtime 首启解压 + VS Code 布局接线
│   ├── updater.ts            #   electron-updater 封装（重试/托盘状态）
│   └── chrome.ts             #   托盘 + 应用菜单
├── scripts/
│   ├── render-official-icon.mjs     # 官方 favicon.svg → 多尺寸 ICO
│   ├── apply-vscode-layout.mjs      # 把 anoslide IDE 布局注入 runtime（幂等可重放）
│   ├── after-pack.mjs               # electron-builder 钩子：rcedit 写主 EXE 图标
│   └── generate-desktop-runtime-manifest.mjs
├── electron-builder.yml      # NSIS 配置（可选安装目录、GitHub 更新渠道）
└── engine/VERSION            # 引擎归档元信息
```

## 构建流程

前置：Node ≥22，本机可访问的 npm registry。

```powershell
# 1. 构建引擎源码（Jack-Mayl/deepseek-harness，产出 apps/cli/lib + apps/web/dist）
pnpm install && pnpm run build

# 2. 部署生产 runtime（hoisted）到 engine-hoisted-vN
pnpm --config.node-linker=hoisted --config.package-import-method=copy `
    --filter=@deepseek-ai/dsh-desktop-runtime-root --prod deploy --legacy 'G:\dsh-desktop\engine-hoisted-vN'
#    （随后把 apps/cli/{lib,config,package.json} 与 commander@15 放进部署目录）

# 3. 注入 VS Code IDE 布局 + 官方包补丁（需先克隆 anoslide/dsh-vscode-layout 到 vscode-layout-src/）
node scripts/apply-vscode-layout.mjs G:\dsh-desktop\engine-hoisted-vN

# 4. 归档 runtime（7za，产物 engine/runtime.7z，随安装包分发）
7za a -t7z -mx=5 engine/runtime.7z ./engine-hoisted-vN/*

# 5. 生成图标 + 打安装包
node scripts/render-official-icon.mjs
npm run build:ts && npx electron-builder --win
```

## 关键设计

- **单归档 runtime**：引擎以一个 107MB 的 `runtime.7z` 随包分发，首启解压到
  `%APPDATA%\dsh-desktop\dsh-runtime\`；`.extracted` 标记写入**应用版本号**，升级自动替换引擎，
  而 DSH_HOME（会话/配置/人设/MCP）独立保存、跨升级不丢。
- **引擎子进程**：dsh 以独立 Node 进程运行（内置便携 node.exe），崩溃不影响壳。
- **VS Code 布局接线**：每次启动幂等重建 profile junction + patch（`ensureVscodeLayout()`），
  注入脚本在应用布局补丁后自动回插 plugin-market 挂载行，布局与市场共存。
- **图标**：`signAndEditExecutable: false` 会跳过 rcedit，用 afterPack 钩子单独写官方 ICO。

## 版本历史

| 版本 | 要点 |
|---|---|
| 0.3.1 | 修复 0.3.0 布局覆盖导致插件市场丢失；布局与市场共存 |
| 0.3.0 | 整合 anoslide/dsh-vscode-layout：三栏 IDE、文件树、编辑器、双模式、图片桥接、设置面板管理 |
| 0.2.4 | 修复主 EXE 图标未写入（afterPack rcedit） |
| 0.2.3 | 插件列表官方 description 说明 + 官方图标 |
| 0.2.2 | 插件市场（GitHub topic 搜索 + dsh plugin 官方安装流 + 内置 pnpm） |
| 0.2.0–0.2.1 | 插件市场初版 + Remote 方法冲突修复（addPlugin） |
| 0.1.x | 首版：NSIS 安装器、runtime 归档、GitHub 自动更新链路 |

## License

MIT（dsh 本体与其魔改组件见各自仓库）
