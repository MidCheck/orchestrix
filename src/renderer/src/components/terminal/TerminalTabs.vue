<script setup lang="ts">
import { useUIStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import TerminalPane from './TerminalPane.vue'

const uiStore = useUIStore()
const workspaceStore = useWorkspaceStore()

function handleAdd(): void {
  if (uiStore.panes.length >= 3) return
  const id = `pane-${Date.now()}`
  const terminalId = `term-${Date.now()}`
  uiStore.addPane({
    id,
    terminalId,
    projectId: null,
    projectName: null,
    projectPath: null,
    agentId: null,
    title: `Shell ${uiStore.panes.length + 1}`
  })
}

function handleClose(paneId: string): void {
  uiStore.removePane(paneId)
}

function handleSelectPane(paneId: string): void {
  uiStore.setActivePane(paneId)
  // 联动切换文件树
  const pane = uiStore.panes.find((p) => p.id === paneId)
  if (pane?.projectId) {
    workspaceStore.setActiveProject(pane.projectId)
  }
}
</script>

<template>
  <div class="terminal-area">
    <!-- 终端面板并排显示 -->
    <div v-if="uiStore.panes.length > 0" class="panes-container">
      <div
        v-for="pane in uiStore.panes"
        :key="pane.id"
        class="pane-wrapper"
        :class="{ active: uiStore.activePaneId === pane.id }"
        @click="handleSelectPane(pane.id)"
      >
        <!-- 面板头部 -->
        <div class="pane-header">
          <span class="pane-title">
            {{ pane.title }}
            <span v-if="pane.projectName" class="pane-project">
              @ {{ pane.projectName }}
            </span>
          </span>
          <button class="pane-close" @click.stop="handleClose(pane.id)">x</button>
        </div>
        <!-- 终端 -->
        <div class="pane-body">
          <TerminalPane
            :terminal-id="pane.terminalId"
            :cwd="pane.projectPath ?? undefined"
          />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <p>No terminals open</p>
      <button class="add-btn" @click="handleAdd">Open Terminal</button>
    </div>

    <!-- 底部工具栏 -->
    <div class="toolbar-bottom">
      <button
        class="add-btn-small"
        :disabled="uiStore.panes.length >= 3"
        @click="handleAdd"
      >
        + New Terminal
      </button>
      <span class="pane-count">{{ uiStore.panes.length }} / 3</span>
    </div>
  </div>
</template>

<style scoped>
.terminal-area {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.panes-container {
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

.pane-wrapper.active {
  border-color: #89b4fa;
}

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

.pane-project {
  color: #89b4fa;
  font-size: 11px;
}

.pane-close {
  background: none;
  border: none;
  color: #6c7086;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.pane-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f38ba8;
}

.pane-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #6c7086;
  font-size: 14px;
}

.toolbar-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 8px;
  background: #181825;
  border-top: 1px solid #313244;
  flex-shrink: 0;
}

.add-btn {
  background: #89b4fa;
  border: none;
  color: #1e1e2e;
  padding: 8px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.add-btn:hover {
  background: #b4d0fb;
}

.add-btn-small {
  background: none;
  border: none;
  color: #a6adc8;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
}

.add-btn-small:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.add-btn-small:disabled {
  color: #45475a;
  cursor: not-allowed;
}

.pane-count {
  font-size: 11px;
  color: #6c7086;
}
</style>
