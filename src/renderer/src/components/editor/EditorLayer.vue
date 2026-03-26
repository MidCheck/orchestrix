<script setup lang="ts">
import { useEditorStore } from '../../stores/editor'
import { useUIStore } from '../../stores/ui'
import EditorSplitContainer from './EditorSplitContainer.vue'

const editorStore = useEditorStore()
const uiStore = useUIStore()
</script>

<template>
  <div class="editor-layer-root">
    <!-- 有布局时渲染分栏编辑器 -->
    <EditorSplitContainer v-if="editorStore.layoutRoot" :node="editorStore.layoutRoot" />

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <p>No files open</p>
      <p class="hint">Click a file in the sidebar to start editing</p>
      <button class="back-btn" @click="uiStore.switchToTerminal()">◀ Back to Terminal</button>
    </div>
  </div>
</template>

<style scoped>
.editor-layer-root {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6c7086;
  gap: 12px;
}

.hint {
  font-size: 12px;
  color: #45475a;
}

.back-btn {
  background: none;
  border: 1px solid #45475a;
  color: #a6adc8;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  margin-top: 8px;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #a6e3a1;
  border-color: #a6e3a1;
}
</style>
