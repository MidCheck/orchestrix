<script setup lang="ts">
import { useUIStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorStore } from '../../stores/editor'
import Sidebar from './Sidebar.vue'
import TerminalPane from '../terminal/TerminalPane.vue'
import EditorLayer from '../editor/EditorLayer.vue'

const uiStore = useUIStore()
const workspaceStore = useWorkspaceStore()
const editorStore = useEditorStore()

function handlePaneClick(paneId: string): void {
  uiStore.setActivePane(paneId)
  const pane = uiStore.panes.find((p) => p.id === paneId)
  if (pane?.projectId) {
    workspaceStore.setActiveProject(pane.projectId)
  }
}

async function handleAddProject(): Promise<void> {
  const project = await workspaceStore.addProject()
  if (!project) return
  if (uiStore.panes.length < 3) {
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
}

// --- 终端面板拖拽排序 ---
function onPaneDragStart(e: DragEvent, index: number): void {
  e.dataTransfer!.setData('text/plain', String(index))
  e.dataTransfer!.effectAllowed = 'move'
}

function onPaneDragOver(e: DragEvent): void {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onPaneDrop(e: DragEvent, toIndex: number): void {
  e.preventDefault()
  const fromIndex = parseInt(e.dataTransfer!.getData('text/plain'), 10)
  if (isNaN(fromIndex) || fromIndex === toIndex) return
  uiStore.reorderPane(fromIndex, toIndex)
  // 同步侧边栏项目顺序：按面板顺序重排 projects
  workspaceStore.reorderByPanes(uiStore.panes)
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
        <!-- 第一层：终端（多面板并排） -->
        <div v-show="uiStore.activeLayer === 'terminal'" class="layer terminal-layer">
          <div v-if="uiStore.panes.length > 0" class="panes-row">
            <div
              v-for="(pane, index) in uiStore.panes"
              :key="pane.id"
              class="pane-wrapper"
              :class="{ active: uiStore.activePaneId === pane.id }"
              @click="handlePaneClick(pane.id)"
            >
              <div
                class="pane-header"
                draggable="true"
                @dragstart="onPaneDragStart($event, index)"
                @dragover="onPaneDragOver"
                @drop="onPaneDrop($event, index)"
              >
                <span class="pane-title">{{ pane.title }}</span>
              </div>
              <div class="pane-body">
                <TerminalPane
                  :terminal-id="pane.terminalId"
                  :cwd="pane.projectPath ?? undefined"
                />
              </div>
            </div>
          </div>
          <!-- 空状态：引导添加项目 -->
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

.panes-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 1px;
  background: #313244;
  overflow: hidden;
  min-height: 0;
}

.pane-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #1e1e2e;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}
.pane-wrapper.active { border-color: #89b4fa; }

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

.pane-title {
  font-size: 12px;
  color: #a6adc8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-close {
  background: none; border: none; color: #6c7086;
  cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
}
.pane-close:hover { background: rgba(255,255,255,0.1); color: #f38ba8; }

.pane-body { flex: 1; overflow: hidden; min-height: 0; }

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
