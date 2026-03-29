<script setup lang="ts">
import { ref } from 'vue'
import type { TermLayoutNode } from '../../stores/ui'
import { useUIStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import TerminalPane from './TerminalPane.vue'

const props = defineProps<{ node: TermLayoutNode }>()

const uiStore = useUIStore()
const workspaceStore = useWorkspaceStore()

const isDragging = ref(false)

// 右键菜单
const contextMenu = ref<{ x: number; y: number; paneId: string } | null>(null)
// TerminalPane ref（用于调用 restart）
const terminalPaneRef = ref<InstanceType<typeof TerminalPane> | null>(null)

function onHeaderContext(e: MouseEvent, paneId: string): void {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, paneId }
  const close = () => { contextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function restartShell(): Promise<void> {
  if (!contextMenu.value) return
  const paneId = contextMenu.value.paneId
  contextMenu.value = null
  // 通过 DOM 查找对应的 TerminalPane 组件实例并调用 restart
  // 由于递归组件，ref 只能绑定当前叶节点的 TerminalPane
  if (props.node.type === 'leaf' && props.node.paneId === paneId && terminalPaneRef.value) {
    await terminalPaneRef.value.restart()
  }
}

function clearShell(): void {
  if (!contextMenu.value) return
  const paneId = contextMenu.value.paneId
  contextMenu.value = null
  // 发送 clear 命令
  const pane = uiStore.panes.find(p => p.id === paneId)
  if (pane) {
    window.electronAPI.terminal.write(pane.terminalId, 'clear\n')
  }
}

function getPane(paneId: string) {
  return uiStore.panes.find((p) => p.id === paneId)
}

function handlePaneClick(paneId: string): void {
  uiStore.setActivePane(paneId)
  const pane = uiStore.panes.find((p) => p.id === paneId)
  if (pane?.projectId) workspaceStore.setActiveProject(pane.projectId)
}

// 拖拽分割线调整尺寸
function startResize(e: MouseEvent, index: number): void {
  if (props.node.type !== 'split') return
  const node = props.node
  isDragging.value = true
  const container = (e.target as HTMLElement).parentElement!
  const rect = container.getBoundingClientRect()
  const isH = node.direction === 'horizontal'
  const total = isH ? rect.width : rect.height
  const startPos = isH ? e.clientX : e.clientY
  const startSizes = [...node.sizes]

  const onMove = (me: MouseEvent): void => {
    const cur = isH ? me.clientX : me.clientY
    const delta = ((cur - startPos) / total) * 100
    const a = Math.max(10, startSizes[index] + delta)
    const b = Math.max(10, startSizes[index + 1] - delta)
    const sum = startSizes[index] + startSizes[index + 1]
    node.sizes[index] = (a / (a + b)) * sum
    node.sizes[index + 1] = (b / (a + b)) * sum
  }
  const onUp = (): void => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 终端面板拖拽
const dragOverZone = ref<string | null>(null)

function onHeaderDragStart(e: DragEvent, paneId: string): void {
  e.dataTransfer!.setData('application/x-orchestrix-terminal', paneId)
  e.dataTransfer!.effectAllowed = 'move'
}

function onPaneDragOver(e: DragEvent): void {
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const w = rect.width
  const h = rect.height
  const t = 0.25
  if (x < w * t) dragOverZone.value = 'left'
  else if (x > w * (1 - t)) dragOverZone.value = 'right'
  else if (y < h * t) dragOverZone.value = 'top'
  else if (y > h * (1 - t)) dragOverZone.value = 'bottom'
  else dragOverZone.value = 'center'
}

function onPaneDragLeave(): void { dragOverZone.value = null }

function onPaneDrop(e: DragEvent, targetPaneId: string): void {
  e.preventDefault()
  const draggedId = e.dataTransfer?.getData('application/x-orchestrix-terminal')
  const zone = dragOverZone.value
  dragOverZone.value = null
  if (!draggedId || draggedId === targetPaneId || !zone) return

  if (zone === 'center') return // 不合并终端（一个项目一个 shell）
  const dir = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical'
  const pos = (zone === 'left' || zone === 'top') ? 'before' : 'after'
  uiStore.splitTerminal(targetPaneId, draggedId, dir as any, pos as any)
}
</script>

<template>
  <!-- 叶节点：单个终端面板 -->
  <div v-if="node.type === 'leaf'" class="term-leaf">
    <div
      v-if="getPane(node.paneId)"
      class="term-pane-wrapper"
      :class="{ active: uiStore.activePaneId === node.paneId }"
      @click="handlePaneClick(node.paneId)"
      @dragover="onPaneDragOver"
      @dragleave="onPaneDragLeave"
      @drop="onPaneDrop($event, node.paneId)"
    >
      <div
        class="term-pane-header"
        draggable="true"
        @dragstart="onHeaderDragStart($event, node.paneId)"
        @contextmenu="onHeaderContext($event, node.paneId)"
      >
        <span class="term-pane-title">{{ getPane(node.paneId)?.title }}</span>
      </div>
      <div class="term-pane-body">
        <TerminalPane
          ref="terminalPaneRef"
          :key="getPane(node.paneId)!.terminalId"
          :terminal-id="getPane(node.paneId)!.terminalId"
          :cwd="getPane(node.paneId)!.projectPath ?? undefined"
        />
      </div>
      <!-- 拖拽指示器 -->
      <div v-if="dragOverZone" class="term-drop-indicator" :class="dragOverZone" />
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="term-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div class="term-ctx-item" @click="restartShell">Restart Shell</div>
        <div class="term-ctx-item" @click="clearShell">Clear</div>
      </div>
    </Teleport>
  </div>

  <!-- 分栏节点 -->
  <div
    v-else
    class="term-split"
    :class="[node.direction, { dragging: isDragging }]"
  >
    <template v-for="(child, index) in node.children" :key="child.type === 'leaf' ? child.paneId : 'split-' + index">
      <div
        v-if="index > 0"
        class="term-split-handle"
        :class="node.direction"
        @mousedown="startResize($event, index - 1)"
      />
      <div
        class="term-split-child"
        :style="{
          [node.direction === 'horizontal' ? 'width' : 'height']: node.sizes[index] + '%',
          [node.direction === 'horizontal' ? 'height' : 'width']: '100%'
        }"
      >
        <TerminalSplitContainer :node="child" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.term-leaf { width: 100%; height: 100%; overflow: hidden; }

.term-pane-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid transparent;
  position: relative;
  transition: border-color 0.15s;
}
.term-pane-wrapper.active { border-color: #89b4fa; }

.term-pane-header {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
  cursor: grab;
}
.term-pane-title {
  font-size: 12px;
  color: #a6adc8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.term-pane-body { flex: 1; overflow: hidden; min-height: 0; }

/* 拖拽指示器 */
.term-drop-indicator {
  position: absolute; pointer-events: none;
  background: rgba(137, 180, 250, 0.15);
  border: 2px solid rgba(137, 180, 250, 0.5);
  border-radius: 4px;
  transition: all 0.1s;
  z-index: 10;
}
.term-drop-indicator.left   { top: 0; left: 0; width: 50%; height: 100%; }
.term-drop-indicator.right  { top: 0; right: 0; width: 50%; height: 100%; }
.term-drop-indicator.top    { top: 0; left: 0; width: 100%; height: 50%; }
.term-drop-indicator.bottom { bottom: 0; left: 0; width: 100%; height: 50%; }
.term-drop-indicator.center { top: 4px; left: 4px; right: 4px; bottom: 4px; }

/* 分栏 */
.term-split {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.term-split.horizontal { flex-direction: row; }
.term-split.vertical { flex-direction: column; }
.term-split.dragging { user-select: none; }

.term-split-child { overflow: hidden; min-width: 0; min-height: 0; }

.term-split-handle {
  flex-shrink: 0;
  background: #313244;
  transition: background 0.15s;
  z-index: 10;
}
.term-split-handle.horizontal { width: 4px; cursor: col-resize; }
.term-split-handle.vertical { height: 4px; cursor: row-resize; }
.term-split-handle:hover { background: #89b4fa; }

/* 右键菜单 */
.term-context-menu {
  position: fixed; z-index: 9999; background: #313244; border: 1px solid #45475a;
  border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.term-ctx-item { padding: 6px 16px; font-size: 13px; color: #cdd6f4; cursor: pointer; }
.term-ctx-item:hover { background: rgba(137, 180, 250, 0.15); }
</style>
