<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { vue } from '@codemirror/lang-vue'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { useEditorStore } from '../../stores/editor'

const editorStore = useEditorStore()
const containerRef = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null
let currentFilePath: string | null = null

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'javascript': return javascript()
    case 'typescript': return javascript({ typescript: true })
    case 'json': return json()
    case 'html': return html()
    case 'css': return css()
    case 'vue': return vue()
    case 'python': return python()
    case 'markdown': return markdown()
    default: return []
  }
}

// 保存当前文件的光标和滚动状态
function saveCurrentState(): void {
  if (!editorView || !currentFilePath) return
  const sel = editorView.state.selection.main
  const scrollDOM = editorView.scrollDOM
  editorStore.saveCursorState(currentFilePath, {
    anchor: sel.anchor,
    head: sel.head,
    scrollTop: scrollDOM.scrollTop,
    scrollLeft: scrollDOM.scrollLeft
  })
}

function createEditor(content: string, language: string, filePath: string): void {
  if (!containerRef.value) return

  // 先保存旧文件的状态
  saveCurrentState()
  destroyEditor()

  currentFilePath = filePath

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: 'Mod-s',
        run: () => {
          editorStore.saveFile()
          return true
        }
      }
    ]),
    getLanguageExtension(language),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && currentFilePath) {
        editorStore.updateContent(currentFilePath, update.state.doc.toString())
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: '13px' }
    })
  ]

  // 恢复光标位置
  const saved = editorStore.getCursorState(filePath)
  const selection = saved
    ? { anchor: Math.min(saved.anchor, content.length), head: Math.min(saved.head, content.length) }
    : undefined

  editorView = new EditorView({
    state: EditorState.create({ doc: content, extensions, selection }),
    parent: containerRef.value
  })

  // 恢复滚动位置
  if (saved) {
    requestAnimationFrame(() => {
      if (editorView) {
        editorView.scrollDOM.scrollTop = saved.scrollTop
        editorView.scrollDOM.scrollLeft = saved.scrollLeft
      }
    })
  }

  // 聚焦编辑器
  editorView.focus()
}

function destroyEditor(): void {
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
  currentFilePath = null
}

watch(
  () => editorStore.activeFile,
  async (file) => {
    await nextTick()
    if (file && file.path !== currentFilePath) {
      createEditor(file.content, file.language, file.path)
    } else if (!file) {
      saveCurrentState()
      destroyEditor()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  saveCurrentState()
  destroyEditor()
})
</script>

<template>
  <div class="code-editor">
    <div v-if="editorStore.activeFile" ref="containerRef" class="editor-container" />
    <div v-else class="editor-empty">
      <p>No file open</p>
      <p class="hint">Click a file in the sidebar to open it</p>
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #282c34;
}

.editor-container {
  width: 100%;
  height: 100%;
}

.editor-container :deep(.cm-editor) {
  height: 100%;
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6c7086;
  gap: 8px;
}

.hint {
  font-size: 12px;
  color: #45475a;
}
</style>
