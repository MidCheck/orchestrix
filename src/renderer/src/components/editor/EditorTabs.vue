<script setup lang="ts">
import { useEditorStore } from '../../stores/editor'

const editorStore = useEditorStore()

function isModified(path: string): boolean {
  const file = editorStore.openFiles.find((f) => f.path === path)
  return file ? file.content !== file.savedContent : false
}
</script>

<template>
  <div v-if="editorStore.openFiles.length > 0" class="editor-tabs">
    <div
      v-for="file in editorStore.openFiles"
      :key="file.path"
      class="tab"
      :class="{ active: editorStore.activeFilePath === file.path }"
      @click="editorStore.setActive(file.path)"
    >
      <span class="tab-name">
        <span v-if="isModified(file.path)" class="modified-dot" />
        {{ file.name }}
      </span>
      <button class="tab-close" @click.stop="editorStore.closeFile(file.path)">x</button>
    </div>
  </div>
</template>

<style scoped>
.editor-tabs {
  display: flex;
  align-items: center;
  height: 32px;
  background: #181825;
  border-bottom: 1px solid #313244;
  overflow-x: auto;
  flex-shrink: 0;
}

.editor-tabs::-webkit-scrollbar {
  height: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 12px;
  font-size: 12px;
  color: #6c7086;
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid #313244;
  user-select: none;
}

.tab:hover {
  color: #a6adc8;
  background: rgba(255, 255, 255, 0.04);
}

.tab.active {
  color: #cdd6f4;
  background: #1e1e2e;
  border-bottom: 2px solid #89b4fa;
}

.tab-name {
  display: flex;
  align-items: center;
  gap: 4px;
}

.modified-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f9e2af;
  flex-shrink: 0;
}

.tab-close {
  background: none;
  border: none;
  color: #6c7086;
  cursor: pointer;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0;
}

.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f38ba8;
}
</style>
