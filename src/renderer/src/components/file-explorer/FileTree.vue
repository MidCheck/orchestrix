<script setup lang="ts">
import { ref, watch, provide, reactive, nextTick } from 'vue'
import type { FileEntry, GitStatusMap } from '@shared/types'
import { useWorkspaceStore } from '../../stores/workspace'
import FileTreeItem from './FileTreeItem.vue'

const workspaceStore = useWorkspaceStore()
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const gitStatusMap = reactive<{ value: GitStatusMap }>({ value: {} })
const projectPath = reactive<{ value: string }>({ value: '' })

provide('gitStatusMap', gitStatusMap)
provide('projectPath', projectPath)

// 右键菜单（空白处）
const contextMenu = ref<{ x: number; y: number } | null>(null)
const inlineInput = ref<{ mode: 'newFile' | 'newDir'; value: string } | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

async function loadGitStatus(path: string): Promise<void> {
  try {
    const isGit = await window.electronAPI.workspace.isGitRepo(path)
    gitStatusMap.value = isGit ? await window.electronAPI.workspace.gitStatus(path) : {}
  } catch {
    gitStatusMap.value = {}
  }
}

async function loadEntries(): Promise<void> {
  const project = workspaceStore.activeProject
  if (!project) { entries.value = []; return }
  loading.value = true
  error.value = null
  try {
    const [result] = await Promise.all([
      workspaceStore.readDirectory(project.path),
      loadGitStatus(project.path)
    ])
    entries.value = result
  } catch (err) {
    entries.value = []
    error.value = String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => workspaceStore.activeProjectId,
  (projectId) => {
    if (!projectId) { entries.value = []; error.value = null; gitStatusMap.value = {}; return }
    const project = workspaceStore.projects.find((p) => p.id === projectId)
    if (project) projectPath.value = project.path
    loadEntries()
  },
  { immediate: true }
)

let gitRefreshTimer: ReturnType<typeof setInterval> | null = null
watch(
  () => workspaceStore.activeProject,
  (project) => {
    if (gitRefreshTimer) clearInterval(gitRefreshTimer)
    if (project) gitRefreshTimer = setInterval(() => loadGitStatus(project.path), 3000)
  },
  { immediate: true }
)

// 子组件刷新请求
function handleChildRefresh(parentPath: string): void {
  const project = workspaceStore.activeProject
  if (project && parentPath === project.path) {
    loadEntries()
  }
  // 子目录的刷新由子组件自己处理
}

// 空白处右键菜单
function onContextMenu(e: MouseEvent): void {
  // 只在文件树空白处触发
  const target = e.target as HTMLElement
  if (target.closest('.file-tree-item')) return
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY }
  const close = () => { contextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function startNewFile(): Promise<void> {
  contextMenu.value = null
  inlineInput.value = { mode: 'newFile', value: '' }
  await nextTick()
  inputRef.value?.focus()
}

async function startNewDir(): Promise<void> {
  contextMenu.value = null
  inlineInput.value = { mode: 'newDir', value: '' }
  await nextTick()
  inputRef.value?.focus()
}

async function confirmInput(): Promise<void> {
  if (!inlineInput.value || !inlineInput.value.value.trim()) { inlineInput.value = null; return }
  const project = workspaceStore.activeProject
  if (!project) return

  const name = inlineInput.value.value.trim()
  try {
    if (inlineInput.value.mode === 'newFile') {
      await window.electronAPI.workspace.createFile(project.path + '/' + name)
    } else {
      await window.electronAPI.workspace.createDir(project.path + '/' + name)
    }
    await loadEntries()
  } catch (err) {
    console.error('[FileTree] Create failed:', err)
  }
  inlineInput.value = null
}

function cancelInput(): void {
  inlineInput.value = null
}
</script>

<template>
  <div class="file-tree" @contextmenu="onContextMenu">
    <div v-if="loading" class="status-text">Loading...</div>
    <div v-else-if="error" class="status-text error">{{ error }}</div>
    <div v-else-if="entries.length === 0 && !workspaceStore.activeProjectId" class="status-text">
      No project selected
    </div>
    <template v-else>
      <!-- 根目录新建输入框 -->
      <div v-if="inlineInput" class="inline-input-row" style="padding-left: 8px">
        <span class="icon" style="font-size:10px">{{ inlineInput.mode === 'newDir' ? '▶' : '·' }}</span>
        <input
          ref="inputRef"
          v-model="inlineInput.value"
          class="inline-input"
          :placeholder="inlineInput.mode === 'newFile' ? 'filename' : 'dirname'"
          @keydown.enter="confirmInput"
          @keydown.escape="cancelInput"
          @blur="confirmInput"
        />
      </div>
      <FileTreeItem
        v-for="entry in entries"
        :key="entry.path"
        :entry="entry"
        :depth="0"
        @refresh="handleChildRefresh"
      />
    </template>

    <!-- 空白处右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div class="ctx-item" @click="startNewFile">New File</div>
        <div class="ctx-item" @click="startNewDir">New Folder</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.file-tree { height: 100%; overflow-y: auto; overflow-x: hidden; }
.status-text { padding: 16px; color: #6c7086; font-size: 13px; text-align: center; }
.status-text.error { color: #f38ba8; }

.inline-input-row {
  display: flex; align-items: center; gap: 4px; padding: 2px 8px;
}
.inline-input {
  flex: 1; background: #181825; border: 1px solid #89b4fa; color: #cdd6f4;
  font-size: 13px; padding: 2px 6px; border-radius: 3px; outline: none; font-family: inherit;
}
.inline-input::placeholder { color: #585b70; }
.icon { color: #89b4fa; }

.context-menu {
  position: fixed; z-index: 9999; background: #313244; border: 1px solid #45475a;
  border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.ctx-item { padding: 6px 16px; font-size: 13px; color: #cdd6f4; cursor: pointer; }
.ctx-item:hover { background: rgba(137, 180, 250, 0.15); }
</style>
