# Orchestrix 技术栈

## 核心技术选型

| 层次 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面容器 | Electron | 35.x | Node.js 运行时 + 跨平台窗口 |
| 开发脚手架 | electron-vite | 3.x | Vite 驱动的 Electron 开发环境，HMR |
| 打包发布 | electron-builder | 25.x | 生成 dmg / exe / AppImage |
| 前端框架 | Vue 3 | 3.5 | Composition API + `<script setup>` |
| UI 组件库 | Naive UI | 2.40+ | TypeScript 友好、轻量（部分使用） |
| 状态管理 | Pinia | 2.3 | Vue 官方状态管理，支持插件机制 |
| 代码编辑器 | CodeMirror 6 | 6.x | 轻量级代码编辑器，支持语法高亮 |
| 终端模拟 | xterm.js | 6.x | 浏览器端终端模拟器 |
| PTY | node-pty | 1.x | Node.js 伪终端 |
| 语言 | TypeScript | 5.7 | 全栈使用 |
| 测试 | Playwright | 1.58 | Electron E2E 自动化测试 |

## CodeMirror 6 扩展

| 包 | 用途 |
|----|------|
| `@codemirror/view` | 编辑器视图核心 |
| `@codemirror/state` | 编辑器状态模型 |
| `@codemirror/commands` | 快捷键命令（undo/redo/indent） |
| `@codemirror/language` | 语法分析框架 |
| `@codemirror/autocomplete` | 括号自动补全 |
| `@codemirror/theme-one-dark` | 暗色主题 |
| `@codemirror/lang-javascript` | JS/TS 高亮 |
| `@codemirror/lang-json` | JSON 高亮 |
| `@codemirror/lang-html` | HTML 高亮 |
| `@codemirror/lang-css` | CSS 高亮 |
| `@codemirror/lang-vue` | Vue SFC 高亮 |
| `@codemirror/lang-python` | Python 高亮 |
| `@codemirror/lang-markdown` | Markdown 高亮 |

## 开发工具链

| 工具 | 用途 |
|------|------|
| pnpm | 包管理器 |
| Playwright | E2E 自动化测试（直接驱动 Electron 进程） |
| electron-rebuild | 为 Electron 重编译 native addon（node-pty） |

## 关键技术决策

### node-pty 需要 electron-rebuild

node-pty 是 native addon，默认 prebuild 是给系统 Node 编译的。必须使用 `electron-rebuild` 为 Electron 的 Node 版本重新编译，否则会出现 `posix_spawnp failed` 错误。

```bash
pnpm rebuild  # 执行 electron-rebuild -m .
```

### Pinia IPC 同步必须用 JSON 序列化

`toRaw(state)` 只移除顶层 Vue 代理，内层 reactive 对象仍含有不可克隆的 Vue 内部 Symbol。Electron IPC 使用结构化克隆算法，会抛出 `An object could not be cloned` 错误。

**解决方案**：使用 `JSON.parse(JSON.stringify(state))` 完全序列化。

### Electron 二进制下载

在中国大陆网络环境下，Electron 二进制下载可能失败。使用 GitHub 镜像：

```bash
ELECTRON_MIRROR="https://github.com/electron/electron/releases/download/" pnpm install
```

## 跨平台注意事项

| 平台 | 注意项 |
|------|--------|
| macOS | dmg 签名/公证、Universal Binary、Python setuptools (node-gyp 依赖) |
| Windows | NSIS 安装包、VS Build Tools (node-gyp)、PowerShell 默认 shell |
| Linux | AppImage / deb、不同发行版 PTY 兼容性 |
