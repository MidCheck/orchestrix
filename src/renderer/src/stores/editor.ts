import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useUIStore } from './ui'
import { useWorkspaceStore } from './workspace'
import type { FileKind } from '@shared/types'

// --- 类型定义 ---

export interface CursorState {
  anchor: number
  head: number
  scrollTop: number
  scrollLeft: number
}

export interface OpenFile {
  path: string
  name: string
  kind: FileKind
  language: string
  content: string       // text: 源码; image/video/audio: data URL; binary: ''
  savedContent: string
  projectId: string
  size: number
  hexHead?: string      // binary: hex dump
}

export interface EditorGroup {
  id: string
  files: string[]      // 有序的文件路径列表
  activeFile: string | null
}

export type LayoutNode = LayoutLeaf | LayoutSplit

export interface LayoutLeaf {
  type: 'leaf'
  groupId: string
}

export interface LayoutSplit {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: LayoutNode[]
  sizes: number[]
}

export interface ProjectLayout {
  root: LayoutNode | null
  groups: Record<string, EditorGroup>
}

// --- Store ---

export const useEditorStore = defineStore('editor', () => {
  // 所有打开的文件（全局，跨项目）
  const openFiles = ref<OpenFile[]>([])

  // 当前项目的布局
  const layoutRoot = ref<LayoutNode | null>(null)
  const groups = ref<Record<string, EditorGroup>>({})
  const activeGroupId = ref<string | null>(null)

  // 每个文件的光标/滚动状态
  const cursorStates = ref<Map<string, CursorState>>(new Map())

  // 每个项目的布局快照
  const projectLayouts = ref<Map<string, ProjectLayout>>(new Map())

  let groupCounter = 0
  function nextGroupId(): string {
    return `group-${++groupCounter}`
  }

  // --- 当前项目的文件 ---
  const currentProjectFiles = computed(() => {
    const pid = useWorkspaceStore().activeProjectId
    if (!pid) return []
    return openFiles.value.filter((f) => f.projectId === pid)
  })

  // 当前激活的文件
  const activeFile = computed(() => {
    const gid = activeGroupId.value
    if (!gid || !groups.value[gid]) return null
    const filePath = groups.value[gid].activeFile
    if (!filePath) return null
    return openFiles.value.find((f) => f.path === filePath) || null
  })

  const isModified = computed(() => {
    if (!activeFile.value) return false
    return activeFile.value.content !== activeFile.value.savedContent
  })

  // --- 布局保存/恢复 ---

  function saveCurrentLayout(): void {
    const pid = useWorkspaceStore().activeProjectId
    if (pid) saveLayoutForProject(pid)
  }

  function saveLayoutForProject(projectId: string): void {
    if (!layoutRoot.value) return
    projectLayouts.value.set(projectId, {
      root: JSON.parse(JSON.stringify(layoutRoot.value)),
      groups: JSON.parse(JSON.stringify(groups.value))
    })
  }

  function restoreLayout(projectId: string): void {
    const saved = projectLayouts.value.get(projectId)
    if (saved) {
      layoutRoot.value = JSON.parse(JSON.stringify(saved.root))
      groups.value = JSON.parse(JSON.stringify(saved.groups))
      const groupIds = Object.keys(saved.groups)
      activeGroupId.value = groupIds.length > 0 ? groupIds[0] : null
    } else {
      layoutRoot.value = null
      groups.value = {}
      activeGroupId.value = null
    }
  }

  // 项目切换时保存/恢复（用 oldPid 保存，用 newPid 恢复）
  watch(
    () => useWorkspaceStore().activeProjectId,
    (newPid, oldPid) => {
      if (oldPid) saveLayoutForProject(oldPid)
      if (newPid) {
        restoreLayout(newPid)
        const uiStore = useUIStore()
        if (uiStore.activeLayer === 'editor' && !layoutRoot.value) {
          uiStore.switchToTerminal()
        }
      }
    }
  )

  // --- 文件操作 ---

  async function openFile(filePath: string, targetGroupId?: string): Promise<void> {
    const uiStore = useUIStore()
    const wsStore = useWorkspaceStore()

    // 确定目标 group
    let gid = targetGroupId || activeGroupId.value
    if (!gid || !groups.value[gid]) {
      gid = nextGroupId()
      groups.value[gid] = { id: gid, files: [], activeFile: null }
      layoutRoot.value = { type: 'leaf', groupId: gid }
    }

    // 同一 group 内已打开该文件 → 直接激活（不重复添加 tab）
    if (groups.value[gid].files.includes(filePath)) {
      groups.value[gid].activeFile = filePath
      activeGroupId.value = gid
      uiStore.switchToEditor()
      return
    }

    // 确保文件数据已加载（多个 group 可共享同一份 openFile 数据）
    const existing = openFiles.value.find((f) => f.path === filePath)
    if (!existing) {
      const result = await window.electronAPI.workspace.readFile(filePath)
      openFiles.value.push({
        path: result.path,
        name: filePath.split('/').pop() || filePath,
        kind: result.kind,
        language: result.language,
        content: result.content,
        savedContent: result.content,
        projectId: wsStore.activeProjectId || '',
        size: result.size,
        hexHead: result.hexHead
      })
      window.electronAPI.workspace.watchFile(filePath).catch(() => {})
    }

    // 在目标 group 中添加 tab
    groups.value[gid].files.push(filePath)
    groups.value[gid].activeFile = filePath
    activeGroupId.value = gid
    uiStore.switchToEditor()
  }

  async function saveFile(filePath?: string): Promise<void> {
    const target = filePath
      ? openFiles.value.find((f) => f.path === filePath)
      : activeFile.value
    if (!target) return
    await window.electronAPI.workspace.writeFile(target.path, target.content)
    target.savedContent = target.content
  }

  function updateContent(filePath: string, content: string): void {
    const file = openFiles.value.find((f) => f.path === filePath)
    if (file) file.content = content
  }

  function closeFile(groupId: string, filePath: string): void {
    const group = groups.value[groupId]
    if (!group) return

    const idx = group.files.indexOf(filePath)
    if (idx === -1) return
    group.files.splice(idx, 1)

    // 切换到相邻文件
    if (group.activeFile === filePath) {
      group.activeFile = group.files.length > 0
        ? group.files[Math.min(idx, group.files.length - 1)]
        : null
    }

    // 如果 group 空了，移除 group 和布局节点
    if (group.files.length === 0) {
      removeGroup(groupId)
    }

    // 清理：如果该文件不在任何 group 中，从 openFiles 移除
    const stillOpen = Object.values(groups.value).some((g) => g.files.includes(filePath))
    if (!stillOpen) {
      const fi = openFiles.value.findIndex((f) => f.path === filePath)
      if (fi !== -1) openFiles.value.splice(fi, 1)
      cursorStates.value.delete(filePath)
    }

    // 没有任何 group 了，回到终端
    if (Object.keys(groups.value).length === 0) {
      layoutRoot.value = null
      activeGroupId.value = null
      useUIStore().switchToTerminal()
    }
  }

  function removeGroup(groupId: string): void {
    delete groups.value[groupId]
    if (activeGroupId.value === groupId) {
      const remaining = Object.keys(groups.value)
      activeGroupId.value = remaining.length > 0 ? remaining[0] : null
    }
    // 从布局树中移除
    if (layoutRoot.value) {
      layoutRoot.value = pruneLayout(layoutRoot.value, groupId)
    }
  }

  function pruneLayout(node: LayoutNode, removedGroupId: string): LayoutNode | null {
    if (node.type === 'leaf') {
      return node.groupId === removedGroupId ? null : node
    }
    const children = node.children
      .map((c) => pruneLayout(c, removedGroupId))
      .filter((c): c is LayoutNode => c !== null)

    if (children.length === 0) return null
    if (children.length === 1) return children[0]

    // 重新分配 sizes
    const total = node.sizes.reduce((a, b) => a + b, 0)
    const newSizes = children.map(() => total / children.length)

    return { ...node, children, sizes: newSizes }
  }

  // --- Tab 操作 ---

  function setActiveFile(groupId: string, filePath: string): void {
    const group = groups.value[groupId]
    if (group) {
      group.activeFile = filePath
      activeGroupId.value = groupId
    }
  }

  function setActiveGroup(groupId: string): void {
    activeGroupId.value = groupId
  }

  function reorderFile(groupId: string, fromIndex: number, toIndex: number): void {
    const group = groups.value[groupId]
    if (!group) return
    const [moved] = group.files.splice(fromIndex, 1)
    group.files.splice(toIndex, 0, moved)
  }

  // 将文件从一个 group 移动到另一个
  function moveFileToGroup(fromGroupId: string, toGroupId: string, filePath: string, insertIndex?: number): void {
    const from = groups.value[fromGroupId]
    const to = groups.value[toGroupId]
    if (!from || !to) return

    // 从源 group 移除
    const idx = from.files.indexOf(filePath)
    if (idx !== -1) from.files.splice(idx, 1)
    if (from.activeFile === filePath) {
      from.activeFile = from.files.length > 0 ? from.files[Math.min(idx, from.files.length - 1)] : null
    }

    // 添加到目标 group
    if (insertIndex !== undefined) {
      to.files.splice(insertIndex, 0, filePath)
    } else {
      to.files.push(filePath)
    }
    to.activeFile = filePath
    activeGroupId.value = toGroupId

    // 清空的 group 移除
    if (from.files.length === 0) {
      removeGroup(fromGroupId)
    }
  }

  // 拖拽到边缘 → 创建新分栏
  function splitWithFile(
    targetGroupId: string,
    filePath: string,
    fromGroupId: string,
    direction: 'horizontal' | 'vertical',
    position: 'before' | 'after'
  ): void {
    const from = groups.value[fromGroupId]
    if (!from) return

    // 从源 group 移除文件
    const idx = from.files.indexOf(filePath)
    if (idx !== -1) from.files.splice(idx, 1)
    if (from.activeFile === filePath) {
      from.activeFile = from.files.length > 0 ? from.files[Math.min(idx, from.files.length - 1)] : null
    }

    // 创建新 group
    const newGid = nextGroupId()
    groups.value[newGid] = { id: newGid, files: [filePath], activeFile: filePath }
    activeGroupId.value = newGid

    // 更新布局树：找到目标 group 的 leaf 节点，替换为 split
    if (layoutRoot.value) {
      layoutRoot.value = insertSplit(layoutRoot.value, targetGroupId, newGid, direction, position)
    }

    // 清空的 group 移除
    if (from.files.length === 0) {
      removeGroup(fromGroupId)
    }
  }

  function insertSplit(
    node: LayoutNode,
    targetGroupId: string,
    newGroupId: string,
    direction: 'horizontal' | 'vertical',
    position: 'before' | 'after'
  ): LayoutNode {
    if (node.type === 'leaf') {
      if (node.groupId === targetGroupId) {
        const existing: LayoutLeaf = { type: 'leaf', groupId: targetGroupId }
        const newLeaf: LayoutLeaf = { type: 'leaf', groupId: newGroupId }
        return {
          type: 'split',
          direction,
          children: position === 'before' ? [newLeaf, existing] : [existing, newLeaf],
          sizes: [50, 50]
        }
      }
      return node
    }

    return {
      ...node,
      children: node.children.map((c) => insertSplit(c, targetGroupId, newGroupId, direction, position))
    }
  }

  function updateSplitSizes(nodeId: string, sizes: number[]): void {
    if (layoutRoot.value) {
      updateSizesRecursive(layoutRoot.value, nodeId, sizes)
    }
  }

  function updateSizesRecursive(node: LayoutNode, targetId: string, sizes: number[]): void {
    // 简单实现：基于 children 的 groupId 组合作为标识
    if (node.type === 'split') {
      // 更新当前节点（通过引用匹配）
      node.sizes = sizes
    }
  }

  // --- 光标状态 ---

  function saveCursorState(filePath: string, state: CursorState): void {
    cursorStates.value.set(filePath, state)
  }

  function getCursorState(filePath: string): CursorState | undefined {
    return cursorStates.value.get(filePath)
  }

  function getFileByPath(filePath: string): OpenFile | undefined {
    return openFiles.value.find((f) => f.path === filePath)
  }

  // 外部文件变更时刷新内容（如 CLI 修改了文件）
  async function reloadFile(filePath: string): Promise<void> {
    const file = openFiles.value.find((f) => f.path === filePath)
    if (!file) return
    // 如果用户有未保存的修改，不自动覆盖
    if (file.content !== file.savedContent) return
    try {
      const result = await window.electronAPI.workspace.readFile(filePath)
      if (result.kind === 'text') {
        file.content = result.content
        file.savedContent = result.content
      }
    } catch { /* file may have been deleted */ }
  }

  // 初始化文件变更监听
  let fileChangeCleanup: (() => void) | null = null
  function initFileWatcher(): void {
    if (fileChangeCleanup) return
    fileChangeCleanup = window.electronAPI.workspace.onFileChanged((filePath) => {
      reloadFile(filePath)
    })
  }
  // 首次调用时初始化
  initFileWatcher()

  return {
    openFiles,
    layoutRoot,
    groups,
    activeGroupId,
    currentProjectFiles,
    activeFile,
    isModified,
    cursorStates,
    openFile,
    saveFile,
    updateContent,
    closeFile,
    setActiveFile,
    setActiveGroup,
    reorderFile,
    moveFileToGroup,
    splitWithFile,
    updateSplitSizes,
    saveCursorState,
    getCursorState,
    getFileByPath,
    reloadFile,
    saveCurrentLayout,
    restoreLayout
  }
})
