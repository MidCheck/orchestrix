# Orchestrix 项目目录结构

## 目录规划

基于 electron-vite 的标准三入口结构（main / preload / renderer）。

```
orchestrix/
├── docs/                              # 文档
│   └── design/                        # 设计文档
│
├── src/
│   ├── main/                          # Electron Main 进程
│   │   ├── index.ts                   # 入口：创建窗口、注册 IPC、初始化 Manager
│   │   ├── ipc/                       # IPC handler 注册
│   │   │   ├── agent.ipc.ts           # agent:* channel handlers
│   │   │   ├── terminal.ipc.ts        # terminal:* channel handlers
│   │   │   ├── workspace.ipc.ts       # workspace:* + file:* channel handlers
│   │   │   └── store.ipc.ts           # store:sync channel handler
│   │   └── managers/                  # 核心管理器
│   │       ├── agent-manager.ts       # Agent 生命周期管理
│   │       ├── terminal-manager.ts    # PTY 会话管理 (node-pty)
│   │       └── workspace-manager.ts   # 项目/工作区管理 + 文件读写
│   │
│   ├── preload/                       # Preload 脚本
│   │   └── index.ts                   # contextBridge API 暴露
│   │
│   ├── renderer/                      # Vue 前端应用
│   │   ├── index.html                 # 入口 HTML
│   │   └── src/
│   │       ├── main.ts                # Vue app 入口 (Pinia + IPC Plugin)
│   │       ├── App.vue                # 根组件
│   │       ├── components/
│   │       │   ├── layout/            # 布局组件
│   │       │   │   ├── AppLayout.vue  # 主布局（侧边栏 + 图层容器）
│   │       │   │   └── Sidebar.vue    # 左侧边栏（项目列表 + 文件树）
│   │       │   ├── terminal/          # 终端组件（第一层）
│   │       │   │   └── TerminalPane.vue   # 单个终端面板 (xterm.js)
│   │       │   ├── file-explorer/     # 文件浏览器
│   │       │   │   ├── FileTree.vue       # 文件树容器
│   │       │   │   └── FileTreeItem.vue   # 文件树节点（点击文件打开编辑器）
│   │       │   └── editor/            # 编辑器组件（第二层）
│   │       │       ├── EditorLayer.vue        # 编辑器图层入口
│   │       │       ├── EditorSplitContainer.vue # 递归分栏容器
│   │       │       ├── EditorGroupView.vue    # 单个编辑器组（Tab + CodeMirror + 拖拽）
│   │       │       └── CodeEditor.vue         # CodeMirror 编辑器（旧版，已被 EditorGroupView 替代）
│   │       ├── stores/                # Pinia Stores
│   │       │   ├── ui.ts              # 图层状态、终端面板、侧边栏
│   │       │   ├── editor.ts          # 文件编辑、分栏布局、光标状态、项目布局持久化
│   │       │   ├── workspace.ts       # 项目列表、文件树数据
│   │       │   └── agent.ts           # Agent 运行状态
│   │       ├── plugins/
│   │       │   └── pinia-ipc-sync.ts  # Pinia IPC 同步插件
│   │       ├── composables/
│   │       │   └── useTerminal.ts     # xterm.js 封装
│   │       └── types/
│   │           └── electron.d.ts      # window.electronAPI 类型
│   │
│   └── shared/                        # Main / Renderer 共享代码
│       ├── constants.ts               # IPC channel 名称常量
│       └── types.ts                   # 共享类型定义
│
├── tests/                             # Playwright 调试/测试脚本
├── resources/                         # Electron 静态资源
├── electron.vite.config.ts            # electron-vite 配置
├── electron-builder.yml               # electron-builder 打包配置
├── package.json
├── tsconfig.json / .node.json / .web.json
└── README.md
```

## 模块依赖关系

```
shared/          ← Main 和 Renderer 共同依赖（类型、常量）
  ↑        ↑
main/    renderer/
  ↑
preload/         ← 依赖 shared 的类型，运行在隔离上下文
```

## 编辑器组件层次

```
EditorLayer.vue
  └── EditorSplitContainer.vue (递归)
        ├── EditorGroupView.vue (叶节点)
        │     ├── Tab 栏 (拖拽排序 / 跨组移动)
        │     ├── CodeMirror 6 实例 (语法高亮、光标恢复)
        │     └── 拖拽指示器 (left/right/top/bottom/center)
        ├── 分割线 (可拖拽调整尺寸)
        └── EditorSplitContainer.vue (递归子节点)
```
