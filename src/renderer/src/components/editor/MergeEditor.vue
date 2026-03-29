<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { EditorView, keymap, lineNumbers, highlightSpecialChars, drawSelection, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{
  filePath: string
  onComplete: () => void
}>()

const editorStore = useEditorStore()
const workspaceStore = useWorkspaceStore()

// 三向合并数据
const baseContent = ref('')
const input1Content = ref('')   // ours (current)
const input2Content = ref('')   // theirs (incoming)
const resultContent = ref('')

const input1Ref = ref<HTMLElement | null>(null)
const input2Ref = ref<HTMLElement | null>(null)
const resultRef = ref<HTMLElement | null>(null)

let input1View: EditorView | null = null
let input2View: EditorView | null = null
let resultView: EditorView | null = null

// 冲突
interface MergeConflict {
  index: number
  resolved: boolean
  // 在 result 中的内容
  currentText: string
  incomingText: string
  baseText: string
  // result 中的行范围 (会随编辑变化，初始化时计算)
  resultStartLine: number
  resultEndLine: number
}

const conflicts = ref<MergeConflict[]>([])
const unresolvedCount = computed(() => conflicts.value.filter(c => !c.resolved).length)

// 分栏比例
const topHeight = ref(50)
const isDragging = ref(false)

// 解析文件中的冲突标记
function parseConflicts(content: string): void {
  const lines = content.split('\n')
  const result: MergeConflict[] = []
  const resultLines: string[] = []
  let i = 0
  let resultLineNum = 0

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const currentLabel = lines[i].substring(7).trim()
      const currentLines: string[] = []
      const incomingLines: string[] = []
      let phase: 'current' | 'incoming' = 'current'
      i++

      while (i < lines.length) {
        if (lines[i].startsWith('=======')) {
          phase = 'incoming'
          i++
          continue
        }
        if (lines[i].startsWith('>>>>>>>')) {
          break
        }
        if (phase === 'current') currentLines.push(lines[i])
        else incomingLines.push(lines[i])
        i++
      }

      const startLine = resultLineNum + 1
      // 默认结果：放入冲突标记供用户编辑
      const conflictText = currentLines.join('\n')
      for (const cl of currentLines) {
        resultLines.push(cl)
        resultLineNum++
      }
      const endLine = resultLineNum

      result.push({
        index: result.length,
        resolved: false,
        currentText: currentLines.join('\n'),
        incomingText: incomingLines.join('\n'),
        baseText: '',
        resultStartLine: startLine,
        resultEndLine: endLine
      })

      i++ // skip >>>>>>>
    } else {
      resultLines.push(lines[i])
      resultLineNum++
      i++
    }
  }

  conflicts.value = result
  resultContent.value = resultLines.join('\n')
  input1Content.value = result.map(c => c.currentText).join('\n---\n') || '(no conflicts)'
  input2Content.value = result.map(c => c.incomingText).join('\n---\n') || '(no conflicts)'
}

function baseExtensions(readOnly: boolean = false) {
  const exts = [
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: '13px' }
    })
  ]
  if (readOnly) {
    exts.push(EditorState.readOnly.of(true))
  } else {
    exts.push(history(), keymap.of([...defaultKeymap, ...historyKeymap]))
  }
  return exts
}

function acceptConflict(index: number, action: 'current' | 'incoming' | 'both' | 'ignore'): void {
  const conflict = conflicts.value[index]
  if (!conflict || !resultView) return

  let replacement: string
  if (action === 'current') replacement = conflict.currentText
  else if (action === 'incoming') replacement = conflict.incomingText
  else if (action === 'both') replacement = conflict.currentText + '\n' + conflict.incomingText
  else replacement = '' // ignore: 清空

  // 在 result 编辑器中替换对应区域
  // 注意：行号可能因之前的编辑而变化，所以我们用搜索来定位
  const doc = resultView.state.doc
  const currentResultText = doc.toString()
  const conflictCurrentText = conflict.currentText

  // 找到 conflict 的 currentText 在 result 中的位置
  const idx = currentResultText.indexOf(conflictCurrentText)
  if (idx !== -1) {
    resultView.dispatch({
      changes: { from: idx, to: idx + conflictCurrentText.length, insert: replacement }
    })
  }

  conflict.resolved = true
  resultContent.value = resultView.state.doc.toString()
}

async function completeMerge(): Promise<void> {
  if (!resultView) return
  const finalContent = resultView.state.doc.toString()

  // 写回文件
  await window.electronAPI.workspace.writeFile(props.filePath, finalContent)

  // 更新 editor store 中的文件内容
  editorStore.updateContent(props.filePath, finalContent)

  props.onComplete()
}

function startResize(e: MouseEvent): void {
  isDragging.value = true
  const startY = e.clientY
  const startHeight = topHeight.value

  const onMove = (me: MouseEvent): void => {
    const container = (e.target as HTMLElement).closest('.merge-editor')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const delta = ((me.clientY - startY) / rect.height) * 100
    topHeight.value = Math.max(20, Math.min(80, startHeight + delta))
  }

  const onUp = (): void => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

onMounted(async () => {
  // 读取文件内容并解析冲突
  const file = editorStore.getFileByPath(props.filePath)
  if (!file) return

  parseConflicts(file.content)

  await nextTick()

  // 创建三个编辑器
  if (input1Ref.value) {
    input1View = new EditorView({
      state: EditorState.create({ doc: input1Content.value, extensions: baseExtensions(true) }),
      parent: input1Ref.value
    })
  }

  if (input2Ref.value) {
    input2View = new EditorView({
      state: EditorState.create({ doc: input2Content.value, extensions: baseExtensions(true) }),
      parent: input2Ref.value
    })
  }

  if (resultRef.value) {
    resultView = new EditorView({
      state: EditorState.create({
        doc: resultContent.value,
        extensions: [
          ...baseExtensions(false),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              resultContent.value = update.state.doc.toString()
            }
          })
        ]
      }),
      parent: resultRef.value
    })
  }
})

onBeforeUnmount(() => {
  input1View?.destroy()
  input2View?.destroy()
  resultView?.destroy()
})
</script>

<template>
  <div class="merge-editor">
    <!-- 工具栏 -->
    <div class="merge-toolbar">
      <span class="merge-title">Merge Conflicts</span>
      <span class="merge-file">{{ filePath.split('/').pop() }}</span>
      <span class="conflict-counter" :class="{ clear: unresolvedCount === 0 }">
        {{ unresolvedCount }} conflict{{ unresolvedCount !== 1 ? 's' : '' }} remaining
      </span>
      <div class="merge-toolbar-spacer" />
      <button
        class="complete-btn"
        :disabled="unresolvedCount > 0"
        @click="completeMerge"
      >
        Complete Merge
      </button>
    </div>

    <!-- 上部：Input 1 (Current) | Input 2 (Incoming) -->
    <div class="merge-top" :style="{ height: topHeight + '%' }">
      <div class="merge-pane">
        <div class="pane-label current">Current Changes (Ours)</div>
        <div ref="input1Ref" class="merge-cm" />
      </div>
      <div class="merge-pane">
        <div class="pane-label incoming">Incoming Changes (Theirs)</div>
        <div ref="input2Ref" class="merge-cm" />
      </div>
    </div>

    <!-- 分割线 -->
    <div class="merge-splitter" @mousedown="startResize" />

    <!-- 下部：Result -->
    <div class="merge-bottom" :style="{ height: (100 - topHeight) + '%' }">
      <!-- 冲突操作栏 -->
      <div class="conflict-actions-bar">
        <div class="pane-label result">Result</div>
        <div class="conflict-btns">
          <template v-for="(c, i) in conflicts" :key="i">
            <div v-if="!c.resolved" class="conflict-btn-group">
              <span class="conflict-label">#{{ i + 1 }}</span>
              <button class="cbtn current" @click="acceptConflict(i, 'current')">Current</button>
              <button class="cbtn incoming" @click="acceptConflict(i, 'incoming')">Incoming</button>
              <button class="cbtn both" @click="acceptConflict(i, 'both')">Both</button>
              <button class="cbtn ignore" @click="acceptConflict(i, 'ignore')">Ignore</button>
            </div>
            <div v-else class="conflict-resolved">#{{ i + 1 }} resolved</div>
          </template>
        </div>
      </div>
      <div ref="resultRef" class="merge-cm" />
    </div>
  </div>
</template>

<style scoped>
.merge-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1e1e2e;
  overflow: hidden;
}

.merge-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 32px;
  padding: 0 12px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

.merge-title { color: #f9e2af; font-weight: 600; font-size: 12px; }
.merge-file { color: #a6adc8; font-size: 12px; }
.conflict-counter { color: #f38ba8; font-size: 11px; font-weight: 600; }
.conflict-counter.clear { color: #a6e3a1; }
.merge-toolbar-spacer { flex: 1; }

.complete-btn {
  background: #a6e3a1; border: none; color: #1e1e2e;
  padding: 4px 16px; border-radius: 4px; cursor: pointer;
  font-size: 12px; font-weight: 600;
}
.complete-btn:disabled { background: #45475a; color: #6c7086; cursor: not-allowed; }
.complete-btn:not(:disabled):hover { background: #b8f0b3; }

.merge-top {
  display: flex;
  flex-direction: row;
  overflow: hidden;
  flex-shrink: 0;
}

.merge-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  border-right: 1px solid #313244;
}
.merge-pane:last-child { border-right: none; }

.pane-label {
  height: 24px;
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  border-bottom: 1px solid #313244;
}
.pane-label.current { color: #a6e3a1; background: rgba(166, 227, 161, 0.08); }
.pane-label.incoming { color: #89b4fa; background: rgba(137, 180, 250, 0.08); }
.pane-label.result { color: #f9e2af; background: rgba(249, 226, 175, 0.08); }

.merge-cm { flex: 1; overflow: hidden; min-height: 0; }
.merge-cm :deep(.cm-editor) { height: 100%; }

.merge-splitter {
  height: 5px;
  background: #313244;
  cursor: row-resize;
  flex-shrink: 0;
}
.merge-splitter:hover { background: #89b4fa; }

.merge-bottom {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conflict-actions-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
  overflow-x: auto;
}

.conflict-btns {
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  flex-shrink: 0;
}

.conflict-btn-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid #45475a;
  border-radius: 4px;
}

.conflict-label { color: #f38ba8; font-size: 10px; font-weight: 700; }

.cbtn {
  background: none; border: none; cursor: pointer;
  font-size: 10px; padding: 2px 6px; border-radius: 3px;
}
.cbtn.current { color: #a6e3a1; }
.cbtn.incoming { color: #89b4fa; }
.cbtn.both { color: #f9e2af; }
.cbtn.ignore { color: #6c7086; }
.cbtn:hover { background: rgba(255, 255, 255, 0.1); }

.conflict-resolved {
  font-size: 10px; color: #a6e3a1; padding: 2px 6px;
  border: 1px solid #a6e3a1; border-radius: 4px; opacity: 0.5;
}
</style>
