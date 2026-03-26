# Orchestrix 状态管理方案

## 概述

采用 **Pinia (Renderer) + Main SharedStore + IPC 同步** 的分层状态管理架构。

## Store 架构

```
┌─ Renderer ────────────────────────────────────────────┐
│                                                        │
│  UIStore (ui.ts)                                       │
│  ├── activeLayer: 'terminal' | 'editor'                │
│  ├── panes: PaneInfo[]    ← 终端面板（= 项目绑定）      │
│  ├── activePaneId                                      │
│  ├── sidebarVisible                                    │
│  └── expandedDirs: Set                                 │
│                                                        │
│  EditorStore (editor.ts)                               │
│  ├── openFiles: OpenFile[]     ← 所有打开的文件         │
│  ├── layoutRoot: LayoutNode    ← 当前项目的分栏布局树    │
│  ├── groups: Record<id, EditorGroup>  ← 编辑器组       │
│  ├── activeGroupId                                     │
│  ├── cursorStates: Map<path, CursorState>  ← 光标缓存  │
│  └── projectLayouts: Map<pid, ProjectLayout> ← 布局快照 │
│                                                        │
│  WorkspaceStore (workspace.ts)          [IPC Synced]   │
│  ├── projects: Project[]                               │
│  └── activeProjectId                                   │
│                                                        │
│  AgentStore (agent.ts)                  [IPC Synced]   │
│  ├── agents: AgentInfo[]                               │
│  └── actions: spawn / kill / refresh                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## 编辑器分栏布局模型

编辑器采用递归树结构表达分栏布局：

```typescript
// 叶节点：一个编辑器组
interface LayoutLeaf {
  type: 'leaf'
  groupId: string
}

// 分栏节点：水平或垂直分割
interface LayoutSplit {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: LayoutNode[]
  sizes: number[]    // 每个子节点的百分比尺寸
}

type LayoutNode = LayoutLeaf | LayoutSplit

// 编辑器组：一组 Tab + 一个 CodeMirror
interface EditorGroup {
  id: string
  files: string[]        // 有序文件路径列表
  activeFile: string | null
}
```

### 示例布局

两列分栏，左列有 2 个文件 Tab，右列有 1 个文件：

```
layoutRoot = {
  type: 'split',
  direction: 'horizontal',
  sizes: [60, 40],
  children: [
    { type: 'leaf', groupId: 'group-1' },  // [app.ts, index.ts] active=app.ts
    { type: 'leaf', groupId: 'group-2' }   // [style.css] active=style.css
  ]
}
```

### 拖拽操作映射

| 拖拽目标 | 操作 |
|---------|------|
| 同组 Tab 之间 | 重新排序 (`reorderFile`) |
| 另一组 Tab 区域 | 合并到目标组 (`moveFileToGroup`) |
| 编辑器左 25% | 水平分栏，新组在左 (`splitWithFile('horizontal', 'before')`) |
| 编辑器右 25% | 水平分栏，新组在右 (`splitWithFile('horizontal', 'after')`) |
| 编辑器上 25% | 垂直分栏，新组在上 (`splitWithFile('vertical', 'before')`) |
| 编辑器下 25% | 垂直分栏，新组在下 (`splitWithFile('vertical', 'after')`) |

## 项目布局持久化

每个项目的编辑器布局独立保存和恢复：

```
projectLayouts: Map<projectId, {
  root: LayoutNode,          // 分栏布局树快照
  groups: Record<id, EditorGroup>  // 各组的文件列表和激活文件
}>
```

### 保存/恢复时机

| 事件 | 操作 |
|------|------|
| 切换项目（oldPid → newPid） | 1) 用 **oldPid** 保存当前布局 2) 用 **newPid** 恢复 |
| 打开文件 | 自动切换到编辑器图层，文件加入当前激活的 group |
| 关闭最后一个文件 | group 被移除；所有 group 空 → 回到终端层 |

> **关键细节**：`saveLayoutForProject(pid)` 必须传入 `oldPid` 而非读取 `activeProjectId`，因为 watch 回调触发时 `activeProjectId` 已经是新值。

## 光标/滚动状态

每个文件的编辑状态全局缓存，与布局无关：

```typescript
cursorStates: Map<filePath, {
  anchor: number      // 选区锚点
  head: number        // 选区头部
  scrollTop: number   // 垂直滚动位置
  scrollLeft: number  // 水平滚动位置
}>
```

- 切换文件前 → `saveCursorState()`
- 创建 CodeMirror 时 → 传入 `selection` 恢复光标 + `requestAnimationFrame` 恢复滚动

## IPC 同步策略

### 同步的 Store

只有 `workspace` 和 `agent` 通过 IPC 同步（用于多窗口场景）。

### 序列化方式

使用 `JSON.parse(JSON.stringify(state))` 替代 `toRaw(state)`，原因：
- `toRaw()` 只移除顶层 Vue 代理，内层对象仍带有 Vue 内部 Symbol
- Electron IPC 的结构化克隆算法无法处理这些 Symbol
- `JSON.parse(JSON.stringify())` 完全序列化为纯 JS 对象

### 不同步的 Store

| Store | 原因 |
|-------|------|
| `ui` | 包含 `Set`（expandedDirs），且各窗口 UI 状态独立 |
| `editor` | 包含 `Map`（cursorStates, projectLayouts），数据量大，且编辑器状态无需跨窗口 |
