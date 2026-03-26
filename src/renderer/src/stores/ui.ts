import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// 图层：terminal（前台）或 editor（后台）
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

export const useUIStore = defineStore('ui', () => {
  // 当前显示的图层
  const activeLayer = ref<LayerType>('terminal')

  // 终端面板（第一层）
  const panes = ref<PaneInfo[]>([])
  const activePaneId = ref<string | null>(null)

  const activePane = computed(() => {
    if (!activePaneId.value) return null
    return panes.value.find((p) => p.id === activePaneId.value) || null
  })

  // 侧边栏 + 文件树
  const sidebarVisible = ref(true)
  const expandedDirs = ref<Set<string>>(new Set())

  // --- 图层操作 ---
  function switchToTerminal(): void {
    activeLayer.value = 'terminal'
  }

  function switchToEditor(): void {
    activeLayer.value = 'editor'
  }

  // --- 终端面板操作 ---
  function addPane(pane: PaneInfo): void {
    if (panes.value.length >= 3) return
    panes.value.push(pane)
    activePaneId.value = pane.id
  }

  function removePane(paneId: string): void {
    const index = panes.value.findIndex((p) => p.id === paneId)
    if (index === -1) return
    panes.value.splice(index, 1)
    if (activePaneId.value === paneId) {
      activePaneId.value = panes.value.length > 0 ? panes.value[panes.value.length - 1].id : null
    }
  }

  function setActivePane(paneId: string): void {
    activePaneId.value = paneId
  }

  function reorderPane(fromIndex: number, toIndex: number): void {
    const [moved] = panes.value.splice(fromIndex, 1)
    panes.value.splice(toIndex, 0, moved)
  }

  // --- 侧边栏 ---
  function toggleSidebar(): void {
    sidebarVisible.value = !sidebarVisible.value
  }

  function toggleDir(path: string): void {
    if (expandedDirs.value.has(path)) {
      expandedDirs.value.delete(path)
    } else {
      expandedDirs.value.add(path)
    }
  }

  return {
    activeLayer,
    panes,
    activePaneId,
    activePane,
    sidebarVisible,
    expandedDirs,
    switchToTerminal,
    switchToEditor,
    addPane,
    removePane,
    setActivePane,
    reorderPane,
    toggleSidebar,
    toggleDir
  }
})
