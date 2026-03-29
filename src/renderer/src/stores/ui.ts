import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type LayerType = 'terminal' | 'editor'

export interface PaneInfo {
  id: string
  terminalId: string
  projectId: string | null
  projectName: string | null
  projectPath: string | null
  agentId: string | null
  title: string
}

// 终端布局树（复用编辑器的分栏模型）
export type TermLayoutNode = TermLayoutLeaf | TermLayoutSplit

export interface TermLayoutLeaf {
  type: 'leaf'
  paneId: string
}

export interface TermLayoutSplit {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: TermLayoutNode[]
  sizes: number[]
}

export const useUIStore = defineStore('ui', () => {
  const activeLayer = ref<LayerType>('terminal')
  const panes = ref<PaneInfo[]>([])
  const activePaneId = ref<string | null>(null)
  const terminalLayout = ref<TermLayoutNode | null>(null)

  const activePane = computed(() => {
    if (!activePaneId.value) return null
    return panes.value.find((p) => p.id === activePaneId.value) || null
  })

  const sidebarVisible = ref(true)
  const expandedDirs = ref<Set<string>>(new Set())

  function switchToTerminal(): void { activeLayer.value = 'terminal' }
  function switchToEditor(): void { activeLayer.value = 'editor' }

  function addPane(pane: PaneInfo): void {
    panes.value.push(pane)
    activePaneId.value = pane.id

    // 加入布局树
    const leaf: TermLayoutLeaf = { type: 'leaf', paneId: pane.id }
    if (!terminalLayout.value) {
      terminalLayout.value = leaf
    } else {
      // 默认水平追加
      if (terminalLayout.value.type === 'split' && terminalLayout.value.direction === 'horizontal') {
        terminalLayout.value.children.push(leaf)
        terminalLayout.value.sizes.push(100 / terminalLayout.value.children.length)
        // 重新平分
        const n = terminalLayout.value.children.length
        terminalLayout.value.sizes = terminalLayout.value.sizes.map(() => 100 / n)
      } else {
        terminalLayout.value = {
          type: 'split',
          direction: 'horizontal',
          children: [terminalLayout.value, leaf],
          sizes: [50, 50]
        }
      }
    }
  }

  function removePane(paneId: string): void {
    const index = panes.value.findIndex((p) => p.id === paneId)
    if (index === -1) return
    // 销毁 PTY 会话
    const pane = panes.value[index]
    window.electronAPI.terminal.destroy(pane.terminalId)
    panes.value.splice(index, 1)
    if (activePaneId.value === paneId) {
      activePaneId.value = panes.value.length > 0 ? panes.value[panes.value.length - 1].id : null
    }
    // 从布局树中移除
    if (terminalLayout.value) {
      terminalLayout.value = pruneTermLayout(terminalLayout.value, paneId)
    }
  }

  function pruneTermLayout(node: TermLayoutNode, removedId: string): TermLayoutNode | null {
    if (node.type === 'leaf') {
      return node.paneId === removedId ? null : node
    }
    const children = node.children
      .map((c) => pruneTermLayout(c, removedId))
      .filter((c): c is TermLayoutNode => c !== null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    const n = children.length
    return { ...node, children, sizes: children.map(() => 100 / n) }
  }

  function setActivePane(paneId: string): void {
    activePaneId.value = paneId
  }

  // 拖拽终端到另一个终端的边缘 → 创建分栏
  function splitTerminal(targetPaneId: string, draggedPaneId: string, direction: 'horizontal' | 'vertical', position: 'before' | 'after'): void {
    if (!terminalLayout.value || targetPaneId === draggedPaneId) return

    // 先从布局树中移除被拖拽的 pane
    terminalLayout.value = pruneTermLayout(terminalLayout.value, draggedPaneId)
    if (!terminalLayout.value) {
      terminalLayout.value = { type: 'leaf', paneId: draggedPaneId }
      return
    }

    // 在目标 pane 处插入分栏
    terminalLayout.value = insertTermSplit(terminalLayout.value, targetPaneId, draggedPaneId, direction, position)
    activePaneId.value = draggedPaneId
  }

  function insertTermSplit(node: TermLayoutNode, targetId: string, newId: string, direction: 'horizontal' | 'vertical', position: 'before' | 'after'): TermLayoutNode {
    if (node.type === 'leaf') {
      if (node.paneId === targetId) {
        const existing: TermLayoutLeaf = { type: 'leaf', paneId: targetId }
        const newLeaf: TermLayoutLeaf = { type: 'leaf', paneId: newId }
        return {
          type: 'split',
          direction,
          children: position === 'before' ? [newLeaf, existing] : [existing, newLeaf],
          sizes: [50, 50]
        }
      }
      return node
    }
    return { ...node, children: node.children.map((c) => insertTermSplit(c, targetId, newId, direction, position)) }
  }

  function toggleSidebar(): void { sidebarVisible.value = !sidebarVisible.value }

  function toggleDir(path: string): void {
    if (expandedDirs.value.has(path)) expandedDirs.value.delete(path)
    else expandedDirs.value.add(path)
  }

  return {
    activeLayer, panes, activePaneId, activePane, terminalLayout,
    sidebarVisible, expandedDirs,
    switchToTerminal, switchToEditor,
    addPane, removePane, setActivePane, splitTerminal,
    toggleSidebar, toggleDir
  }
})
