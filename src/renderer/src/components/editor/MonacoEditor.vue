<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { useUIStore } from '../../stores/ui'
import type { GitBlameLine } from '@shared/types'
import { registerLanguageProviders } from '../../composables/useLanguageProviders'
import { startLspForFile } from '../../composables/useLspClient'

const props = defineProps<{
  filePath: string
  groupId: string
  diffMode?: boolean
}>()

const editorStore = useEditorStore()
const workspaceStore = useWorkspaceStore()

const containerRef = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let isLocalEdit = false

// Git 数据
let headLines: string[] = []
const blameData = ref<GitBlameLine[]>([])
let decorationIds: string[] = []
let blameDecorationIds: string[] = []

// 语言映射
function getMonacoLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'javascript', typescript: 'typescript',
    json: 'json', html: 'html', css: 'css', vue: 'html',
    python: 'python', c: 'c', cpp: 'cpp', java: 'java',
    csharp: 'csharp', go: 'go', rust: 'rust', ruby: 'ruby',
    swift: 'swift', kotlin: 'kotlin', shell: 'shell',
    yaml: 'yaml', markdown: 'markdown', sql: 'sql',
    xml: 'xml', dockerfile: 'dockerfile', lua: 'lua',
    perl: 'perl', powershell: 'powershell', toml: 'ini',
    objectivec: 'objective-c', cmake: 'cmake',
  }
  return map[lang] || 'plaintext'
}

function createEditor(): void {
  if (!containerRef.value) return
  const file = editorStore.getFileByPath(props.filePath)
  if (!file || file.kind !== 'text') return

  const uri = monaco.Uri.parse(`file://${file.path}`)
  let model = monaco.editor.getModel(uri)
  if (!model) {
    model = monaco.editor.createModel(file.content, getMonacoLanguage(file.language), uri)
  } else {
    // 模型已存在（多实例打开同一文件），直接复用
    monaco.editor.setModelLanguage(model, getMonacoLanguage(file.language))
  }

  editor = monaco.editor.create(containerRef.value, {
    model,
    theme: 'orchestrix-dark',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fixedOverflowWidgets: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'off',
    glyphMargin: true,
    folding: true,
    lineNumbersMinChars: 3,
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
  })

  // 内容变化 → 同步到 store + 通知 LSP
  editor.onDidChangeModelContent(() => {
    if (!editor) return
    isLocalEdit = true
    const content = editor.getValue()
    editorStore.updateContent(props.filePath, content)
    isLocalEdit = false
    scheduleDiffUpdate()
    // 通知 LSP
    const proj = workspaceStore.activeProject
    if (proj) {
      window.electronAPI.lsp.status().then((servers) => {
        const f = editorStore.getFileByPath(props.filePath)
        if (!f) return
        const srv = servers.find(s => s.languages.includes(f.language))
        if (srv?.running) notifyFileChange(srv.id, proj.path, props.filePath, content)
      })
    }
  })

  // 光标变化 → inline blame
  editor.onDidChangeCursorPosition((e) => {
    updateInlineBlame(e.position.lineNumber)
  })

  document.addEventListener('mousedown', peekClickHandler, true)

  // 点击 gutter 区域
  editor.onMouseDown((e) => {
    if (!editor) return
    const target = e.target
    // 检查是否点击了 gutter decoration
    if (target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
        target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      const lineNumber = target.position?.lineNumber
      if (!lineNumber) return
      // 找到包含该行的 change
      const change = diffChanges.find(c => {
        if (c.modifiedStartLine > 0 && c.modifiedEndLine > 0) {
          return lineNumber >= c.modifiedStartLine && lineNumber <= c.modifiedEndLine
        }
        // deleted
        if (c.modifiedStartLine === 0 && c.originalStartLine > 0) {
          const anchor = Math.max(1, (c as any)._deleteAnchor + 1 || 1)
          return lineNumber === anchor
        }
        return false
      })
      if (!change) return

      // toggle
      if (diffPeekLine.value === lineNumber) {
        closeDiffPeek()
        return
      }

      showDiffPeek(change, lineNumber)
    }
  })

  // Cmd+S 保存
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    editorStore.saveFile()
  })

  // 添加右键菜单项（Monaco standalone 不自带这些）
  const menuItems = [
    { id: 'orchestrix.goToDefinition', label: 'Go to Definition', keybindings: [monaco.KeyCode.F12], contextMenuGroupId: 'navigation', contextMenuOrder: 1,
      run: (ed: monaco.editor.ICodeEditor) => ed.trigger('menu', 'editor.action.revealDefinition', {}) },
    { id: 'orchestrix.peekDefinition', label: 'Peek Definition', keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F12], contextMenuGroupId: 'navigation', contextMenuOrder: 2,
      run: (ed: monaco.editor.ICodeEditor) => ed.trigger('menu', 'editor.action.peekDefinition', {}) },
    { id: 'orchestrix.findReferences', label: 'Find All References', keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: 'navigation', contextMenuOrder: 3,
      run: (ed: monaco.editor.ICodeEditor) => ed.trigger('menu', 'editor.action.goToReferences', {}) },
    { id: 'orchestrix.renameSymbol', label: 'Rename Symbol', keybindings: [monaco.KeyCode.F2], contextMenuGroupId: 'navigation', contextMenuOrder: 4,
      run: (ed: monaco.editor.ICodeEditor) => ed.trigger('menu', 'editor.action.rename', {}) },
  ]
  for (const item of menuItems) {
    editor.addAction(item)
  }

  // 恢复光标位置
  const saved = editorStore.getCursorState(props.filePath)
  if (saved) {
    const pos = model.getPositionAt(Math.min(saved.anchor, model.getValueLength()))
    editor.setPosition(pos)
    editor.setScrollTop(saved.scrollTop)
    editor.setScrollLeft(saved.scrollLeft)
  }

  // 加载 git 数据
  loadGitData()

  // 启动 LSP（如果有对应的 server）
  const project = workspaceStore.activeProject
  if (project && file) {
    initLsp(file.language, project.path, props.filePath, file.content)
  }
}

function initLsp(language: string, projectPath: string, filePath: string, content: string): void {
  const lang = getMonacoLanguage(language)

  // 先查状态
  window.electronAPI.lsp.status().then(servers => {
    const server = servers.find(s => s.languages.includes(language))
    if (!server?.installed) return

    // 在 Main 进程一站式完成 start + initialize + initialized + didOpen
    window.electronAPI.lsp.autoInit(server.id, projectPath, filePath, lang, content).then(ok => {
      if (!ok) return
      // 只在 Renderer 注册 Monaco providers
      startLspForFile(filePath, lang, projectPath)
    })
  })
}

function saveState(): void {
  if (!editor) return
  const pos = editor.getPosition()
  const model = editor.getModel()
  if (pos && model) {
    editorStore.saveCursorState(props.filePath, {
      anchor: model.getOffsetAt(pos),
      head: model.getOffsetAt(pos),
      scrollTop: editor.getScrollTop(),
      scrollLeft: editor.getScrollLeft()
    })
  }
}

function disposeEditor(): void {
  saveState()
  if (editor) {
    editor.dispose()
    editor = null
  }
}

// --- Git Gutter (green/blue/red) ---

interface LineChange {
  originalStartLine: number
  originalEndLine: number
  modifiedStartLine: number
  modifiedEndLine: number
}

let diffChanges: LineChange[] = []

// Diff peek（点击 gutter 显示旧代码）
const diffPeekLine = ref<number | null>(null)
const diffPeekOldLines = ref<Array<{ num: number; text: string }>>([])
const diffPeekNewLines = ref<Array<{ num: number; text: string }>>([])
let diffPeekChangeRef: LineChange | null = null

let viewZoneId: string | null = null
let peekCleanups: Array<() => void> = []

// document 级别 capture 监听 diff peek 按钮（在 createEditor 中注册）
function peekClickHandler(ev: MouseEvent): void {
  const t = ev.target as HTMLElement
  if (t.closest('.diff-peek-revert-btn')) { ev.stopPropagation(); ev.preventDefault(); revertDiffPeek() }
  else if (t.closest('.diff-peek-close-btn')) { ev.stopPropagation(); ev.preventDefault(); closeDiffPeek() }
}

function showDiffPeek(change: LineChange, lineNumber: number): void {
  diffPeekChangeRef = change
  diffPeekLine.value = lineNumber

  const oldLines: Array<{ num: number; text: string }> = []
  if (change.originalStartLine > 0 && headLines.length > 0) {
    for (let i = change.originalStartLine - 1; i <= change.originalEndLine - 1 && i < headLines.length; i++) {
      oldLines.push({ num: i + 1, text: headLines[i] })
    }
  }

  const newLines: Array<{ num: number; text: string }> = []
  if (change.modifiedStartLine > 0 && change.modifiedEndLine > 0 && editor) {
    const content = editor.getValue().split('\n')
    for (let i = change.modifiedStartLine - 1; i <= change.modifiedEndLine - 1 && i < content.length; i++) {
      newLines.push({ num: i + 1, text: content[i] })
    }
  }

  diffPeekOldLines.value = oldLines
  diffPeekNewLines.value = newLines

  if (!editor) return
  const afterLine = change.modifiedStartLine > 0 ? change.modifiedStartLine - 1 : Math.max(0, lineNumber - 1)
  const totalPeekLines = oldLines.length + newLines.length + 2

  // 纯 DOM 构建 diff peek 内容
  const domNode = document.createElement('div')
  domNode.className = 'monaco-diff-peek-zone'

  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

  const typeLabel = oldLines.length && !newLines.length ? '<span style="color:#f38ba8">Deleted</span>'
    : !oldLines.length && newLines.length ? '<span style="color:#a6e3a1">Added</span>'
    : '<span style="color:#89b4fa">Modified</span>'

  let html = `<div style="display:flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(243,139,168,0.1);border-bottom:1px solid #313244;font-size:11px">
    ${typeLabel}<div style="flex:1"></div>
    <button class="diff-peek-revert-btn" style="background:none;border:1px solid #a6e3a1;color:#a6e3a1;font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer">↩ Revert</button>
    <button class="diff-peek-close-btn" style="background:none;border:1px solid #45475a;color:#a6adc8;font-size:11px;padding:2px 6px;border-radius:3px;cursor:pointer">✕</button>
  </div><div style="overflow-y:auto;max-height:${Math.min(totalPeekLines, 10) * 20}px">`

  for (const l of oldLines) {
    html += `<div style="display:flex;font-family:Menlo,Monaco,monospace;font-size:13px;line-height:20px;background:rgba(243,139,168,0.1)">
      <span style="width:40px;text-align:right;padding-right:8px;color:#585b70;flex-shrink:0">${l.num}</span>
      <span style="width:14px;text-align:center;color:#f38ba8;flex-shrink:0">-</span>
      <span style="flex:1;white-space:pre;overflow-x:auto;color:#cba6b5">${esc(l.text)}</span></div>`
  }
  for (const l of newLines) {
    html += `<div style="display:flex;font-family:Menlo,Monaco,monospace;font-size:13px;line-height:20px;background:rgba(166,227,161,0.1)">
      <span style="width:40px;text-align:right;padding-right:8px;color:#585b70;flex-shrink:0">${l.num}</span>
      <span style="width:14px;text-align:center;color:#a6e3a1;flex-shrink:0">+</span>
      <span style="flex:1;white-space:pre;overflow-x:auto;color:#b5cba6">${esc(l.text)}</span></div>`
  }
  html += '</div>'
  domNode.innerHTML = html
  domNode.style.cssText = 'background:#1a1520;border-top:1px solid #f38ba8;border-bottom:1px solid #f38ba8;overflow:hidden'

  // 放在编辑器容器外面（不用 ViewZone，避免 .view-lines 遮挡）
  // 计算位置：基于行号的 top offset
  const containerEl = containerRef.value
  if (!containerEl) return
  const lineTop = editor.getTopForLineNumber(afterLine + 1) - editor.getScrollTop()
  const layoutInfo = editor.getLayoutInfo()

  domNode.style.position = 'absolute'
  domNode.style.top = lineTop + 'px'
  domNode.style.left = '0'
  domNode.style.right = '0'
  domNode.style.zIndex = '100'
  containerEl.style.position = 'relative'
  containerEl.appendChild(domNode)

  // 滚动时更新位置
  const scrollDisposable = editor.onDidScrollChange(() => {
    if (!editor) return
    const newTop = editor.getTopForLineNumber(afterLine + 1) - editor.getScrollTop()
    domNode.style.top = newTop + 'px'
  })
  peekCleanups.push(
    () => scrollDisposable.dispose(),
    () => { try { containerEl.removeChild(domNode) } catch {} }
  )
}

function closeDiffPeek(): void {
  for (const fn of peekCleanups) fn()
  peekCleanups = []
  viewZoneId = null
  diffPeekLine.value = null
  diffPeekOldLines.value = []
  diffPeekNewLines.value = []
  diffPeekChangeRef = null
}

function revertDiffPeek(): void {
  if (!diffPeekChangeRef || !editor) return
  const change = { ...diffPeekChangeRef, _deleteAnchor: (diffPeekChangeRef as any)._deleteAnchor }
  closeDiffPeek() // 先关闭 peek
  const model = editor!.getModel()
  if (!model) return

  let replacement = ''
  if (change.originalStartLine > 0) {
    replacement = headLines.slice(change.originalStartLine - 1, change.originalEndLine).join('\n')
  }

  if (change.modifiedStartLine > 0 && change.modifiedEndLine > 0) {
    const startLine = change.modifiedStartLine
    const endLine = change.modifiedEndLine

    if (change.originalStartLine === 0) {
      // 纯新增行 → 整行删除（包括换行符）
      let from: monaco.IPosition, to: monaco.IPosition
      if (endLine < model.getLineCount()) {
        from = { lineNumber: startLine, column: 1 }
        to = { lineNumber: endLine + 1, column: 1 }
      } else if (startLine > 1) {
        // 新增在文件末尾：从上一行末尾开始删
        from = { lineNumber: startLine - 1, column: model.getLineMaxColumn(startLine - 1) }
        to = { lineNumber: endLine, column: model.getLineMaxColumn(endLine) }
      } else {
        from = { lineNumber: 1, column: 1 }
        to = { lineNumber: endLine, column: model.getLineMaxColumn(endLine) }
      }
      editor!.executeEdits('revert', [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: '' }])
    } else {
      // 修改行 → 整行替换
      let rangeEnd: monaco.IPosition
      if (endLine < model.getLineCount()) {
        rangeEnd = { lineNumber: endLine + 1, column: 1 }
      } else {
        rangeEnd = { lineNumber: endLine, column: model.getLineMaxColumn(endLine) }
      }
      const replaceText = replacement + (endLine < model.getLineCount() ? '\n' : '')
      editor!.executeEdits('revert', [{ range: new monaco.Range(startLine, 1, rangeEnd.lineNumber, rangeEnd.column), text: replaceText }])
    }
  } else if (change.originalStartLine > 0) {
    // 纯删除 → 插入
    const anchor = Math.max(1, (change as any)._deleteAnchor + 1 || 1)
    const pos = { lineNumber: anchor, column: 1 }
    editor!.executeEdits('revert', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: replacement + '\n' }])
  }
}
let diffTimer: ReturnType<typeof setTimeout> | null = null

function scheduleDiffUpdate(): void {
  if (diffTimer) clearTimeout(diffTimer)
  diffTimer = setTimeout(recomputeDiff, 300)
}

function recomputeDiff(): void {
  if (!editor || headLines.length === 0) {
    diffChanges = []
    applyGutterDecorations()
    return
  }
  const currentLines = editor.getValue().split('\n')
  diffChanges = computeLineChanges(headLines, currentLines)
  applyGutterDecorations()
}

function computeLineChanges(origLines: string[], modLines: string[]): LineChange[] {
  const m = origLines.length, n = modLines.length
  if (m > 3000 || n > 3000) return []

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = origLines[i-1] === modLines[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1])

  const ops: Array<{ type: 'equal'|'delete'|'insert'; origIdx: number; modIdx: number }> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i-1] === modLines[j-1]) { ops.push({type:'equal',origIdx:i,modIdx:j}); i--;j-- }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.push({type:'insert',origIdx:i,modIdx:j}); j-- }
    else { ops.push({type:'delete',origIdx:i,modIdx:j}); i-- }
  }
  ops.reverse()

  const changes: LineChange[] = []
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].type === 'equal') { idx++; continue }
    let origStart=0,origEnd=0,modStart=0,modEnd=0,deleteModPos=0
    while (idx < ops.length && ops[idx].type === 'delete') {
      if (!origStart) origStart = ops[idx].origIdx
      origEnd = ops[idx].origIdx
      deleteModPos = ops[idx].modIdx
      idx++
    }
    while (idx < ops.length && ops[idx].type === 'insert') {
      if (!modStart) modStart = ops[idx].modIdx
      modEnd = ops[idx].modIdx; idx++
    }
    const change: LineChange = { originalStartLine: origStart, originalEndLine: origEnd, modifiedStartLine: modStart, modifiedEndLine: modEnd }
    if (modStart === 0 && deleteModPos > 0) (change as any)._deleteAnchor = deleteModPos
    changes.push(change)
  }
  return changes
}

function applyGutterDecorations(): void {
  if (!editor) return
  const newDecos: monaco.editor.IModelDeltaDecoration[] = []

  for (const c of diffChanges) {
    if (c.originalStartLine === 0 && c.modifiedStartLine > 0) {
      // Added (green)
      newDecos.push({
        range: new monaco.Range(c.modifiedStartLine, 1, c.modifiedEndLine, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'git-gutter-added',
          overviewRuler: { color: '#a6e3a1', position: monaco.editor.OverviewRulerLane.Left }
        }
      })
    } else if (c.modifiedStartLine === 0 && c.originalStartLine > 0) {
      // Deleted (red triangle) — mark at the line after deletion
      const rawAnchor = (c as any)._deleteAnchor ?? 0
      const anchor = Math.max(1, rawAnchor + 1)
      newDecos.push({
        range: new monaco.Range(anchor, 1, anchor, 1),
        options: {
          isWholeLine: false,
          linesDecorationsClassName: 'git-gutter-deleted',
          overviewRuler: { color: '#f38ba8', position: monaco.editor.OverviewRulerLane.Left }
        }
      })
    } else if (c.modifiedStartLine > 0) {
      // Modified (blue)
      newDecos.push({
        range: new monaco.Range(c.modifiedStartLine, 1, c.modifiedEndLine, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'git-gutter-modified',
          overviewRuler: { color: '#89b4fa', position: monaco.editor.OverviewRulerLane.Left }
        }
      })
    }
  }

  decorationIds = editor.deltaDecorations(decorationIds, newDecos)
}

// --- Inline Blame ---

function updateInlineBlame(lineNumber: number): void {
  if (!editor || blameData.value.length === 0) {
    blameDecorationIds = editor?.deltaDecorations(blameDecorationIds, []) || []
    return
  }
  const blame = blameData.value.find(b => b.line === lineNumber)
  if (!blame) {
    blameDecorationIds = editor.deltaDecorations(blameDecorationIds, [])
    return
  }
  const isUncommitted = blame.hash.startsWith('0000000')
  const text = isUncommitted ? 'Uncommitted' : `${blame.author}, ${formatTimeAgo(blame.date)}`

  blameDecorationIds = editor.deltaDecorations(blameDecorationIds, [{
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      after: {
        content: `  ${text}`,
        inlineClassName: 'inline-blame-text'
      }
    }
  }])
}

function formatTimeAgo(isoDate: string): string {
  const d = new Date(isoDate)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// --- Git Data Loading ---

async function loadGitData(): Promise<void> {
  const project = workspaceStore.activeProject
  if (!project || !editor) return
  try {
    const isGit = await window.electronAPI.workspace.isGitRepo(project.path)
    if (!isGit) return
    const [head, blame] = await Promise.all([
      window.electronAPI.workspace.gitShow(project.path, props.filePath),
      window.electronAPI.workspace.gitBlame(project.path, props.filePath)
    ])
    headLines = head.split('\n')
    blameData.value = blame
    recomputeDiff()
  } catch { /* ignore */ }
}

// --- Diff View ---

const diffContainerRef = ref<HTMLElement | null>(null)
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null

watch(() => props.diffMode, async (val) => {
  if (val) await openDiff()
  else closeDiff()
})

function closeDiff(): void {
  diffEditor?.dispose()
  diffEditor = null
}

async function openDiff(): Promise<void> {
  const file = editorStore.getFileByPath(props.filePath)
  const project = workspaceStore.activeProject
  if (!file || !project) return
  const headContent = await window.electronAPI.workspace.gitShow(project.path, props.filePath)

  await nextTick()
  if (!diffContainerRef.value) return

  const originalModel = monaco.editor.createModel(headContent, getMonacoLanguage(file.language))
  const modifiedUri = monaco.Uri.parse(`file://${file.path}`)
  let modifiedModel = monaco.editor.getModel(modifiedUri)
  if (!modifiedModel) {
    modifiedModel = monaco.editor.createModel(file.content, getMonacoLanguage(file.language), modifiedUri)
  }

  diffEditor = monaco.editor.createDiffEditor(diffContainerRef.value, {
    theme: 'orchestrix-dark',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    automaticLayout: true,
    readOnly: false,
    renderSideBySide: true,
    originalEditable: false,
  })

  diffEditor.setModel({ original: originalModel, modified: modifiedModel })
}

// --- Store sync (multi-instance) ---

watch(
  () => editorStore.getFileByPath(props.filePath)?.content,
  (newContent) => {
    if (!editor || !newContent || isLocalEdit) return
    if (editor.getValue() === newContent) return
    const pos = editor.getPosition()
    editor.setValue(newContent)
    if (pos) editor.setPosition(pos)
  }
)

// Layer switch → save/restore cursor + reload external changes
watch(
  () => useUIStore().activeLayer,
  (layer, oldLayer) => {
    if (oldLayer === 'editor') saveState()
    if (layer === 'editor' && editor) {
      requestAnimationFrame(() => {
        if (!editor) return
        editor.layout()
        // 恢复光标位置和滚动
        const saved = editorStore.getCursorState(props.filePath)
        if (saved) {
          const model = editor.getModel()
          if (model) {
            const pos = model.getPositionAt(Math.min(saved.anchor, model.getValueLength()))
            editor.setPosition(pos)
            editor.revealPositionInCenter(pos)
          }
          editor.setScrollTop(saved.scrollTop)
          editor.setScrollLeft(saved.scrollLeft)
        }
      })
      // 检查外部文件变化（CLI/Agent 修改）
      checkExternalFileChange()
    }
  }
)

async function checkExternalFileChange(): Promise<void> {
  if (!editor) return
  try {
    const result = await window.electronAPI.workspace.readFile(props.filePath)
    if (result.kind !== 'text') return
    const currentContent = editor.getValue()
    const storeFile = editorStore.getFileByPath(props.filePath)
    // 如果磁盘内容和编辑器不同，且用户没有未保存的修改
    if (result.content !== currentContent && storeFile && storeFile.content === storeFile.savedContent) {
      // 更新 store
      storeFile.content = result.content
      storeFile.savedContent = result.content
      // 更新 Monaco（保留光标）
      const pos = editor.getPosition()
      const scroll = { top: editor.getScrollTop(), left: editor.getScrollLeft() }
      isLocalEdit = true
      editor.setValue(result.content)
      isLocalEdit = false
      if (pos) {
        const model = editor.getModel()
        if (model) {
          const safePos = model.validatePosition(pos)
          editor.setPosition(safePos)
        }
      }
      editor.setScrollTop(scroll.top)
      editor.setScrollLeft(scroll.left)
      // 重新加载 git 数据
      loadGitData()
    }
  } catch {}
}

onMounted(() => {
  // 初始化 Monaco workers（只需一次）
  if (!(window as any).__monacoWorkersReady) {
    (window as any).__monacoWorkersReady = true
    ;(self as any).MonacoEnvironment = {
      getWorker(_: any, label: string) {
        if (label === 'typescript' || label === 'javascript') return new tsWorker()
        if (label === 'json') return new jsonWorker()
        if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
        return new editorWorker()
      }
    }
  }

  ;(window as any).monaco = monaco
  registerLanguageProviders()

  // 注册主题
  monaco.editor.defineTheme('orchestrix-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#cdd6f4',
      'editor.lineHighlightBackground': '#2a2b3d',
      'editor.selectionBackground': '#585b70',
      'editorCursor.foreground': '#f5e0dc',
      'editorLineNumber.foreground': '#6c7086',
      'editorLineNumber.activeForeground': '#cdd6f4',
    }
  })
  createEditor()
})

onBeforeUnmount(() => {
  saveState()
  closeDiffPeek()
  document.removeEventListener('mousedown', peekClickHandler, true)
  diffEditor?.dispose()
  editor?.dispose()
  editor = null
})

// 右键菜单
const contextMenu = ref<{ x: number; y: number } | null>(null)

function onContextMenu(e: MouseEvent): void {
  // 只在 Monaco 编辑器区域触发
  const target = e.target as HTMLElement
  if (!target.closest('.monaco-editor') || target.closest('.monaco-menu')) return
  e.preventDefault()
  e.stopPropagation()
  contextMenu.value = { x: e.clientX, y: e.clientY }
  const close = () => { contextMenu.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

function triggerAction(actionId: string): void {
  contextMenu.value = null
  if (editor) editor.trigger('contextMenu', actionId, {})
}

defineExpose({ saveState })
</script>

<template>
  <div class="monaco-wrapper" @contextmenu.capture.prevent="onContextMenu">
    <!-- 普通编辑模式 -->
    <div v-show="!props.diffMode" ref="containerRef" class="monaco-container" />

    <!-- 自定义右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="monaco-ctx-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div class="mctx-item" @click="triggerAction('editor.action.revealDefinition')">Go to Definition <span class="mctx-key">F12</span></div>
        <div class="mctx-item" @click="triggerAction('editor.action.peekDefinition')">Peek Definition <span class="mctx-key">Alt+F12</span></div>
        <div class="mctx-item" @click="triggerAction('editor.action.goToReferences')">Find All References <span class="mctx-key">Shift+F12</span></div>
        <div class="mctx-divider" />
        <div class="mctx-item" @click="triggerAction('editor.action.rename')">Rename Symbol <span class="mctx-key">F2</span></div>
        <div class="mctx-divider" />
        <div class="mctx-item" @click="triggerAction('editor.action.formatDocument')">Format Document</div>
        <div class="mctx-item" @click="triggerAction('editor.action.quickCommand')">Command Palette <span class="mctx-key">F1</span></div>
      </div>
    </Teleport>
    <!-- Diff 模式 -->
    <div v-show="props.diffMode" class="diff-wrapper">
      <div class="diff-toolbar-bar">
        <span class="diff-label-left">HEAD (Git)</span>
        <span class="diff-label-right">Working Copy</span>
        <button class="diff-close-btn" @click="closeDiff">✕ Close Diff</button>
      </div>
      <div ref="diffContainerRef" class="monaco-container" />
    </div>
  </div>
</template>

<style>
/* Git gutter decorations (global CSS, Monaco needs non-scoped) */
.git-gutter-added {
  width: 4px !important;
  margin-left: 2px;
  background: #a6e3a1;
}
.git-gutter-modified {
  width: 4px !important;
  margin-left: 2px;
  background: #89b4fa;
}
.git-gutter-deleted {
  width: 0 !important;
  height: 0 !important;
  margin-left: 2px;
  margin-top: -3px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 5px solid #f38ba8;
}
.inline-blame-text {
  color: #585b70 !important;
  font-style: italic;
  font-size: 12px !important;
}
.monaco-diff-peek-zone {
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
</style>

<style scoped>
.monaco-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.monaco-container {
  flex: 1;
  min-height: 0;
}
.diff-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.diff-toolbar-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  padding: 0 12px;
  background: #181825;
  border-bottom: 1px solid #313244;
  font-size: 11px;
  flex-shrink: 0;
}
.diff-label-left { color: #f38ba8; font-weight: 600; }
.diff-label-right { color: #a6e3a1; font-weight: 600; flex: 1; }
.diff-close-btn {
  background: none; border: none; color: #a6adc8;
  cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 3px;
}
.diff-close-btn:hover { background: rgba(255,255,255,0.1); }

/* 右键菜单 */
.monaco-ctx-menu {
  position: fixed; z-index: 99999;
  background: #2a2b3d; border: 1px solid #45475a; border-radius: 6px;
  padding: 4px 0; min-width: 220px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.mctx-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 16px; font-size: 13px; color: #cdd6f4; cursor: pointer;
}
.mctx-item:hover { background: rgba(137,180,250,0.15); }
.mctx-key { font-size: 11px; color: #6c7086; margin-left: 20px; }
.mctx-divider { height: 1px; background: #45475a; margin: 3px 0; }

</style>
