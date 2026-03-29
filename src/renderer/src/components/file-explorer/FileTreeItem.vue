<script setup lang="ts">
import { ref, computed, inject, nextTick } from 'vue'
import type { FileEntry, GitStatusMap } from '@shared/types'
import { useUIStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorStore } from '../../stores/editor'

const props = defineProps<{
  entry: FileEntry
  depth: number
}>()

const emit = defineEmits<{
  refresh: [parentPath: string]
}>()

const uiStore = useUIStore()
const workspaceStore = useWorkspaceStore()
const editorStore = useEditorStore()

const gitStatusMap = inject<{ value: GitStatusMap }>('gitStatusMap', { value: {} })
const projectPath = inject<{ value: string }>('projectPath', { value: '' })

const children = ref<FileEntry[]>([])
const loading = ref(false)

// 右键菜单
const contextMenu = ref<{ x: number; y: number } | null>(null)
// 内联重命名/新建输入框
const inlineInput = ref<{ mode: 'rename' | 'newFile' | 'newDir'; value: string } | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const isExpanded = computed(() => uiStore.expandedDirs.has(props.entry.path))
const isActive = computed(() => editorStore.activeFilePath === props.entry.path)

const gitStatus = computed(() => {
  if (!projectPath.value || !gitStatusMap.value) return ''
  const rel = props.entry.path.startsWith(projectPath.value)
    ? props.entry.path.substring(projectPath.value.length + 1)
    : ''
  if (!rel) return ''
  if (gitStatusMap.value[rel]) return gitStatusMap.value[rel]
  if (props.entry.isDirectory) {
    const prefix = rel + '/'
    for (const key of Object.keys(gitStatusMap.value)) {
      if (key.startsWith(prefix)) return gitStatusMap.value[key]
    }
  }
  return ''
})

const gitColor = computed(() => {
  switch (gitStatus.value) {
    case 'M': return '#f9e2af'
    case 'A': return '#a6e3a1'
    case 'D': return '#f38ba8'
    case '?': return '#94e2d5'
    case 'U': return '#fab387'
    default: return ''
  }
})

const gitLabel = computed(() => {
  switch (gitStatus.value) {
    case 'M': return 'M'
    case 'A': return 'A'
    case 'D': return 'D'
    case '?': return 'U'
    case 'U': return '!'
    default: return ''
  }
})

async function handleClick(): Promise<void> {
  if (props.entry.isDirectory) {
    uiStore.toggleDir(props.entry.path)
    if (uiStore.expandedDirs.has(props.entry.path) && children.value.length === 0) {
      await loadChildren()
    }
  } else {
    try {
      await editorStore.openFile(props.entry.path)
    } catch (err) {
      console.error('[FileTree] Failed to open file:', err)
    }
  }
}

async function loadChildren(): Promise<void> {
  loading.value = true
  try {
    children.value = await workspaceStore.readDirectory(props.entry.path)
  } catch {
    children.value = []
  }
  loading.value = false
}

// --- 文件拖拽到编辑器 ---
function onFileDragStart(e: DragEvent): void {
  if (props.entry.isDirectory) { e.preventDefault(); return }
  e.dataTransfer!.setData('application/x-orchestrix-file', props.entry.path)
  e.dataTransfer!.effectAllowed = 'copy'
}

// --- 右键菜单 ---

function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  contextMenu.value = { x: e.clientX, y: e.clientY }
  // 点击其他地方关闭
  const close = () => { contextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

// --- 操作 ---

function getParentPath(): string {
  const parts = props.entry.path.split('/')
  parts.pop()
  return parts.join('/')
}

async function startNewFile(): Promise<void> {
  contextMenu.value = null
  if (!props.entry.isDirectory) return
  // 确保目录已展开
  if (!uiStore.expandedDirs.has(props.entry.path)) {
    uiStore.toggleDir(props.entry.path)
    await loadChildren()
  }
  inlineInput.value = { mode: 'newFile', value: '' }
  await nextTick()
  inputRef.value?.focus()
}

async function startNewDir(): Promise<void> {
  contextMenu.value = null
  if (!props.entry.isDirectory) return
  if (!uiStore.expandedDirs.has(props.entry.path)) {
    uiStore.toggleDir(props.entry.path)
    await loadChildren()
  }
  inlineInput.value = { mode: 'newDir', value: '' }
  await nextTick()
  inputRef.value?.focus()
}

async function startRename(): Promise<void> {
  contextMenu.value = null
  inlineInput.value = { mode: 'rename', value: props.entry.name }
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

async function confirmInput(): Promise<void> {
  if (!inlineInput.value || !inlineInput.value.value.trim()) {
    inlineInput.value = null
    return
  }

  const name = inlineInput.value.value.trim()
  const mode = inlineInput.value.mode

  try {
    if (mode === 'newFile') {
      const newPath = props.entry.path + '/' + name
      await window.electronAPI.workspace.createFile(newPath)
      await loadChildren()
    } else if (mode === 'newDir') {
      const newPath = props.entry.path + '/' + name
      await window.electronAPI.workspace.createDir(newPath)
      await loadChildren()
    } else if (mode === 'rename') {
      const parentPath = getParentPath()
      const newPath = parentPath + '/' + name
      await window.electronAPI.workspace.renameFile(props.entry.path, newPath)
      emit('refresh', parentPath)
    }
  } catch (err) {
    console.error('[FileTree] Operation failed:', err)
  }

  inlineInput.value = null
}

function cancelInput(): void {
  inlineInput.value = null
}

async function deleteEntry(): Promise<void> {
  contextMenu.value = null
  const type = props.entry.isDirectory ? 'directory' : 'file'
  // 简单确认（后续可用 Electron dialog）
  try {
    await window.electronAPI.workspace.deleteFile(props.entry.path)
    emit('refresh', getParentPath())
  } catch (err) {
    console.error('[FileTree] Delete failed:', err)
  }
}

function handleChildRefresh(parentPath: string): void {
  if (parentPath === props.entry.path) {
    loadChildren()
  } else {
    emit('refresh', parentPath)
  }
}
</script>

<template>
  <div class="file-tree-item">
    <div
      class="item-row"
      :class="{ 'is-active': isActive }"
      :style="{ paddingLeft: `${depth * 16 + 8}px`, color: gitColor || undefined }"
      :draggable="!entry.isDirectory"
      @click="handleClick"
      @contextmenu="onContextMenu"
      @dragstart="onFileDragStart"
    >
      <span v-if="entry.isDirectory" class="icon">{{ isExpanded ? '▼' : '▶' }}</span>
      <span v-else class="icon file-icon">·</span>
      <span class="name" :title="entry.path">{{ entry.name }}</span>
      <span v-if="gitLabel" class="git-badge" :style="{ color: gitColor }">{{ gitLabel }}</span>
    </div>

    <!-- 内联重命名输入框（替代当前行） -->
    <div
      v-if="inlineInput?.mode === 'rename'"
      class="inline-input-row"
      :style="{ paddingLeft: `${depth * 16 + 24}px` }"
    >
      <input
        ref="inputRef"
        v-model="inlineInput.value"
        class="inline-input"
        @keydown.enter="confirmInput"
        @keydown.escape="cancelInput"
        @blur="confirmInput"
      />
    </div>

    <!-- 子目录 -->
    <div v-if="entry.isDirectory && isExpanded" class="children">
      <!-- 新建文件/目录的输入框 -->
      <div
        v-if="inlineInput && (inlineInput.mode === 'newFile' || inlineInput.mode === 'newDir')"
        class="inline-input-row"
        :style="{ paddingLeft: `${(depth + 1) * 16 + 8}px` }"
      >
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

      <div v-if="loading" class="loading" :style="{ paddingLeft: `${(depth + 1) * 16 + 8}px` }">
        Loading...
      </div>
      <FileTreeItem
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        @refresh="handleChildRefresh"
      />
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div v-if="entry.isDirectory" class="ctx-item" @click="startNewFile">New File</div>
        <div v-if="entry.isDirectory" class="ctx-item" @click="startNewDir">New Folder</div>
        <div v-if="entry.isDirectory" class="ctx-divider" />
        <div class="ctx-item" @click="startRename">Rename</div>
        <div class="ctx-item danger" @click="deleteEntry">Delete</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.item-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 13px;
  color: #cdd6f4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.item-row:hover { background: rgba(255, 255, 255, 0.06); }
.item-row.is-active { background: rgba(137, 180, 250, 0.15); }

.icon { font-size: 10px; width: 14px; flex-shrink: 0; text-align: center; color: #89b4fa; }
.file-icon { color: #6c7086; }
.name { overflow: hidden; text-overflow: ellipsis; flex: 1; }

.git-badge {
  font-size: 9px; font-weight: 700; flex-shrink: 0; margin-left: auto;
  padding: 1px 4px; border-radius: 3px; background: rgba(255,255,255,0.08); line-height: 14px;
}

.loading { font-size: 12px; color: #6c7086; padding: 3px 8px; }

/* 内联输入框 */
.inline-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
}

.inline-input {
  flex: 1;
  background: #181825;
  border: 1px solid #89b4fa;
  color: #cdd6f4;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 3px;
  outline: none;
  font-family: inherit;
}

.inline-input::placeholder { color: #585b70; }

/* 右键菜单 */
.context-menu {
  position: fixed;
  z-index: 9999;
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.ctx-item {
  padding: 6px 16px;
  font-size: 13px;
  color: #cdd6f4;
  cursor: pointer;
}

.ctx-item:hover { background: rgba(137, 180, 250, 0.15); }
.ctx-item.danger { color: #f38ba8; }
.ctx-item.danger:hover { background: rgba(243, 139, 168, 0.15); }

.ctx-divider {
  height: 1px;
  background: #45475a;
  margin: 4px 0;
}
</style>
