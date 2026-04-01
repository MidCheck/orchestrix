<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import MonacoEditor from './MonacoEditor.vue'
import MediaPreview from './MediaPreview.vue'
import HexEditor from './HexEditor.vue'

const props = defineProps<{ groupId: string }>()

const editorStore = useEditorStore()
const workspaceStore = useWorkspaceStore()

const group = computed(() => editorStore.groups[props.groupId])
const isActive = computed(() => editorStore.activeGroupId === props.groupId)
const files = computed(() => {
  if (!group.value) return []
  return group.value.files
    .map((p) => editorStore.getFileByPath(p))
    .filter((f): f is NonNullable<typeof f> => !!f)
})
const activeFilePath = computed(() => group.value?.activeFile || null)
const activeFileData = computed(() => {
  if (!activeFilePath.value) return null
  return editorStore.getFileByPath(activeFilePath.value) || null
})

function isFileModified(path: string): boolean {
  const f = editorStore.getFileByPath(path)
  return f ? f.content !== f.savedContent : false
}

// --- Tab Drag & Drop ---

function onTabDragStart(e: DragEvent, filePath: string): void {
  e.dataTransfer!.setData('application/x-orchestrix-tab', JSON.stringify({ filePath, fromGroupId: props.groupId }))
  e.dataTransfer!.effectAllowed = 'move'
}

function onTabDragOver(e: DragEvent): void {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onTabDrop(e: DragEvent, targetIndex: number): void {
  e.preventDefault()
  const fileTreePath = e.dataTransfer?.getData('application/x-orchestrix-file')
  if (fileTreePath) { editorStore.openFile(fileTreePath, props.groupId); return }
  const raw = e.dataTransfer?.getData('application/x-orchestrix-tab')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)
  if (fromGroupId === props.groupId) {
    const fromIndex = group.value!.files.indexOf(filePath)
    if (fromIndex !== -1 && fromIndex !== targetIndex) editorStore.reorderFile(props.groupId, fromIndex, targetIndex)
  } else {
    editorStore.moveFileToGroup(fromGroupId, props.groupId, filePath, targetIndex)
  }
}

// --- Editor Area Drag (split zones) ---

const dragOverZone = ref<string | null>(null)

function onEditorDragOver(e: DragEvent): void {
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const w = rect.width, h = rect.height, t = 0.25
  if (x < w * t) dragOverZone.value = 'left'
  else if (x > w * (1 - t)) dragOverZone.value = 'right'
  else if (y < h * t) dragOverZone.value = 'top'
  else if (y > h * (1 - t)) dragOverZone.value = 'bottom'
  else dragOverZone.value = 'center'
}

function onEditorDragLeave(): void { dragOverZone.value = null }

function onEditorDrop(e: DragEvent): void {
  e.preventDefault()
  const zone = dragOverZone.value
  dragOverZone.value = null

  // File from sidebar
  const fileTreePath = e.dataTransfer?.getData('application/x-orchestrix-file')
  if (fileTreePath) {
    if (zone === 'center' || !zone) {
      editorStore.openFile(fileTreePath, props.groupId)
    } else {
      const dir = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical'
      const pos = (zone === 'left' || zone === 'top') ? 'before' : 'after'
      const gid = `group-drop-${Date.now()}`
      editorStore.groups[gid] = { id: gid, files: [], activeFile: null }
      if (editorStore.layoutRoot) {
        editorStore.layoutRoot = {
          type: 'split', direction: dir,
          children: pos === 'before'
            ? [{ type: 'leaf', groupId: gid }, editorStore.layoutRoot]
            : [editorStore.layoutRoot, { type: 'leaf', groupId: gid }],
          sizes: [50, 50]
        }
      }
      editorStore.openFile(fileTreePath, gid)
    }
    return
  }

  // Tab from another group
  const raw = e.dataTransfer?.getData('application/x-orchestrix-tab')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)
  if (zone === 'center' || !zone) {
    if (fromGroupId !== props.groupId) editorStore.moveFileToGroup(fromGroupId, props.groupId, filePath)
  } else {
    const dir = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical'
    const pos = (zone === 'left' || zone === 'top') ? 'before' : 'after'
    editorStore.splitWithFile(props.groupId, filePath, fromGroupId, dir, pos)
  }
}

// --- Tab Context Menu ---

const tabContextMenu = ref<{ x: number; y: number; filePath: string } | null>(null)

function onTabContext(e: MouseEvent, filePath: string): void {
  e.preventDefault()
  tabContextMenu.value = { x: e.clientX, y: e.clientY, filePath }
  const close = () => { tabContextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function openInSplit(filePath: string): Promise<void> {
  tabContextMenu.value = null
  const newGid = `group-split-${Date.now()}`
  editorStore.groups[newGid] = { id: newGid, files: [], activeFile: null }
  if (editorStore.layoutRoot) {
    editorStore.layoutRoot = {
      type: 'split', direction: 'horizontal',
      children: [editorStore.layoutRoot, { type: 'leaf', groupId: newGid }],
      sizes: [50, 50]
    }
  }
  await editorStore.openFile(filePath, newGid)
}

// --- Diff Toggle ---

const diffMode = ref(false)

watch(activeFilePath, () => {
  diffMode.value = false
})
</script>

<template>
  <div
    class="editor-group"
    :class="{ active: isActive }"
    @mousedown="editorStore.setActiveGroup(props.groupId)"
  >
    <!-- Tab 栏 -->
    <div class="tab-bar">
      <div
        v-for="(file, index) in files"
        :key="file.path"
        class="tab"
        :class="{ active: activeFilePath === file.path }"
        draggable="true"
        @dragstart="onTabDragStart($event, file.path)"
        @dragover="onTabDragOver"
        @drop="onTabDrop($event, index)"
        @click="editorStore.setActiveFile(props.groupId, file.path)"
        @contextmenu="onTabContext($event, file.path)"
      >
        <span class="tab-name">
          <span v-if="isFileModified(file.path)" class="modified-dot" />
          {{ file.name }}
        </span>
        <button class="tab-close" @click.stop="editorStore.closeFile(props.groupId, file.path)">x</button>
      </div>
      <!-- Diff 按钮 -->
      <button
        v-if="activeFileData?.kind === 'text'"
        class="diff-btn"
        :class="{ active: diffMode }"
        @click="diffMode = !diffMode"
      >
        {{ diffMode ? '✕ Diff' : '⇄ Diff' }}
      </button>
    </div>

    <!-- 编辑器 -->
    <div
      class="editor-body"
      @dragover="onEditorDragOver"
      @dragleave="onEditorDragLeave"
      @drop="onEditorDrop"
    >
      <!-- Monaco 编辑器（文本文件）-->
      <MonacoEditor
        v-if="activeFileData?.kind === 'text' && activeFilePath"
        :key="activeFilePath"
        :file-path="activeFilePath"
        :group-id="props.groupId"
        :diff-mode="diffMode"
      />

      <!-- 图片/视频/音频预览 -->
      <MediaPreview
        v-if="activeFileData && (activeFileData.kind === 'image' || activeFileData.kind === 'video' || activeFileData.kind === 'audio')"
        :file="activeFileData"
      />

      <!-- Hex Editor -->
      <HexEditor
        v-if="activeFileData && activeFileData.kind === 'binary'"
        :file="activeFileData"
      />

      <!-- 空状态 -->
      <div v-if="!activeFileData" class="empty">Click a file to open</div>

      <!-- 拖拽指示器 -->
      <div v-if="dragOverZone" class="drop-indicator" :class="dragOverZone" />
    </div>

    <!-- Tab 右键菜单 -->
    <Teleport to="body">
      <div v-if="tabContextMenu" class="context-menu" :style="{ left: tabContextMenu.x + 'px', top: tabContextMenu.y + 'px' }">
        <div class="ctx-item" @click="openInSplit(tabContextMenu!.filePath)">Open in Split Right</div>
        <div class="ctx-item" @click="editorStore.closeFile(props.groupId, tabContextMenu!.filePath); tabContextMenu = null">Close</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.editor-group {
  display: flex; flex-direction: column; height: 100%;
  overflow: hidden; border: 1px solid transparent;
}
.editor-group.active { border-color: #89b4fa; }

.tab-bar {
  display: flex; height: 30px; background: #11111b;
  border-bottom: 1px solid #313244; overflow-x: auto; flex-shrink: 0;
}
.tab-bar::-webkit-scrollbar { height: 0; }

.tab {
  display: flex; align-items: center; gap: 6px;
  height: 100%; padding: 0 10px; font-size: 12px; color: #6c7086;
  cursor: grab; white-space: nowrap; border-right: 1px solid #181825;
  user-select: none; flex-shrink: 0;
}
.tab:hover { color: #a6adc8; background: rgba(255,255,255,0.04); }
.tab.active { color: #cdd6f4; background: #1e1e2e; border-bottom: 2px solid #89b4fa; }

.tab-name { display: flex; align-items: center; gap: 4px; }
.modified-dot { width: 6px; height: 6px; border-radius: 50%; background: #f9e2af; }

.tab-close {
  background: none; border: none; color: #6c7086; cursor: pointer;
  font-size: 11px; padding: 1px 4px; border-radius: 3px; opacity: 0;
}
.tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: rgba(255,255,255,0.1); color: #f38ba8; }

.diff-btn {
  background: none; border: none; color: #6c7086; font-size: 11px;
  padding: 0 10px; cursor: pointer; margin-left: auto; flex-shrink: 0;
}
.diff-btn:hover { color: #a6adc8; }
.diff-btn.active { color: #f9e2af; }

.editor-body { flex: 1; overflow: hidden; min-height: 0; position: relative; }

.empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: #6c7086; font-size: 13px;
}

.drop-indicator {
  position: absolute; pointer-events: none;
  background: rgba(137,180,250,0.15); border: 2px solid rgba(137,180,250,0.5);
  border-radius: 4px; transition: all 0.1s;
}
.drop-indicator.left   { top:0; left:0; width:50%; height:100%; }
.drop-indicator.right  { top:0; right:0; width:50%; height:100%; }
.drop-indicator.top    { top:0; left:0; width:100%; height:50%; }
.drop-indicator.bottom { bottom:0; left:0; width:100%; height:50%; }
.drop-indicator.center { top:4px; left:4px; right:4px; bottom:4px; }

.context-menu {
  position: fixed; z-index: 9999; background: #313244; border: 1px solid #45475a;
  border-radius: 6px; padding: 4px 0; min-width: 180px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.ctx-item { padding: 6px 16px; font-size: 13px; color: #cdd6f4; cursor: pointer; }
.ctx-item:hover { background: rgba(137,180,250,0.15); }
</style>
