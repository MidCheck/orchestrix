<script setup lang="ts">
import EditorTabs from './EditorTabs.vue'
import CodeEditor from './CodeEditor.vue'
import { useEditorStore } from '../../stores/editor'

const editorStore = useEditorStore()
</script>

<template>
  <div class="editor-pane">
    <EditorTabs />
    <div class="editor-body">
      <CodeEditor />
    </div>
    <!-- 状态栏 -->
    <div v-if="editorStore.activeFile" class="status-bar">
      <span class="status-item">{{ editorStore.activeFile.language }}</span>
      <span class="status-item">{{ editorStore.activeFile.path }}</span>
      <span v-if="editorStore.isModified" class="status-item modified">Modified</span>
      <span class="status-item save-hint">Cmd+S to save</span>
    </div>
  </div>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.editor-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 24px;
  padding: 0 12px;
  background: #181825;
  border-top: 1px solid #313244;
  font-size: 11px;
  color: #6c7086;
  flex-shrink: 0;
}

.status-item.modified {
  color: #f9e2af;
}

.save-hint {
  margin-left: auto;
}
</style>
