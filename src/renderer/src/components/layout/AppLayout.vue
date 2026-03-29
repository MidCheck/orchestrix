<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorStore } from '../../stores/editor'
import Sidebar from './Sidebar.vue'
import TerminalSplitContainer from '../terminal/TerminalSplitContainer.vue'
import EditorLayer from '../editor/EditorLayer.vue'

const uiStore = useUIStore()
const workspaceStore = useWorkspaceStore()
const editorStore = useEditorStore()

// --- 全局快捷键 ---
function handleKeyDown(e: KeyboardEvent): void {
  // Ctrl+` 或 Cmd+` 切换图层
  if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault()
    if (uiStore.activeLayer === 'terminal') {
      if (editorStore.layoutRoot) uiStore.switchToEditor()
    } else {
      uiStore.switchToTerminal()
    }
    return
  }

  // Ctrl+Tab / Cmd+Tab 切换终端面板（仅在终端层）
  if (e.ctrlKey && e.key === 'Tab' && uiStore.activeLayer === 'terminal') {
    e.preventDefault()
    const panes = uiStore.panes
    if (panes.length < 2) return
    const currentIdx = panes.findIndex((p) => p.id === uiStore.activePaneId)
    const nextIdx = e.shiftKey
      ? (currentIdx - 1 + panes.length) % panes.length
      : (currentIdx + 1) % panes.length
    switchToPane(panes[nextIdx].id)
    return
  }

  // Ctrl+1~9 切换到第 N 个终端面板
  if (e.ctrlKey && e.key >= '1' && e.key <= '9' && uiStore.activeLayer === 'terminal') {
    const idx = parseInt(e.key) - 1
    if (idx < uiStore.panes.length) {
      e.preventDefault()
      switchToPane(uiStore.panes[idx].id)
    }
    return
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown))

function switchToPane(paneId: string): void {
  uiStore.setActivePane(paneId)
  const pane = uiStore.panes.find((p) => p.id === paneId)
  if (pane?.projectId) workspaceStore.setActiveProject(pane.projectId)
}

async function handleAddProject(): Promise<void> {
  const project = await workspaceStore.addProject()
  if (!project) return
  uiStore.addPane({
    id: `pane-${Date.now()}`,
    terminalId: `term-${Date.now()}`,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    agentId: null,
    title: project.name
  })
}

</script>

<template>
  <div class="app-layout">
    <!-- 侧边栏 -->
    <div v-show="uiStore.sidebarVisible" class="sidebar-container">
      <Sidebar />
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 顶部工具栏 -->
      <div class="toolbar">
        <button class="toolbar-btn" @click="uiStore.toggleSidebar">
          {{ uiStore.sidebarVisible ? '◀' : '▶' }}
        </button>
        <span class="toolbar-title">Orchestrix</span>

        <!-- 图层切换器（有项目时才显示） -->
        <div v-if="uiStore.panes.length > 0" class="layer-switcher">
          <button
            class="layer-btn"
            :class="{ active: uiStore.activeLayer === 'terminal' }"
            @click="uiStore.switchToTerminal()"
          >
            Terminal
          </button>
          <button
            class="layer-btn"
            :class="{ active: uiStore.activeLayer === 'editor' }"
            :disabled="!editorStore.layoutRoot"
            @click="uiStore.switchToEditor()"
          >
            Files
            <span v-if="editorStore.currentProjectFiles.length > 0" class="file-count">
              {{ editorStore.currentProjectFiles.length }}
            </span>
          </button>
        </div>

        <div class="toolbar-spacer" />

        <span v-if="workspaceStore.activeProject" class="toolbar-project">
          {{ workspaceStore.activeProject.name }}
        </span>
      </div>


      <!-- 图层容器 -->
      <div class="layer-container">
        <!-- 第一层：终端（可自由分栏布局） -->
        <div v-show="uiStore.activeLayer === 'terminal'" class="layer terminal-layer">
          <TerminalSplitContainer
            v-if="uiStore.terminalLayout"
            :node="uiStore.terminalLayout"
          />
          <!-- 空状态 -->
          <div v-else class="empty-state">
            <p class="empty-title">Welcome to Orchestrix</p>
            <p class="empty-hint">Add a project to start working</p>
            <button class="primary-btn" @click="handleAddProject">+ Add Project</button>
          </div>
        </div>

        <!-- 第二层：文件编辑器 -->
        <div v-show="uiStore.activeLayer === 'editor'" class="layer editor-layer">
          <EditorLayer />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: #1e1e2e;
  color: #cdd6f4;
  overflow: hidden;
}

.sidebar-container {
  width: 260px;
  height: 100%;
  flex-shrink: 0;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.toolbar-btn {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: #a6adc8;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
}
.toolbar-btn:hover { background: rgba(255,255,255,0.1); }

.toolbar-title {
  font-size: 13px;
  font-weight: 600;
  color: #a6adc8;
}

.toolbar-project {
  font-size: 12px;
  color: #89b4fa;
  -webkit-app-region: no-drag;
}

.toolbar-spacer { flex: 1; -webkit-app-region: drag; }

/* 图层切换器 */
.layer-switcher {
  display: flex;
  background: #11111b;
  border-radius: 6px;
  padding: 2px;
  -webkit-app-region: no-drag;
}

.layer-btn {
  background: none;
  border: none;
  color: #6c7086;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.layer-btn:hover:not(:disabled) { color: #a6adc8; }
.layer-btn:disabled { color: #45475a; cursor: not-allowed; }
.layer-btn.active { background: #313244; color: #cdd6f4; }
.layer-btn.active:first-child { color: #a6e3a1; }
.layer-btn.active:last-child { color: #89b4fa; }

.file-count {
  background: #45475a;
  color: #cdd6f4;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 8px;
  line-height: 16px;
}

/* Layer container */
.layer-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
}

/* Terminal layer */
.terminal-layer {
  display: flex;
  flex-direction: column;
}

/* Empty state */
.empty-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
}
.empty-title { font-size: 18px; color: #cdd6f4; font-weight: 600; }
.empty-hint { font-size: 13px; color: #6c7086; }

.primary-btn {
  background: #89b4fa; border: none; color: #1e1e2e;
  padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
}
.primary-btn:hover { background: #b4d0fb; }

/* Editor layer */
.editor-layer {
  display: flex;
  flex-direction: column;
}
</style>
