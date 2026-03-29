<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, computed } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { vue } from '@codemirror/lang-vue'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { StreamLanguage } from '@codemirror/language'
import { clike } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { sql as sqlMode } from '@codemirror/legacy-modes/mode/sql'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { gitGutterExtensions, updateGutterChanges, type GutterChange } from '../../composables/useGitGutter'
import MediaPreview from './MediaPreview.vue'
import HexEditor from './HexEditor.vue'
import MergeEditor from './MergeEditor.vue'
import { mergeConflictExtensions, updateConflicts, resolveConflict, detectConflicts, type ConflictRegion } from '../../composables/useMergeConflict'
import type { GitBlameLine } from '@shared/types'

const props = defineProps<{ groupId: string }>()

const editorStore = useEditorStore()
const workspaceStore = useWorkspaceStore()
const containerRef = ref<HTMLElement | null>(null)
const diffLeftRef = ref<HTMLElement | null>(null)
const diffRightRef = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null
let diffLeftView: EditorView | null = null
let diffRightView: EditorView | null = null
let currentFilePath: string | null = null
let isLocalEdit = false // 防止同步循环
const diffMode = ref(false)
const diffSplit = ref(50) // 左侧百分比
const mergeMode = ref(false) // 三向合并编辑器模式
const hasConflicts = ref(false) // 当前文件是否有合并冲突

// Blame 数据 + 当前光标所在行的 inline blame
const blameData = ref<GitBlameLine[]>([])
const inlineBlame = ref<{ line: number; text: string } | null>(null)

// VS Code 风格的 change 对象（同时记录原始和修改后的行范围）
interface LineChange {
  originalStartLine: number  // 1-based, 0 = pure insertion
  originalEndLine: number    // 1-based, 0 = pure insertion
  modifiedStartLine: number  // 1-based, 0 = pure deletion
  modifiedEndLine: number    // 1-based, 0 = pure deletion
}

// Diff hunk inline view
interface DiffHunkView {
  changeIndex: number
  change: LineChange
  oldLines: Array<{ num: number; text: string; type: 'deleted' | 'context' }>
  newLines: Array<{ num: number; text: string; type: 'added' | 'context' }>
  top: number
}
const diffHunkView = ref<DiffHunkView | null>(null)
const diffChanges = ref<LineChange[]>([])

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

function getLang(lang: string) {
  switch (lang) {
    case 'javascript': return javascript()
    case 'typescript': return javascript({ typescript: true })
    case 'json': return json()
    case 'html': return html()
    case 'css': return css()
    case 'vue': return vue()
    case 'python': return python()
    case 'markdown': return markdown()
    case 'c': return StreamLanguage.define(clike({ name: 'c' }))
    case 'cpp': return StreamLanguage.define(clike({ name: 'c++' }))
    case 'java': return StreamLanguage.define(clike({ name: 'java' }))
    case 'csharp': return StreamLanguage.define(clike({ name: 'csharp' }))
    case 'kotlin': return StreamLanguage.define(clike({ name: 'kotlin' }))
    case 'objectivec': return StreamLanguage.define(clike({ name: 'objective-c' }))
    case 'shell': return StreamLanguage.define(shell)
    case 'yaml': return StreamLanguage.define(yaml)
    case 'go': return StreamLanguage.define(go)
    case 'rust': return StreamLanguage.define(rust)
    case 'ruby': return StreamLanguage.define(ruby)
    case 'swift': return StreamLanguage.define(swift)
    case 'toml': return StreamLanguage.define(toml)
    case 'dockerfile': return StreamLanguage.define(dockerFile)
    case 'sql': return StreamLanguage.define(sqlMode)
    case 'lua': return StreamLanguage.define(lua)
    case 'perl': return StreamLanguage.define(perl)
    case 'powershell': return StreamLanguage.define(powerShell)
    case 'cmake': return StreamLanguage.define(cmake)
    default: return []
  }
}

// HEAD 文件内容缓存
let headContent = ''
let headLines: string[] = []
let diffUpdateTimer: ReturnType<typeof setTimeout> | null = null

async function loadGitData(filePath: string): Promise<void> {
  const project = workspaceStore.activeProject
  if (!project) return
  try {
    const isGit = await window.electronAPI.workspace.isGitRepo(project.path)
    if (!isGit || !editorView) return

    const [hunks, blame, head] = await Promise.all([
      window.electronAPI.workspace.gitDiffLines(project.path, filePath),
      window.electronAPI.workspace.gitBlame(project.path, filePath),
      window.electronAPI.workspace.gitShow(project.path, filePath)
    ])

    if (!editorView || currentFilePath !== filePath) return

    headContent = head
    headLines = head.split('\n')
    blameData.value = blame
    // 用内存比较计算初始 diff（比 git diff 更准确，因为文件可能有未保存的编辑）
    recomputeDiffMarks()
  } catch {
    blameData.value = []
    diffHunksData.value = []
    headContent = ''
    headLines = []
  }
}

// 光标移动 → 更新行尾 inline blame
function setupCursorBlame(): void {
  if (!editorView) return
  // 用 updateListener 监听光标变化
  // 已在 createEditor 的 extensions 中注册
}

function updateInlineBlame(): void {
  if (!editorView || blameData.value.length === 0) {
    inlineBlame.value = null
    return
  }
  const sel = editorView.state.selection.main
  const line = editorView.state.doc.lineAt(sel.head)
  const lineNum = line.number
  const blame = blameData.value.find((b) => b.line === lineNum)
  if (!blame) { inlineBlame.value = null; return }

  const isUncommitted = blame.hash.startsWith('0000000')
  if (isUncommitted) {
    inlineBlame.value = { line: lineNum, text: 'Uncommitted' }
  } else {
    const ago = formatTimeAgo(blame.date)
    inlineBlame.value = { line: lineNum, text: `${blame.author}, ${ago}` }
  }
}

function formatTimeAgo(isoDate: string): string {
  const d = new Date(isoDate)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// 计算 inline blame 的像素位置
const inlineBlameStyle = computed(() => {
  if (!inlineBlame.value || !editorView) return null
  const lineNum = inlineBlame.value.line
  try {
    const line = editorView.state.doc.line(lineNum)
    const block = editorView.lineBlockAt(line.from)
    const scrollTop = editorView.scrollDOM.scrollTop
    return { top: (block.top - scrollTop) + 'px' }
  } catch {
    return null
  }
})

// 点击编辑器区域
function handleEditorClick(e: MouseEvent): void {
  const target = e.target as HTMLElement

  // 点击合并冲突的内联按钮（Accept Current / Incoming / Both / Compare）
  if (target.classList.contains('conflict-action') && editorView) {
    e.stopPropagation()
    const idx = parseInt(target.dataset.conflictIndex || '', 10)
    const action = target.dataset.conflictAction as 'current' | 'incoming' | 'both' | 'compare'
    if (isNaN(idx)) return

    const regions = detectConflicts(editorView.state.doc.toString())
    if (idx >= regions.length) return

    if (action === 'compare') {
      mergeMode.value = true
    } else {
      resolveConflict(editorView, editorView.state.doc.toString(), regions[idx], action)
      requestAnimationFrame(() => {
        if (!editorView) return
        const newContent = editorView.state.doc.toString()
        const newRegions = detectConflicts(newContent)
        hasConflicts.value = newRegions.length > 0
        updateConflicts(editorView, newRegions)
        if (currentFilePath) {
          editorStore.updateContent(currentFilePath, newContent)
        }
      })
    }
    return
  }

  // 点击 gutter 颜色条/红三角 → 显示 inline diff 弹窗
  if (target.closest('.cm-git-diff-gutter') && editorView) {
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect()
    const y = e.clientY - scrollerRect.top + editorView.scrollDOM.scrollTop
    try {
      const block = editorView.lineBlockAtHeight(y)
      const line = editorView.state.doc.lineAt(block.from)
      const lineNum = line.number
      const currentLines = editorView.state.doc.toString().split('\n')

      // 找到包含该行的 change（支持 added / modified / deleted 三种）
      const changeIdx = diffChanges.value.findIndex((c) => {
        if (c.modifiedStartLine > 0 && c.modifiedEndLine > 0) {
          // added 或 modified：行在 modified 范围内
          return lineNum >= c.modifiedStartLine && lineNum <= c.modifiedEndLine
        }
        // deleted：红三角标记在 anchor+1 行
        const rawAnchor = (c as any)._deleteAnchor ?? 0
        const anchorLine = Math.max(1, Math.min(rawAnchor + 1, currentLines.length))
        return lineNum === anchorLine
      })
      if (changeIdx === -1) return

      // toggle
      if (diffHunkView.value?.changeIndex === changeIdx) {
        diffHunkView.value = null
        return
      }

      const change = diffChanges.value[changeIdx]

      // 提取 HEAD 中对应的原始行（deleted 和 modified 有内容，added 无）
      const oldLines: Array<{ num: number; text: string; type: 'deleted' | 'context' }> = []
      if (change.originalStartLine > 0 && headLines.length > 0) {
        for (let i = change.originalStartLine - 1; i <= change.originalEndLine - 1 && i < headLines.length; i++) {
          oldLines.push({ num: i + 1, text: headLines[i], type: 'deleted' })
        }
      }

      // 提取 modified 中对应的新行（added 和 modified 有内容，deleted 无）
      const newLines: Array<{ num: number; text: string; type: 'added' | 'context' }> = []
      if (change.modifiedStartLine > 0 && change.modifiedEndLine > 0) {
        for (let i = change.modifiedStartLine - 1; i <= change.modifiedEndLine - 1 && i < currentLines.length; i++) {
          newLines.push({ num: i + 1, text: currentLines[i], type: 'added' })
        }
      }

      // 计算弹窗位置
      const anchorLineNum = change.modifiedStartLine > 0
        ? change.modifiedStartLine
        : Math.max(1, Math.min(((change as any)._deleteAnchor ?? 0) + 1, editorView.state.doc.lines))
      const anchorDocLine = editorView.state.doc.line(anchorLineNum)
      const topPx = editorView.lineBlockAt(anchorDocLine.from).top - editorView.scrollDOM.scrollTop

      diffHunkView.value = {
        changeIndex: changeIdx,
        change,
        oldLines,
        newLines,
        top: topPx
      }
      return
    } catch { /* ignore */ }
  }

  // 点击其他区域关闭
  if (!target.closest('.diff-hunk-inline')) {
    diffHunkView.value = null
  }
}

// 基于 LCS 计算 LineChange 数组（类似 VS Code 的 IChange）
function computeLineChanges(origLines: string[], modLines: string[]): LineChange[] {
  const m = origLines.length, n = modLines.length
  if (m > 3000 || n > 3000) return []

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = origLines[i - 1] === modLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // 回溯生成编辑操作序列
  const ops: Array<{ type: 'equal' | 'delete' | 'insert'; origIdx: number; modIdx: number }> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      ops.push({ type: 'equal', origIdx: i, modIdx: j })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', origIdx: i, modIdx: j })
      j--
    } else {
      ops.push({ type: 'delete', origIdx: i, modIdx: j })
      i--
    }
  }
  ops.reverse()

  // 将连续的 delete/insert 合并为 LineChange
  const changes: LineChange[] = []
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].type === 'equal') { idx++; continue }
    let origStart = 0, origEnd = 0, modStart = 0, modEnd = 0
    let deleteModPos = 0 // 删除发生时 modified 的位置
    // 收集连续的 delete
    while (idx < ops.length && ops[idx].type === 'delete') {
      if (!origStart) origStart = ops[idx].origIdx
      origEnd = ops[idx].origIdx
      deleteModPos = ops[idx].modIdx // modIdx = 删除发生在 modified 第几行之后
      idx++
    }
    // 收集连续的 insert
    while (idx < ops.length && ops[idx].type === 'insert') {
      if (!modStart) modStart = ops[idx].modIdx
      modEnd = ops[idx].modIdx
      idx++
    }
    // 纯删除时用 deleteModPos 作为锚点位置
    const change: LineChange = {
      originalStartLine: origStart,
      originalEndLine: origEnd,
      modifiedStartLine: modStart,
      modifiedEndLine: modEnd
    }
    // 记录删除锚点（在 modified 文件中的行号，红三角标记在此行）
    if (modStart === 0 && deleteModPos > 0) {
      (change as any)._deleteAnchor = deleteModPos
    }
    changes.push(change)
  }
  return changes
}

// 重算 diff 标记
function recomputeDiffMarks(): void {
  if (!editorView || headLines.length === 0) {
    diffChanges.value = []
    if (editorView) updateGutterChanges(editorView, [])
    return
  }

  const currentLines = editorView.state.doc.toString().split('\n')
  const changes = computeLineChanges(headLines, currentLines)
  diffChanges.value = changes

  // 转换为 GutterChange（绿=added, 蓝=modified, 红三角=deleted）
  const gutterChanges: GutterChange[] = []
  for (const c of changes) {
    if (c.originalStartLine === 0 && c.modifiedStartLine > 0) {
      // 纯新增
      gutterChanges.push({ type: 'added', modifiedStartLine: c.modifiedStartLine, modifiedEndLine: c.modifiedEndLine })
    } else if (c.modifiedStartLine === 0 && c.originalStartLine > 0) {
      // 纯删除 — 红三角标记在删除点之后的行顶部
      const rawAnchor = (c as any)._deleteAnchor ?? 0
      // anchor+1 = 删除点后面的第一行；anchor=0 时用 line 1
      const anchorLine = Math.max(1, Math.min(rawAnchor + 1, currentLines.length))
      gutterChanges.push({ type: 'deleted', modifiedStartLine: anchorLine, modifiedEndLine: 0 })
    } else if (c.modifiedStartLine > 0) {
      // 修改
      gutterChanges.push({ type: 'modified', modifiedStartLine: c.modifiedStartLine, modifiedEndLine: c.modifiedEndLine })
    }
  }
  updateGutterChanges(editorView, gutterChanges)
}

// 节流的 diff 重算（编辑时不要每次按键都算）
function scheduleDiffUpdate(): void {
  if (diffUpdateTimer) clearTimeout(diffUpdateTimer)
  diffUpdateTimer = setTimeout(() => recomputeDiffMarks(), 300)
}

// VS Code 风格 revert：重建文件内容，保留所有其他变更，只还原被点击的那个 change
function revertHunk(): void {
  if (!diffHunkView.value || !editorView) return
  const revertIndex = diffHunkView.value.changeIndex
  const allChanges = diffChanges.value
  const currentLines = editorView.state.doc.toString().split('\n')

  // applyLineChanges: 用原始内容 + 修改内容 + 要保留的变更列表，重建文件
  // 保留的变更 = 除了 revertIndex 以外的所有变更
  const changesToKeep = allChanges.filter((_, i) => i !== revertIndex)
  const result = applyLineChanges(headLines, currentLines, changesToKeep)

  // 替换整个编辑器内容
  const newContent = result.join('\n')
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: newContent }
  })

  diffHunkView.value = null
}

// 类似 VS Code staging.ts 的 applyLineChanges：
// 从 original 出发，应用 changesToKeep 中记录的修改，忽略其他修改（= revert）
function applyLineChanges(origLines: string[], modLines: string[], changesToKeep: LineChange[]): string[] {
  const result: string[] = []
  let origIdx = 0 // 0-based index into origLines

  for (const change of changesToKeep) {
    // 先复制 change 之前的未修改行（从 original）
    const origBefore = change.originalStartLine > 0 ? change.originalStartLine - 1 : origIdx
    while (origIdx < origBefore) {
      result.push(origLines[origIdx])
      origIdx++
    }

    // 应用这个 change（保留修改后的内容）
    if (change.modifiedStartLine > 0) {
      for (let m = change.modifiedStartLine - 1; m <= change.modifiedEndLine - 1; m++) {
        if (m < modLines.length) result.push(modLines[m])
      }
    }
    // 跳过 original 中对应的行
    if (change.originalStartLine > 0) {
      origIdx = change.originalEndLine
    }
  }

  // 复制剩余的 original 行
  while (origIdx < origLines.length) {
    result.push(origLines[origIdx])
    origIdx++
  }

  return result
}

function saveState(): void {
  if (!editorView || !currentFilePath) return
  const sel = editorView.state.selection.main
  const sd = editorView.scrollDOM
  editorStore.saveCursorState(currentFilePath, {
    anchor: sel.anchor, head: sel.head,
    scrollTop: sd.scrollTop, scrollLeft: sd.scrollLeft
  })
}

function createEditor(content: string, language: string, filePath: string): void {
  if (!containerRef.value) return
  saveState()
  if (editorView) { editorView.destroy(); editorView = null }
  currentFilePath = filePath

  // 清空旧文件的残留状态
  headContent = ''
  headLines = []
  diffChanges.value = []
  diffHunkView.value = null
  blameData.value = []
  inlineBlame.value = null
  hasConflicts.value = false

  const saved = editorStore.getCursorState(filePath)
  const selection = saved
    ? { anchor: Math.min(saved.anchor, content.length), head: Math.min(saved.head, content.length) }
    : undefined

  editorView = new EditorView({
    state: EditorState.create({
      doc: content,
      selection,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
        history(), foldGutter(), drawSelection(), indentOnInput(),
        bracketMatching(), closeBrackets(), highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([
          ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { editorStore.saveFile(); return true } }
        ]),
        // 阻止 tab 拖拽的 JSON 被插入编辑器
        EditorView.domEventHandlers({
          drop(event) {
            if (event.dataTransfer?.types.includes('application/x-orchestrix-tab')) {
              event.preventDefault()
              return true
            }
            return false
          },
        }),
        getLang(language),
        gitGutterExtensions(),
        mergeConflictExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && currentFilePath) {
            isLocalEdit = true
            editorStore.updateContent(currentFilePath, update.state.doc.toString())
            isLocalEdit = false
            scheduleDiffUpdate()
          }
          if (update.selectionSet || update.docChanged) {
            updateInlineBlame()
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: '13px' }
        })
      ]
    }),
    parent: containerRef.value
  })

  if (saved) {
    requestAnimationFrame(() => {
      if (editorView) {
        editorView.scrollDOM.scrollTop = saved.scrollTop
        editorView.scrollDOM.scrollLeft = saved.scrollLeft
      }
    })
  }

  // 异步加载 git blame 和 diff 数据
  loadGitData(filePath)

  // 检测合并冲突
  const regions = detectConflicts(content)
  hasConflicts.value = regions.length > 0
  if (regions.length > 0) {
    updateConflicts(editorView, regions)
  }

  editorView.focus()
}

watch(activeFileData, async (file) => {
  // 切换文件时退出 diff / merge 模式
  if (diffMode.value) {
    destroyDiffViews()
    diffMode.value = false
  }
  if (mergeMode.value) {
    mergeMode.value = false
  }
  await nextTick()
  if (file && file.path !== currentFilePath) {
    createEditor(file.content, file.language, file.path)
  } else if (!file) {
    saveState()
    if (editorView) { editorView.destroy(); editorView = null }
    currentFilePath = null
  }
}, { immediate: true })

// 监听 store 中文件内容变化（其他 group 编辑 / 外部文件刷新时同步）
watch(
  () => activeFileData.value?.content,
  (newContent) => {
    if (!editorView || !newContent || isLocalEdit) return
    // 必须是同一文件，避免文件切换时把新文件内容塞进旧编辑器
    if (activeFileData.value?.path !== currentFilePath) return
    const currentContent = editorView.state.doc.toString()
    if (currentContent === newContent) return
    const sel = editorView.state.selection.main
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: newContent },
      selection: { anchor: Math.min(sel.anchor, newContent.length) }
    })
    scheduleDiffUpdate()
  }
)

onBeforeUnmount(() => {
  saveState()
  if (editorView) editorView.destroy()
  destroyDiffViews()
})

// --- Drag & Drop ---
const dragOverZone = ref<string | null>(null)

function onTabDragStart(e: DragEvent, filePath: string): void {
  e.dataTransfer!.setData('application/x-orchestrix-tab', JSON.stringify({ filePath, fromGroupId: props.groupId }))
  e.dataTransfer!.effectAllowed = 'move'
}

function onTabDragOver(e: DragEvent, targetIndex: number): void {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onTabDrop(e: DragEvent, targetIndex: number): void {
  e.preventDefault()

  // 从文件树拖入
  const fileTreePath = e.dataTransfer?.getData('application/x-orchestrix-file')
  if (fileTreePath) {
    editorStore.openFile(fileTreePath, props.groupId)
    return
  }

  // tab 内部拖拽
  const raw = e.dataTransfer?.getData('application/x-orchestrix-tab')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)

  if (fromGroupId === props.groupId) {
    const fromIndex = group.value!.files.indexOf(filePath)
    if (fromIndex !== -1 && fromIndex !== targetIndex) {
      editorStore.reorderFile(props.groupId, fromIndex, targetIndex)
    }
  } else {
    editorStore.moveFileToGroup(fromGroupId, props.groupId, filePath, targetIndex)
  }
  dragOverZone.value = null
}

// 拖到编辑器边缘区域 → 分栏
function onEditorDragOver(e: DragEvent): void {
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const w = rect.width
  const h = rect.height
  const edgeThreshold = 0.25

  if (x < w * edgeThreshold) dragOverZone.value = 'left'
  else if (x > w * (1 - edgeThreshold)) dragOverZone.value = 'right'
  else if (y < h * edgeThreshold) dragOverZone.value = 'top'
  else if (y > h * (1 - edgeThreshold)) dragOverZone.value = 'bottom'
  else dragOverZone.value = 'center'
}

function onEditorDragLeave(): void {
  dragOverZone.value = null
}

function onEditorDrop(e: DragEvent): void {
  e.preventDefault()
  const zone = dragOverZone.value
  dragOverZone.value = null

  // 情况 1：从文件树拖入文件
  const fileTreePath = e.dataTransfer?.getData('application/x-orchestrix-file')
  if (fileTreePath) {
    if (zone === 'center' || !zone) {
      // 在当前 group 中打开
      editorStore.openFile(fileTreePath, props.groupId)
    } else {
      // 在新分栏中打开
      const dir = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical'
      const pos = (zone === 'left' || zone === 'top') ? 'before' : 'after'
      const newGid = `group-drop-${Date.now()}`
      editorStore.groups[newGid] = { id: newGid, files: [], activeFile: null }
      if (editorStore.layoutRoot) {
        editorStore.layoutRoot = {
          type: 'split', direction: dir,
          children: pos === 'before'
            ? [{ type: 'leaf', groupId: newGid }, editorStore.layoutRoot]
            : [editorStore.layoutRoot, { type: 'leaf', groupId: newGid }],
          sizes: [50, 50]
        }
      }
      editorStore.openFile(fileTreePath, newGid)
    }
    return
  }

  // 情况 2：从 tab 拖入（editor 内部）
  const raw = e.dataTransfer?.getData('application/x-orchestrix-tab')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)

  if (zone === 'center' || !zone) {
    if (fromGroupId !== props.groupId) {
      editorStore.moveFileToGroup(fromGroupId, props.groupId, filePath)
    }
  } else {
    const dir = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical'
    const pos = (zone === 'left' || zone === 'top') ? 'before' : 'after'
    editorStore.splitWithFile(props.groupId, filePath, fromGroupId, dir, pos)
  }
}

function isFileModified(path: string): boolean {
  const f = editorStore.getFileByPath(path)
  return f ? f.content !== f.savedContent : false
}

// --- Diff 模式（自定义双编辑器） ---

function buildExtensions(lang: string, readOnly: boolean, onChange?: () => void) {
  const exts = [
    lineNumbers(),
    highlightSpecialChars(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    oneDark,
    getLang(lang),
    diffHighlightField,
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: '13px' },
      '.cm-diff-deleted': { background: 'rgba(243, 139, 168, 0.2)' },
      '.cm-diff-added': { background: 'rgba(166, 227, 161, 0.2)' },
      '.cm-diff-modified': { background: 'rgba(249, 226, 175, 0.15)' }
    })
  ]
  if (readOnly) {
    exts.push(EditorState.readOnly.of(true))
  } else {
    exts.push(
      history(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      keymap.of([
        ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab,
        { key: 'Mod-s', run: () => { editorStore.saveFile(); return true } }
      ])
    )
    if (onChange) {
      exts.push(EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange()
      }))
    }
  }
  return exts
}

async function toggleDiff(): Promise<void> {
  if (diffMode.value) {
    // 退出 diff：取右侧编辑器的最新内容
    if (diffRightView && currentFilePath) {
      editorStore.updateContent(currentFilePath, diffRightView.state.doc.toString())
    }
    destroyDiffViews()
    diffMode.value = false
    if (activeFileData.value) {
      await nextTick()
      createEditor(activeFileData.value.content, activeFileData.value.language, activeFileData.value.path)
    }
    return
  }

  const file = activeFileData.value
  const project = workspaceStore.activeProject
  if (!file || !project) return

  const headContent = await window.electronAPI.workspace.gitShow(project.path, file.path)

  saveState()
  if (editorView) { editorView.destroy(); editorView = null }
  diffMode.value = true
  diffSplit.value = 50

  await nextTick()
  if (!diffLeftRef.value || !diffRightRef.value) return

  // 左侧：HEAD（只读）
  diffLeftView = new EditorView({
    state: EditorState.create({
      doc: headContent,
      extensions: buildExtensions(file.language, true)
    }),
    parent: diffLeftRef.value
  })

  // 右侧：当前工作副本（可编辑）
  diffRightView = new EditorView({
    state: EditorState.create({
      doc: file.content,
      extensions: buildExtensions(file.language, false, () => {
        if (currentFilePath && diffRightView) {
          editorStore.updateContent(currentFilePath, diffRightView.state.doc.toString())
        }
        // 编辑后实时更新 diff 高亮
        applyDiffHighlights()
      })
    }),
    parent: diffRightRef.value
  })

  // 初始计算 diff 高亮
  requestAnimationFrame(() => applyDiffHighlights())

  diffRightView.focus()
}

function destroyDiffViews(): void {
  if (diffLeftView) { diffLeftView.destroy(); diffLeftView = null }
  if (diffRightView) { diffRightView.destroy(); diffRightView = null }
}

// --- Diff 高亮 ---

// StateEffect + StateField 用于动态设置行高亮
const setDiffHighlights = StateEffect.define<DecorationSet>()

const diffHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffHighlights)) return e.value
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

const deletedLineDeco = Decoration.line({ class: 'cm-diff-deleted' })
const addedLineDeco = Decoration.line({ class: 'cm-diff-added' })
const modifiedLineDeco = Decoration.line({ class: 'cm-diff-modified' })

// 简单 LCS diff：返回 [leftMarks, rightMarks]
function computeDiffDecos(
  leftDoc: string, rightDoc: string,
  leftState: EditorState, rightState: EditorState
): [DecorationSet, DecorationSet] {
  const leftLines = leftDoc.split('\n')
  const rightLines = rightDoc.split('\n')

  // 计算 LCS 表
  const m = leftLines.length, n = rightLines.length
  // 优化：对于大文件使用简单逐行对比
  const maxLines = 5000
  if (m > maxLines || n > maxLines) {
    return [Decoration.none, Decoration.none]
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = leftLines[i - 1] === rightLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // 回溯标记每行状态
  const leftStatus: ('same' | 'deleted')[] = new Array(m).fill('deleted')
  const rightStatus: ('same' | 'added')[] = new Array(n).fill('added')

  let i = m, j = n
  while (i > 0 && j > 0) {
    if (leftLines[i - 1] === rightLines[j - 1]) {
      leftStatus[i - 1] = 'same'
      rightStatus[j - 1] = 'same'
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  // 构建 decorations
  const leftDecos: any[] = []
  for (let li = 0; li < m; li++) {
    if (leftStatus[li] === 'deleted') {
      const line = leftState.doc.line(li + 1)
      leftDecos.push(deletedLineDeco.range(line.from))
    }
  }

  const rightDecos: any[] = []
  for (let ri = 0; ri < n; ri++) {
    if (rightStatus[ri] === 'added') {
      const line = rightState.doc.line(ri + 1)
      rightDecos.push(addedLineDeco.range(line.from))
    }
  }

  return [
    Decoration.set(leftDecos, true),
    Decoration.set(rightDecos, true)
  ]
}

function applyDiffHighlights(): void {
  if (!diffLeftView || !diffRightView) return
  const leftDoc = diffLeftView.state.doc.toString()
  const rightDoc = diffRightView.state.doc.toString()
  const [leftDecos, rightDecos] = computeDiffDecos(
    leftDoc, rightDoc, diffLeftView.state, diffRightView.state
  )
  diffLeftView.dispatch({ effects: setDiffHighlights.of(leftDecos) })
  diffRightView.dispatch({ effects: setDiffHighlights.of(rightDecos) })
}

// 拖拽分割线
function startDiffResize(e: MouseEvent): void {
  const wrapper = (e.target as HTMLElement).closest('.diff-body') as HTMLElement
  if (!wrapper) return
  const rect = wrapper.getBoundingClientRect()
  const startX = e.clientX
  const startSplit = diffSplit.value

  const onMove = (me: MouseEvent): void => {
    const delta = ((me.clientX - startX) / rect.width) * 100
    diffSplit.value = Math.max(20, Math.min(80, startSplit + delta))
  }
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Tab 右键菜单
const tabContextMenu = ref<{ x: number; y: number; filePath: string } | null>(null)

function onTabContext(e: MouseEvent, filePath: string): void {
  e.preventDefault()
  tabContextMenu.value = { x: e.clientX, y: e.clientY, filePath }
  const close = () => { tabContextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function openInSplit(filePath: string): Promise<void> {
  tabContextMenu.value = null
  // 创建新 group 并打开同一文件
  const newGid = `group-split-${Date.now()}`
  editorStore.groups[newGid] = { id: newGid, files: [], activeFile: null }
  // 插入 split 布局
  if (editorStore.layoutRoot) {
    editorStore.layoutRoot = {
      type: 'split',
      direction: 'horizontal',
      children: [editorStore.layoutRoot, { type: 'leaf', groupId: newGid }],
      sizes: [50, 50]
    }
  }
  await editorStore.openFile(filePath, newGid)
}
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
        @dragover="onTabDragOver($event, index)"
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
      <!-- Diff 按钮（仅文本文件） -->
      <button
        v-if="activeFileData?.kind === 'text'"
        class="diff-btn"
        :class="{ active: diffMode }"
        title="Toggle Git Diff"
        @click="toggleDiff"
      >
        {{ diffMode ? '✕ Diff' : '⇄ Diff' }}
      </button>
      <button
        v-if="hasConflicts && activeFileData?.kind === 'text' && !diffMode"
        class="diff-btn merge"
        :class="{ active: mergeMode }"
        @click="mergeMode = !mergeMode"
      >
        {{ mergeMode ? '✕ Merge' : '⚡ Merge Editor' }}
      </button>
    </div>

    <!-- 编辑器 + 拖拽分栏叠加层 -->
    <div
      class="editor-body"
      @dragover="onEditorDragOver"
      @dragleave="onEditorDragLeave"
      @drop="onEditorDrop"
      @click="handleEditorClick"
    >
      <!-- 文本编辑模式 -->
      <div v-show="!diffMode && !mergeMode && activeFileData?.kind === 'text'" v-if="activeFileData" ref="containerRef" class="cm-container" />

      <!-- 图片/视频/音频预览 -->
      <MediaPreview
        v-if="activeFileData && (activeFileData.kind === 'image' || activeFileData.kind === 'video' || activeFileData.kind === 'audio') && !diffMode"
        :file="activeFileData"
      />

      <!-- 三向合并编辑器 -->
      <MergeEditor
        v-if="mergeMode && activeFileData"
        :file-path="activeFileData.path"
        :on-complete="() => { mergeMode = false; hasConflicts = false }"
      />

      <!-- Hex Editor -->
      <HexEditor
        v-if="activeFileData && activeFileData.kind === 'binary' && !diffMode && !mergeMode"
        :file="activeFileData"
      />

      <!-- Inline blame: 光标所在行的行尾淡色文字（仅 text） -->
      <div
        v-if="inlineBlame && inlineBlameStyle && !diffMode && activeFileData?.kind === 'text'"
        class="inline-blame"
        :style="inlineBlameStyle"
      >
        {{ inlineBlame.text }}
      </div>

      <!-- Inline diff peek：点击 gutter 颜色条/三角后显示变更对比（仅 text） -->
      <div
        v-if="diffHunkView && !diffMode && !mergeMode && activeFileData?.kind === 'text'"
        class="diff-hunk-inline"
        :style="{ top: diffHunkView.top + 'px' }"
      >
        <div class="hunk-toolbar">
          <span class="hunk-type" v-if="diffHunkView.change.modifiedStartLine === 0">Deleted</span>
          <span class="hunk-type added" v-else-if="diffHunkView.change.originalStartLine === 0">Added</span>
          <span class="hunk-type modified" v-else>Modified</span>
          <div class="hunk-toolbar-spacer" />
          <button class="hunk-action revert" @click="revertHunk" title="Revert this change">↩ Revert</button>
          <button class="hunk-action close" @click="diffHunkView = null">✕</button>
        </div>
        <div class="hunk-lines">
          <!-- 删除的行（红色） -->
          <div
            v-for="line in diffHunkView.oldLines"
            :key="'old-' + line.num"
            class="hunk-line deleted"
          >
            <span class="hunk-line-num">{{ line.num || '' }}</span>
            <span class="hunk-line-sign">-</span>
            <span class="hunk-line-text">{{ line.text }}</span>
          </div>
          <!-- 新增的行（绿色） -->
          <div
            v-for="line in diffHunkView.newLines"
            :key="'new-' + line.num"
            class="hunk-line added"
          >
            <span class="hunk-line-num">{{ line.num || '' }}</span>
            <span class="hunk-line-sign">+</span>
            <span class="hunk-line-text">{{ line.text }}</span>
          </div>
        </div>
      </div>

      <!-- Diff 模式：左右双编辑器 + 可拖拽分割线 -->
      <div v-show="diffMode" class="diff-wrapper">
        <div class="diff-labels">
          <span class="diff-label left" :style="{ width: diffSplit + '%' }">HEAD (Git) — read only</span>
          <span class="diff-label right" :style="{ width: (100 - diffSplit) + '%' }">Working Copy — editable</span>
        </div>
        <div class="diff-body">
          <div class="diff-pane" :style="{ width: diffSplit + '%' }">
            <div ref="diffLeftRef" class="cm-container" />
          </div>
          <div class="diff-handle" @mousedown="startDiffResize" />
          <div class="diff-pane" :style="{ width: (100 - diffSplit) + '%' }">
            <div ref="diffRightRef" class="cm-container" />
          </div>
        </div>
      </div>

      <div v-if="!activeFileData && !diffMode" class="empty">Click a file to open</div>

      <!-- 拖拽指示器 -->
      <div v-if="dragOverZone" class="drop-indicator" :class="dragOverZone" />
    </div>

    <!-- Tab 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="tabContextMenu"
        class="context-menu"
        :style="{ left: tabContextMenu.x + 'px', top: tabContextMenu.y + 'px' }"
      >
        <div class="ctx-item" @click="openInSplit(tabContextMenu!.filePath)">Open in Split Right</div>
        <div class="ctx-item" @click="editorStore.closeFile(props.groupId, tabContextMenu!.filePath); tabContextMenu = null">Close</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.editor-group {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid transparent;
}
.editor-group.active { border-color: #89b4fa; }

.tab-bar {
  display: flex;
  height: 30px;
  background: #11111b;
  border-bottom: 1px solid #313244;
  overflow-x: auto;
  flex-shrink: 0;
}
.tab-bar::-webkit-scrollbar { height: 0; }

.tab {
  display: flex; align-items: center; gap: 6px;
  height: 100%; padding: 0 10px;
  font-size: 12px; color: #6c7086;
  cursor: grab; white-space: nowrap;
  border-right: 1px solid #181825;
  user-select: none; flex-shrink: 0;
}
.tab:hover { color: #a6adc8; background: rgba(255,255,255,0.04); }
.tab.active { color: #cdd6f4; background: #1e1e2e; border-bottom: 2px solid #89b4fa; }

.tab-name { display: flex; align-items: center; gap: 4px; }
.modified-dot { width: 6px; height: 6px; border-radius: 50%; background: #f9e2af; }

.tab-close {
  background: none; border: none; color: #6c7086;
  cursor: pointer; font-size: 11px; padding: 1px 4px; border-radius: 3px; opacity: 0;
}
.tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: rgba(255,255,255,0.1); color: #f38ba8; }

.diff-btn {
  background: none; border: none; color: #6c7086;
  font-size: 11px; padding: 0 10px; cursor: pointer;
  margin-left: auto; flex-shrink: 0; white-space: nowrap;
}
.diff-btn:hover { color: #a6adc8; }
.diff-btn.active { color: #f9e2af; }
.diff-btn.merge { color: #f38ba8; }
.diff-btn.merge:hover { color: #f5c2e7; }
.diff-btn.merge.active { color: #f9e2af; }

.diff-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.diff-labels {
  display: flex;
  height: 22px;
  flex-shrink: 0;
  border-bottom: 1px solid #313244;
}

.diff-label {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 12px;
  color: #6c7086;
  background: #11111b;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.diff-label.left { border-right: 1px solid #313244; color: #f38ba8; }
.diff-label.right { color: #a6e3a1; }

.diff-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 0;
}

.diff-pane {
  overflow: hidden;
  min-width: 0;
}

.diff-handle {
  width: 5px;
  background: #313244;
  cursor: col-resize;
  flex-shrink: 0;
  transition: background 0.15s;
}

.diff-handle:hover { background: #89b4fa; }

.editor-body {
  flex: 1; overflow: hidden; min-height: 0; position: relative;
}

.cm-container { width: 100%; height: 100%; }
.cm-container :deep(.cm-editor) { height: 100%; }

/* Inline blame: 行尾淡色文字 */
.inline-blame {
  position: absolute;
  right: 16px;
  font-size: 11px;
  color: #585b70;
  pointer-events: none;
  white-space: nowrap;
  z-index: 5;
  line-height: 20px;
  font-style: italic;
}

/* Inline diff hunk (VS Code 风格) */
.diff-hunk-inline {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 50;
  background: #1a1520;
  border-top: 1px solid #f38ba8;
  border-bottom: 1px solid #f38ba8;
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.hunk-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #181825;
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

.hunk-type {
  font-size: 11px; font-weight: 600; color: #f38ba8;
}
.hunk-type.added { color: #a6e3a1; }
.hunk-type.modified { color: #89b4fa; }
.hunk-toolbar-spacer { flex: 1; }

.hunk-action {
  background: none;
  border: 1px solid #45475a;
  color: #a6adc8;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.hunk-action:hover { background: rgba(255,255,255,0.08); }
.hunk-action.revert { color: #a6e3a1; border-color: #a6e3a1; }
.hunk-action.revert:hover { background: rgba(166, 227, 161, 0.15); }

.hunk-lines {
  overflow-y: auto;
  max-height: 240px;
}

.hunk-line {
  display: flex;
  align-items: stretch;
  font-family: Menlo, Monaco, "Courier New", monospace;
  font-size: 13px;
  line-height: 20px;
}

.hunk-line.deleted {
  background: rgba(243, 139, 168, 0.1);
}

.hunk-line.added {
  background: rgba(166, 227, 161, 0.1);
}

.hunk-line-num {
  width: 42px;
  text-align: right;
  padding-right: 8px;
  color: #585b70;
  flex-shrink: 0;
  user-select: none;
}

.hunk-line-sign {
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  user-select: none;
}

.hunk-line.deleted .hunk-line-sign { color: #f38ba8; }
.hunk-line.added .hunk-line-sign { color: #a6e3a1; }

.hunk-line-text {
  flex: 1;
  white-space: pre;
  overflow-x: auto;
  padding-right: 12px;
}

.hunk-line.deleted .hunk-line-text { color: #cba6b5; }
.hunk-line.added .hunk-line-text { color: #b5cba6; }

.empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: #6c7086; font-size: 13px;
}

/* 拖拽分栏指示器 */
.drop-indicator {
  position: absolute; pointer-events: none;
  background: rgba(137, 180, 250, 0.15);
  border: 2px solid rgba(137, 180, 250, 0.5);
  border-radius: 4px;
  transition: all 0.1s;
}
.drop-indicator.left   { top: 0; left: 0; width: 50%; height: 100%; }
.drop-indicator.right  { top: 0; right: 0; width: 50%; height: 100%; }
.drop-indicator.top    { top: 0; left: 0; width: 100%; height: 50%; }
.drop-indicator.bottom { bottom: 0; left: 0; width: 100%; height: 50%; }
.drop-indicator.center { top: 4px; left: 4px; right: 4px; bottom: 4px; }

/* Tab 右键菜单 */
.context-menu {
  position: fixed; z-index: 9999; background: #313244; border: 1px solid #45475a;
  border-radius: 6px; padding: 4px 0; min-width: 180px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.ctx-item { padding: 6px 16px; font-size: 13px; color: #cdd6f4; cursor: pointer; }
.ctx-item:hover { background: rgba(137, 180, 250, 0.15); }
</style>
