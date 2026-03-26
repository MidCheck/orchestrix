<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LayoutNode } from '../../stores/editor'
import EditorGroupView from './EditorGroupView.vue'

const props = defineProps<{ node: LayoutNode }>()

const isDragging = ref(false)

function startResize(e: MouseEvent, index: number): void {
  if (props.node.type !== 'split') return
  const node = props.node
  isDragging.value = true

  const container = (e.target as HTMLElement).parentElement!
  const rect = container.getBoundingClientRect()
  const isHorizontal = node.direction === 'horizontal'
  const totalSize = isHorizontal ? rect.width : rect.height
  const startPos = isHorizontal ? e.clientX : e.clientY
  const startSizes = [...node.sizes]

  const onMove = (me: MouseEvent): void => {
    const currentPos = isHorizontal ? me.clientX : me.clientY
    const delta = ((currentPos - startPos) / totalSize) * 100

    const newA = Math.max(15, startSizes[index] + delta)
    const newB = Math.max(15, startSizes[index + 1] - delta)
    const sum = startSizes[index] + startSizes[index + 1]

    node.sizes[index] = (newA / (newA + newB)) * sum
    node.sizes[index + 1] = (newB / (newA + newB)) * sum
  }

  const onUp = (): void => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div v-if="node.type === 'leaf'" class="split-leaf">
    <EditorGroupView :group-id="node.groupId" />
  </div>

  <div
    v-else
    class="split-container"
    :class="[node.direction, { dragging: isDragging }]"
  >
    <template v-for="(child, index) in node.children" :key="index">
      <!-- 分割线 -->
      <div
        v-if="index > 0"
        class="split-handle"
        :class="node.direction"
        @mousedown="startResize($event, index - 1)"
      />
      <!-- 子节点 -->
      <div
        class="split-child"
        :style="{
          [node.direction === 'horizontal' ? 'width' : 'height']: node.sizes[index] + '%',
          [node.direction === 'horizontal' ? 'height' : 'width']: '100%'
        }"
      >
        <EditorSplitContainer :node="child" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.split-leaf {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.split-container {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.split-container.horizontal { flex-direction: row; }
.split-container.vertical { flex-direction: column; }

.split-container.dragging { user-select: none; }

.split-child {
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.split-handle {
  flex-shrink: 0;
  background: #313244;
  transition: background 0.15s;
  z-index: 10;
}

.split-handle.horizontal {
  width: 4px;
  cursor: col-resize;
}

.split-handle.vertical {
  height: 4px;
  cursor: row-resize;
}

.split-handle:hover {
  background: #89b4fa;
}
</style>
