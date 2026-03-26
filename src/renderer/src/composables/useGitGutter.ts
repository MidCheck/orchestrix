import {
  EditorView,
  gutter,
  GutterMarker
} from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import type { GitDiffHunk } from '@shared/types'

// 修改行标记（gutter marker）
class DiffGutterMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'git-diff-mark'
    return el
  }
}

const diffMarker = new DiffGutterMarker()

const setDiffHunks = StateEffect.define<GitDiffHunk[]>()

const diffHunksField = StateField.define<GitDiffHunk[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffHunks)) return e.value
    }
    return value
  }
})

const diffGutter = gutter({
  class: 'cm-git-diff-gutter',
  markers(view) {
    const hunks = view.state.field(diffHunksField)
    const builder = new RangeSetBuilder<GutterMarker>()
    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lineCount; i++) {
        const lineNum = hunk.startLine + i
        if (lineNum <= view.state.doc.lines) {
          const line = view.state.doc.line(lineNum)
          builder.add(line.from, line.from, diffMarker)
        }
      }
    }
    return builder.finish()
  }
})

// CSS: 蓝色密集斜虚线（类似 VS Code 的修改标记）
const gitGutterTheme = EditorView.theme({
  '.cm-git-diff-gutter': {
    width: '4px',
    minWidth: '4px'
  },
  '.cm-git-diff-gutter .cm-gutterElement': {
    padding: '0'
  },
  '.git-diff-mark': {
    width: '4px',
    height: '100%',
    background: `repeating-linear-gradient(
      -45deg,
      #89b4fa 0px,
      #89b4fa 1px,
      transparent 1px,
      transparent 3px
    )`
  }
})

export function gitGutterExtensions() {
  return [
    diffHunksField,
    diffGutter,
    gitGutterTheme
  ]
}

export function updateDiffHunks(view: EditorView, hunks: GitDiffHunk[]): void {
  view.dispatch({ effects: setDiffHunks.of(hunks) })
}
