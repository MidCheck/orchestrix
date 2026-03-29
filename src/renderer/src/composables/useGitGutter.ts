import {
  EditorView,
  gutter,
  GutterMarker
} from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'

// VS Code 风格的 change 类型
export interface GutterChange {
  type: 'added' | 'modified' | 'deleted'
  modifiedStartLine: number  // 1-based; deleted 类型标记在此行之后
  modifiedEndLine: number    // 1-based; deleted 类型为 0
}

// --- Gutter Markers ---

class AddedMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'git-gutter-added'
    return el
  }
}

class ModifiedMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'git-gutter-modified'
    return el
  }
}

class DeletedMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'git-gutter-deleted'
    return el
  }
}

const addedMarker = new AddedMarker()
const modifiedMarker = new ModifiedMarker()
const deletedMarker = new DeletedMarker()

// --- State ---

const setGutterChanges = StateEffect.define<GutterChange[]>()

const gutterChangesField = StateField.define<GutterChange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGutterChanges)) return e.value
    }
    return value
  }
})

const diffGutter = gutter({
  class: 'cm-git-diff-gutter',
  markers(view) {
    const changes = view.state.field(gutterChangesField)
    const builder = new RangeSetBuilder<GutterMarker>()
    const doc = view.state.doc

    // 按行号排序（RangeSetBuilder 要求 sorted）
    const sorted = [...changes].sort((a, b) => a.modifiedStartLine - b.modifiedStartLine)

    for (const change of sorted) {
      if (change.type === 'deleted') {
        // 红三角：标记在 modifiedStartLine 行尾（如果该行存在）
        const lineNum = Math.min(change.modifiedStartLine, doc.lines)
        if (lineNum > 0) {
          const line = doc.line(lineNum)
          builder.add(line.from, line.from, deletedMarker)
        }
      } else {
        const marker = change.type === 'added' ? addedMarker : modifiedMarker
        for (let l = change.modifiedStartLine; l <= change.modifiedEndLine; l++) {
          if (l > 0 && l <= doc.lines) {
            const line = doc.line(l)
            builder.add(line.from, line.from, marker)
          }
        }
      }
    }
    return builder.finish()
  }
})

// --- CSS Theme ---

const gitGutterTheme = EditorView.theme({
  '.cm-git-diff-gutter': {
    width: '4px',
    minWidth: '4px'
  },
  '.cm-git-diff-gutter .cm-gutterElement': {
    padding: '0'
  },
  // 绿色实线条 — 新增行
  '.git-gutter-added': {
    width: '4px',
    height: '100%',
    background: '#a6e3a1'
  },
  // 蓝色实线条 — 修改行
  '.git-gutter-modified': {
    width: '4px',
    height: '100%',
    background: '#89b4fa'
  },
  // 红色三角形 — 删除行（CSS border trick，放在 gutter element 顶部）
  '.git-gutter-deleted': {
    width: '0',
    height: '0',
    position: 'relative',
    top: '-2px',
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
    borderBottom: '5px solid #f38ba8'
  }
})

// --- Exports ---

export function gitGutterExtensions() {
  return [
    gutterChangesField,
    diffGutter,
    gitGutterTheme
  ]
}

export function updateGutterChanges(view: EditorView, changes: GutterChange[]): void {
  view.dispatch({ effects: setGutterChanges.of(changes) })
}
