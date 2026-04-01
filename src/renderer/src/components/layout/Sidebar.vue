<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { useUIStore } from '../../stores/ui'
import FileTree from '../file-explorer/FileTree.vue'

const workspaceStore = useWorkspaceStore()
const uiStore = useUIStore()

// LSP 状态
interface LspServerInfo { id: string; name: string; languages: string[]; installed: boolean; running: boolean }
const lspServers = ref<LspServerInfo[]>([])
const lspInstalling = ref<string | null>(null)
const lspError = ref<string | null>(null)

async function refreshLspStatus(): Promise<void> {
  lspServers.value = await window.electronAPI.lsp.status()
}

async function installLsp(serverId: string): Promise<void> {
  lspInstalling.value = serverId
  lspError.value = null
  const result = await window.electronAPI.lsp.install(serverId)
  lspInstalling.value = null
  if (!result.success) lspError.value = result.error || 'Install failed'
  await refreshLspStatus()
}

async function importLsp(serverId: string): Promise<void> {
  lspInstalling.value = serverId
  lspError.value = null
  const result = await window.electronAPI.lsp.import(serverId)
  lspInstalling.value = null
  if (!result.success && result.error !== 'Cancelled') lspError.value = result.error || 'Import failed'
  await refreshLspStatus()
}

onMounted(() => refreshLspStatus())

async function handleAddProject(): Promise<void> {
  const project = await workspaceStore.addProject()
  if (!project) return

  // 自动为项目创建终端面板
  const id = `pane-${Date.now()}`
  const terminalId = `term-${Date.now()}`
  uiStore.addPane({
    id,
    terminalId,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    agentId: null,
    title: project.name
  })
}

function handleSelectProject(id: string): void {
  workspaceStore.setActiveProject(id)
  // 联动切换到该项目关联的终端面板
  const pane = uiStore.panes.find((p) => p.projectId === id)
  if (pane) {
    uiStore.setActivePane(pane.id)
  } else {
    // 没有绑定的 shell，自动创建
    const project = workspaceStore.projects.find((p) => p.id === id)
    if (project) {
      const newId = `pane-${Date.now()}`
      uiStore.addPane({
        id: newId,
        terminalId: `term-${Date.now()}`,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agentId: null,
        title: project.name
      })
    }
  }
}

async function handleRemoveProject(id: string): Promise<void> {
  // 移除关联的终端面板
  const relatedPanes = uiStore.panes.filter((p) => p.projectId === id)
  for (const pane of relatedPanes) {
    uiStore.removePane(pane.id)
  }
  await workspaceStore.removeProject(id)
}
</script>

<template>
  <div class="sidebar">
    <!-- 项目列表区域 -->
    <div class="projects-section">
      <div class="section-header">
        <span class="section-title">Projects</span>
        <button class="section-btn" @click="handleAddProject">+</button>
      </div>

      <div class="project-list">
        <div
          v-for="project in workspaceStore.projects"
          :key="project.id"
          class="project-item"
          :class="{ active: workspaceStore.activeProjectId === project.id }"
          @click="handleSelectProject(project.id)"
        >
          <span class="project-name" :title="project.path">{{ project.name }}</span>
          <button
            class="remove-btn"
            @click.stop="handleRemoveProject(project.id)"
          >
            x
          </button>
        </div>

        <div v-if="workspaceStore.projects.length === 0" class="empty-hint">
          Click + to add a project
        </div>
      </div>
    </div>

    <!-- 文件树区域 -->
    <div class="file-tree-section">
      <div class="section-header">
        <span class="section-title">
          Files
          <span v-if="workspaceStore.activeProject" class="active-project-hint">
            — {{ workspaceStore.activeProject.name }}
          </span>
        </span>
      </div>
      <div class="file-tree-container">
        <FileTree />
      </div>
    </div>

    <!-- LSP 语言服务 -->
    <div class="lsp-section">
      <div class="section-header">
        <span class="section-title">Language Servers</span>
      </div>
      <div class="lsp-list">
        <div v-for="server in lspServers" :key="server.id" class="lsp-item">
          <span class="lsp-name">{{ server.name }}</span>
          <span v-if="server.installed" class="lsp-badge installed">OK</span>
          <template v-else>
            <button
              v-if="lspInstalling !== server.id"
              class="lsp-btn"
              @click="installLsp(server.id)"
            >Install</button>
            <button
              v-if="lspInstalling !== server.id"
              class="lsp-btn import"
              @click="importLsp(server.id)"
            >Import</button>
            <span v-if="lspInstalling === server.id" class="lsp-badge installing">Installing...</span>
          </template>
        </div>
        <div v-if="lspError" class="lsp-error">{{ lspError }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #181825;
  border-right: 1px solid #313244;
  color: #cdd6f4;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #a6adc8;
}

.active-project-hint {
  text-transform: none;
  font-weight: 400;
  color: #89b4fa;
}

.section-btn {
  background: none;
  border: 1px solid #45475a;
  color: #a6adc8;
  cursor: pointer;
  font-size: 14px;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.section-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #cdd6f4;
}

.projects-section {
  flex-shrink: 0;
}

.project-list {
  max-height: 200px;
  overflow-y: auto;
}

.project-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.project-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.project-item.active {
  background: rgba(137, 180, 250, 0.15);
  color: #89b4fa;
}

.project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-btn {
  opacity: 0;
  flex-shrink: 0;
  background: none;
  border: none;
  color: #6c7086;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}

.project-item:hover .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  color: #f38ba8;
  background: rgba(255, 255, 255, 0.06);
}

.empty-hint {
  padding: 12px;
  color: #6c7086;
  font-size: 12px;
  text-align: center;
}

.file-tree-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.file-tree-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}
/* LSP Section — 固定在底部 */
.lsp-section {
  flex-shrink: 0;
  border-top: 1px solid #313244;
  max-height: 120px;
  overflow-y: auto;
}

.lsp-list { padding: 4px 8px; }

.lsp-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 4px; font-size: 12px; color: #a6adc8;
}

.lsp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.lsp-badge {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
}
.lsp-badge.installed { color: #a6e3a1; background: rgba(166,227,161,0.15); }
.lsp-badge.installing { color: #f9e2af; }

.lsp-btn {
  background: none; border: 1px solid #45475a; color: #89b4fa;
  font-size: 10px; padding: 1px 6px; border-radius: 3px; cursor: pointer;
}
.lsp-btn:hover { background: rgba(137,180,250,0.15); }
.lsp-btn.import { color: #a6adc8; }

.lsp-error {
  font-size: 10px; color: #f38ba8; padding: 2px 4px;
  word-break: break-all;
}
</style>
