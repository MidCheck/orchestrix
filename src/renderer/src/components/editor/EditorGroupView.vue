<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, computed } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
// MergeView replaced by custom dual-editor diff
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
import { gitGutterExtensions, updateDiffHunks } from '../../composables/useGitGutter'
import MediaPreview from './MediaPreview.vue'
import HexEditor from './HexEditor.vue'
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
const diffMode = ref(false)
const diffSplit = ref(50) // 左侧百分比

// Blame 数据 + 当前光标所在行的 inline blame
const blameData = ref<GitBlameLine[]>([])
const inlineBlame = ref<{ line: number; text: string } | null>(null)

// Diff hunk inline view（点击蓝色虚线时显示）
interface DiffHunkView {
  hunkIndex: number
  startLine: number
  lineCount: number
  oldLines: Array<{ num: number; text: string }>
  top: number
}
const diffHunkView = ref<DiffHunkView | null>(null)
const diffHunksData = ref<Array<{ startLine: number; lineCount: number }>>([])

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

  // 点击蓝色虚线（diff gutter）→ 显示 inline diff
  if (target.closest('.cm-git-diff-gutter') && editorView) {
    const scrollerRect = editorView.scrollDOM.getBoundingClientRect()
    const y = e.clientY - scrollerRect.top + editorView.scrollDOM.scrollTop
    try {
      const block = editorView.lineBlockAtHeight(y)
      const line = editorView.state.doc.lineAt(block.from)
      const lineNum = line.number

      const hunkIdx = diffHunksData.value.findIndex(
        (h) => lineNum >= h.startLine && lineNum < h.startLine + h.lineCount
      )
      if (hunkIdx === -1) return

      // toggle：再次点击同一个 hunk 关闭
      if (diffHunkView.value?.hunkIndex === hunkIdx) {
        diffHunkView.value = null
        return
      }

      const hunk = diffHunksData.value[hunkIdx]
      const oldLines: Array<{ num: number; text: string }> = []

      if (headLines.length > 0) {
        const start = Math.max(0, hunk.startLine - 1)
        const end = Math.min(headLines.length, hunk.startLine - 1 + hunk.lineCount)
        for (let i = start; i < end; i++) {
          oldLines.push({ num: i + 1, text: headLines[i] })
        }
      }

      // 如果 HEAD 中该范围没有内容（纯新增行），标记为新增
      if (oldLines.length === 0) {
        oldLines.push({ num: 0, text: '(new lines — no previous content)' })
      }

      const hunkStartLine = editorView.state.doc.line(hunk.startLine)
      const topPx = editorView.lineBlockAt(hunkStartLine.from).top - editorView.scrollDOM.scrollTop

      diffHunkView.value = {
        hunkIndex: hunkIdx,
        startLine: hunk.startLine,
        lineCount: hunk.lineCount,
        oldLines,
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

// 基于内存中 HEAD 内容 vs 当前编辑器内容重算 diff 标记
function recomputeDiffMarks(): void {
  if (!editorView || headLines.length === 0) {
    diffHunksData.value = []
    if (editorView) updateDiffHunks(editorView, [])
    return
  }

  const currentLines = editorView.state.doc.toString().split('\n')
  const hunks: Array<{ startLine: number; lineCount: number }> = []

  // 逐行比较，连续不同的行合并为一个 hunk
  let hunkStart = -1
  const maxLen = Math.max(currentLines.length, headLines.length)

  for (let i = 0; i < currentLines.length; i++) {
    const isDiff = i >= headLines.length || currentLines[i] !== headLines[i]
    if (isDiff) {
      if (hunkStart === -1) hunkStart = i
    } else {
      if (hunkStart !== -1) {
        hunks.push({ startLine: hunkStart + 1, lineCount: i - hunkStart })
        hunkStart = -1
      }
    }
  }
  if (hunkStart !== -1) {
    hunks.push({ startLine: hunkStart + 1, lineCount: currentLines.length - hunkStart })
  }

  diffHunksData.value = hunks
  updateDiffHunks(editorView, hunks)
}

// 节流的 diff 重算（编辑时不要每次按键都算）
function scheduleDiffUpdate(): void {
  if (diffUpdateTimer) clearTimeout(diffUpdateTimer)
  diffUpdateTimer = setTimeout(() => recomputeDiffMarks(), 300)
}

// Revert 当前 hunk：用 HEAD 的旧内容替换当前 hunk 的行
function revertHunk(): void {
  if (!diffHunkView.value || !editorView) return
  const hunk = diffHunkView.value
  const doc = editorView.state.doc

  // 当前 hunk 范围
  const fromLine = doc.line(hunk.startLine)
  const toLine = doc.line(Math.min(hunk.startLine + hunk.lineCount - 1, doc.lines))

  // HEAD 中对应的内容
  const oldText = hunk.oldLines
    .filter((l) => l.num > 0) // 排除 "(new lines)" 占位
    .map((l) => l.text)
    .join('\n')

  editorView.dispatch({
    changes: { from: fromLine.from, to: toLine.to, insert: oldText }
  })

  diffHunkView.value = null
  // 编辑触发后 scheduleDiffUpdate 会自动更新虚线
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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([
          ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab,
          { key: 'Mod-s', run: () => { editorStore.saveFile(); return true } }
        ]),
        getLang(language),
        gitGutterExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && currentFilePath) {
            editorStore.updateContent(currentFilePath, update.state.doc.toString())
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

  editorView.focus()
}

watch(activeFileData, async (file) => {
  // 切换文件时退出 diff 模式
  if (diffMode.value) {
    destroyDiffViews()
    diffMode.value = false
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

onBeforeUnmount(() => {
  saveState()
  if (editorView) editorView.destroy()
  destroyDiffViews()
})

// --- Drag & Drop ---
const dragOverZone = ref<string | null>(null)

function onTabDragStart(e: DragEvent, filePath: string): void {
  e.dataTransfer!.setData('text/plain', JSON.stringify({ filePath, fromGroupId: props.groupId }))
  e.dataTransfer!.effectAllowed = 'move'
}

function onTabDragOver(e: DragEvent, targetIndex: number): void {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onTabDrop(e: DragEvent, targetIndex: number): void {
  e.preventDefault()
  const raw = e.dataTransfer?.getData('text/plain')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)

  if (fromGroupId === props.groupId) {
    // 同 group 内排序
    const fromIndex = group.value!.files.indexOf(filePath)
    if (fromIndex !== -1 && fromIndex !== targetIndex) {
      editorStore.reorderFile(props.groupId, fromIndex, targetIndex)
    }
  } else {
    // 跨 group 移动
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
  const raw = e.dataTransfer?.getData('text/plain')
  if (!raw) return
  const { filePath, fromGroupId } = JSON.parse(raw)
  const zone = dragOverZone.value
  dragOverZone.value = null

  if (zone === 'center' || !zone) {
    // 合并到当前 group
    if (fromGroupId !== props.groupId) {
      editorStore.moveFileToGroup(fromGroupId, props.groupId, filePath)
    }
  } else {
    // 分栏
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
      <div v-show="!diffMode && activeFileData?.kind === 'text'" v-if="activeFileData" ref="containerRef" class="cm-container" />

      <!-- 图片/视频/音频预览 -->
      <MediaPreview
        v-if="activeFileData && (activeFileData.kind === 'image' || activeFileData.kind === 'video' || activeFileData.kind === 'audio') && !diffMode"
        :file="activeFileData"
      />

      <!-- Hex Editor -->
      <HexEditor
        v-if="activeFileData && activeFileData.kind === 'binary' && !diffMode"
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

      <!-- Inline diff：点击蓝色虚线后显示 HEAD 旧代码（仅 text） -->
      <div
        v-if="diffHunkView && !diffMode && activeFileData?.kind === 'text'"
        class="diff-hunk-inline"
        :style="{ top: diffHunkView.top + 'px' }"
      >
        <div class="hunk-toolbar">
          <button class="hunk-action revert" @click="revertHunk" title="Revert this change">↩ Revert</button>
          <button class="hunk-action close" @click="diffHunkView = null">✕</button>
        </div>
        <div class="hunk-lines">
          <div v-for="line in diffHunkView.oldLines" :key="line.num" class="hunk-line">
            <span class="hunk-line-num">{{ line.num || '' }}</span>
            <span class="hunk-line-sign">-</span>
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
  justify-content: flex-end;
  gap: 4px;
  padding: 2px 6px;
  background: rgba(243, 139, 168, 0.1);
  border-bottom: 1px solid #313244;
  flex-shrink: 0;
}

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
  background: rgba(243, 139, 168, 0.08);
  font-family: Menlo, Monaco, "Courier New", monospace;
  font-size: 13px;
  line-height: 20px;
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
  color: #f38ba8;
  text-align: center;
  flex-shrink: 0;
  user-select: none;
}

.hunk-line-text {
  flex: 1;
  color: #cba6b5;
  white-space: pre;
  overflow-x: auto;
  padding-right: 12px;
}

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
</style>
