# Orchestrix 系统架构

## 整体架构

Orchestrix 是一个基于 Electron 的纯客户端桌面应用，采用 **Main + Renderer** 双进程架构。

```
┌─────────────────────────────────────────────────────────┐
│                   Renderer Process                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Vue 3 + Naive UI                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ File     │ │ Layer    │ │ Content Area     │  │  │
│  │  │ Explorer │ │ Switcher │ │ Terminal / Editor │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  │                                                   │  │
│  │  Pinia Store (UI / Editor / Agent / Workspace)    │  │
│  │  Pinia IPC Plugin ←→ ipcRenderer                  │  │
│  └───────────────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │ IPC (contextBridge / preload)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    Main Process                          │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ AgentManager │ │ WorkspaceMgr │ │ TerminalManager│  │
│  │              │ │              │ │                │  │
│  │ - spawn CLI  │ │ - git worktree│ │ - node-pty    │  │
│  │ - lifecycle  │ │ - project CRUD│ │ - shell session│  │
│  │ - status     │ │ - file R/W   │ │ - I/O stream   │  │
│  └──────┬───────┘ └──────┬───────┘ └───────┬────────┘  │
│         │                │                  │           │
│  ┌──────┴────────────────┴──────────────────┴────────┐  │
│  │              Global State (SharedStore)            │  │
│  │  - Agent 运行状态、项目列表、工作区路径              │  │
│  │  - IPC 广播变更到所有 Renderer 窗口                  │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────┴───────────────────────────┐  │
│  │           Persistence Layer                        │  │
│  │  SQLite (better-sqlite3) — 待实现                   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │ AI Agent   │   │ Local FS / │   │ Shell /    │
   │ CLI        │   │ Git Repos  │   │ PTY        │
   └────────────┘   └────────────┘   └────────────┘
```

## 核心设计理念：图层模型

Orchestrix 采用 **图层（Layer）模型** 组织 UI，类似 Photoshop 的图层概念：

```
┌──────────────────────────────────────────────┐
│  Layer Switcher: [Terminal] [Files (2)]       │
├──────────────────────────────────────────────┤
│                                              │
│  第一层（Terminal Layer）— 默认前台            │
│  ┌─────────────┐ ┌─────────────┐             │
│  │ Project A   │ │ Project B   │  ← 并排终端  │
│  │ (shell)     │ │ (shell)     │             │
│  └─────────────┘ └─────────────┘             │
│                                              │
├───── 图层切换（同一时间只显示一层）──────────┤
│                                              │
│  第二层（Editor Layer）— 后台                 │
│  ┌────────────────┬─────────────────┐        │
│  │ [file1] [file2]│ [file3]         │        │
│  │ CodeMirror     │ CodeMirror      │ ← 分栏 │
│  │ (左栏)         │ (右栏)          │        │
│  └────────────────┴─────────────────┘        │
│                                              │
└──────────────────────────────────────────────┘
```

### 关键约束

| 规则 | 说明 |
|------|------|
| **无项目不 Shell** | 每个终端面板必须绑定一个项目，Shell = Project |
| **项目即 Shell** | 添加项目自动创建终端面板，删除项目自动关闭 Shell |
| **图层独占** | 同一时间只显示一层：Terminal 或 Editor |
| **编辑器按项目隔离** | 第二层只显示当前激活项目的文件，切换项目自动切换布局 |
| **状态恢复** | 切换项目时恢复该项目的分栏布局、打开文件、光标位置 |

## 进程职责划分

### Main Process

| 模块 | 职责 |
|------|------|
| **AgentManager** | 通过 node-pty 启动 AI CLI 进程，管理生命周期 |
| **WorkspaceManager** | 项目目录管理、文件树读取、文件读写 |
| **TerminalManager** | PTY 会话创建和管理，桥接 xterm.js |

### Renderer Process

| 模块 | 职责 |
|------|------|
| **UIStore** | 图层状态、终端面板列表、侧边栏状态 |
| **EditorStore** | 文件打开/编辑/保存、分栏布局管理、光标状态持久化、项目布局快照 |
| **WorkspaceStore** | 项目列表管理、文件树数据 |
| **AgentStore** | Agent 运行状态 |

## IPC 通信模型

### IPC Channel 约定

| Channel | 方向 | 用途 |
|---------|------|------|
| `agent:spawn` | Renderer → Main | 启动 Agent |
| `agent:kill` | Renderer → Main | 停止 Agent |
| `agent:status` | Main → Renderer | Agent 状态变更广播 |
| `terminal:create` | Renderer → Main | 创建 PTY 会话 |
| `terminal:input` | Renderer → Main | 终端输入 |
| `terminal:output` | Main → Renderer | 终端输出流 |
| `terminal:resize` | Renderer → Main | 终端尺寸变更 |
| `workspace:list` | Renderer → Main | 获取项目列表 |
| `workspace:add` | Renderer → Main | 添加项目 |
| `workspace:files` | Renderer → Main | 读取文件树 |
| `file:read` | Renderer → Main | 读取文件内容 |
| `file:write` | Renderer → Main | 写入文件内容 |
| `store:sync` | 双向 | Pinia 状态同步 |

## 安全模型

- `contextIsolation: true` — Renderer 不直接访问 Node.js API
- `nodeIntegration: false` — 禁用 Renderer 中的 Node.js
- 所有 Main 能力通过 `preload.ts` 中的 `contextBridge.exposeInMainWorld` 暴露
- Pinia IPC 同步使用 `JSON.parse(JSON.stringify())` 完全序列化，避免 Vue 响应式代理泄漏

## 设计原则

1. **Terminal-first**：核心交互基于终端，UI 是终端的增强而非替代
2. **Agent as Process**：每个 Agent 是独立进程，通过 PTY 通信，互不干扰
3. **Workspace Isolation**：项目间文件、布局、光标状态完全隔离
4. **Pure Client**：无后端服务依赖，所有数据本地存储
5. **最小 IPC**：高频数据（终端输出）走独立事件流，不经过 Pinia
