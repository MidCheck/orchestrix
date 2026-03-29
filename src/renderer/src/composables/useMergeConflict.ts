import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType
} from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'

// 冲突区域
export interface ConflictRegion {
  index: number
  // 行号 (1-based)
  startLine: number        // <<<<<<< 行
  separatorLine: number    // ======= 行
  endLine: number          // >>>>>>> 行
  currentLabel: string     // <<<<<<< 后的标签
  incomingLabel: string    // >>>>>>> 后的标签
}

// 检测文件中的合并冲突标记
export function detectConflicts(content: string): ConflictRegion[] {
  const lines = content.split('\n')
  const regions: ConflictRegion[] = []
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i + 1
      const currentLabel = lines[i].substring(7).trim()
      let separatorLine = 0
      let endLine = 0
      let incomingLabel = ''

      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('=======')) {
          separatorLine = j + 1
        } else if (lines[j].startsWith('>>>>>>>')) {
          endLine = j + 1
          incomingLabel = lines[j].substring(7).trim()
          break
        }
      }

      if (separatorLine && endLine) {
        regions.push({
          index: regions.length,
          startLine,
          separatorLine,
          endLine,
          currentLabel: currentLabel || 'Current Change',
          incomingLabel: incomingLabel || 'Incoming Change'
        })
        i = endLine
        continue
      }
    }
    i++
  }

  return regions
}

// 冲突操作按钮 Widget
class ConflictActionsWidget extends WidgetType {
  constructor(
    private conflictIndex: number,
    private currentLabel: string,
    private incomingLabel: string
  ) { super() }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'merge-conflict-actions'

    const btns = [
      { text: 'Accept Current', action: 'current', cls: 'accept-current' },
      { text: 'Accept Incoming', action: 'incoming', cls: 'accept-incoming' },
      { text: 'Accept Both', action: 'both', cls: 'accept-both' },
      { text: 'Compare', action: 'compare', cls: 'compare' }
    ]

    for (const btn of btns) {
      const el = document.createElement('span')
      el.className = `conflict-action ${btn.cls}`
      el.textContent = btn.text
      el.dataset.conflictIndex = String(this.conflictIndex)
      el.dataset.conflictAction = btn.action
      wrap.appendChild(el)

      if (btn !== btns[btns.length - 1]) {
        const sep = document.createElement('span')
        sep.className = 'conflict-separator'
        sep.textContent = ' | '
        wrap.appendChild(sep)
      }
    }

    return wrap
  }
}

// --- State ---

const setConflicts = StateEffect.define<ConflictRegion[]>()

const conflictsField = StateField.define<ConflictRegion[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setConflicts)) return e.value
    }
    return value
  }
})

// 冲突区域高亮 + 操作按钮
const conflictDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setConflicts)) {
        const regions: ConflictRegion[] = e.value
        const builder = new RangeSetBuilder<Decoration>()
        const doc = tr.state.doc

        for (const region of regions) {
          if (region.startLine > doc.lines || region.endLine > doc.lines) continue

          const startPos = doc.line(region.startLine).from

          // 操作按钮（在 <<<<<<< 行上方）
          builder.add(startPos, startPos, Decoration.widget({
            widget: new ConflictActionsWidget(region.index, region.currentLabel, region.incomingLabel),
            side: -1,
            block: true
          }))

          // <<<<<<< 行：标记
          builder.add(doc.line(region.startLine).from, doc.line(region.startLine).from,
            Decoration.line({ class: 'merge-conflict-marker-line' }))

          // Current change 高亮（<<<<<<< 到 =======之间）
          for (let l = region.startLine + 1; l < region.separatorLine; l++) {
            if (l <= doc.lines) {
              builder.add(doc.line(l).from, doc.line(l).from,
                Decoration.line({ class: 'merge-conflict-current' }))
            }
          }

          // ======= 行
          builder.add(doc.line(region.separatorLine).from, doc.line(region.separatorLine).from,
            Decoration.line({ class: 'merge-conflict-marker-line' }))

          // Incoming change 高亮（======= 到 >>>>>>>之间）
          for (let l = region.separatorLine + 1; l < region.endLine; l++) {
            if (l <= doc.lines) {
              builder.add(doc.line(l).from, doc.line(l).from,
                Decoration.line({ class: 'merge-conflict-incoming' }))
            }
          }

          // >>>>>>> 行
          builder.add(doc.line(region.endLine).from, doc.line(region.endLine).from,
            Decoration.line({ class: 'merge-conflict-marker-line' }))
        }

        return builder.finish()
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

// --- CSS ---

const mergeConflictTheme = EditorView.theme({
  '.merge-conflict-actions': {
    display: 'flex',
    gap: '0',
    padding: '2px 8px 2px 52px',
    fontSize: '12px',
    lineHeight: '20px',
    background: '#181825',
    borderBottom: '1px solid #313244'
  },
  '.conflict-action': {
    cursor: 'pointer',
    padding: '0 4px',
    borderRadius: '3px',
    color: '#89b4fa',
    '&:hover': { textDecoration: 'underline' }
  },
  '.accept-current': { color: '#a6e3a1' },
  '.accept-incoming': { color: '#89b4fa' },
  '.accept-both': { color: '#f9e2af' },
  '.compare': { color: '#a6adc8' },
  '.conflict-separator': { color: '#45475a', padding: '0 2px' },
  '.merge-conflict-marker-line': {
    background: 'rgba(108, 112, 134, 0.2)'
  },
  '.merge-conflict-current': {
    background: 'rgba(166, 227, 161, 0.12)',
    borderLeft: '2px solid rgba(166, 227, 161, 0.5)'
  },
  '.merge-conflict-incoming': {
    background: 'rgba(137, 180, 250, 0.12)',
    borderLeft: '2px solid rgba(137, 180, 250, 0.5)'
  }
})

// --- Exports ---

export function mergeConflictExtensions() {
  return [
    conflictsField,
    conflictDecorations,
    mergeConflictTheme
  ]
}

export function updateConflicts(view: EditorView, conflicts: ConflictRegion[]): void {
  view.dispatch({ effects: setConflicts.of(conflicts) })
}

// 解决冲突：替换冲突区域的内容
export function resolveConflict(
  view: EditorView,
  content: string,
  region: ConflictRegion,
  action: 'current' | 'incoming' | 'both'
): void {
  const doc = view.state.doc
  const lines = content.split('\n')

  // 提取 current 和 incoming 内容
  const currentLines: string[] = []
  const incomingLines: string[] = []

  for (let i = region.startLine; i < region.separatorLine - 1; i++) {
    currentLines.push(lines[i] ?? '')
  }
  for (let i = region.separatorLine; i < region.endLine - 1; i++) {
    incomingLines.push(lines[i] ?? '')
  }

  let replacement: string
  if (action === 'current') {
    replacement = currentLines.join('\n')
  } else if (action === 'incoming') {
    replacement = incomingLines.join('\n')
  } else {
    replacement = currentLines.join('\n') + '\n' + incomingLines.join('\n')
  }

  // 替换整个冲突区域（包括标记行）
  const from = doc.line(region.startLine).from
  const to = doc.line(region.endLine).to
  view.dispatch({ changes: { from, to, insert: replacement } })
}
