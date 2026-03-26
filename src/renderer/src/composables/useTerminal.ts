import { onBeforeUnmount, ref, nextTick, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export function useTerminal(
  containerRef: Ref<HTMLElement | null>,
  terminalId: string,
  cwd?: string
) {
  const terminal = ref<Terminal | null>(null)
  const fitAddon = ref<FitAddon | null>(null)
  const ready = ref(false)
  let cleanupOutput: (() => void) | null = null
  let resizeObserver: ResizeObserver | null = null

  async function init(): Promise<void> {
    // 等待 DOM 渲染完成
    await nextTick()

    const el = containerRef.value
    if (!el) {
      console.error('[useTerminal] container element not found')
      return
    }

    const term = new Terminal({
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de'
      },
      cursorBlink: true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    terminal.value = term
    fitAddon.value = fit

    // 需要等一帧让 DOM 完成布局才能 fit
    await nextTick()
    requestAnimationFrame(() => {
      fit.fit()
    })

    // 先注册输出监听，再创建 PTY，避免丢失初始输出
    cleanupOutput = window.electronAPI.terminal.onOutput(({ id, data }) => {
      if (id === terminalId && terminal.value) {
        try {
          terminal.value.write(data)
        } catch {
          // terminal 已销毁，忽略
        }
      }
    })

    // 创建 PTY 会话
    try {
      await window.electronAPI.terminal.create({
        id: terminalId,
        cols: term.cols || 80,
        rows: term.rows || 24,
        cwd
      })
      ready.value = true
    } catch (err) {
      console.error('[useTerminal] Failed to create PTY:', err)
      term.writeln('\r\n\x1b[31mFailed to create terminal session\x1b[0m')
      return
    }

    // 用户输入 -> PTY
    term.onData((data) => {
      if (ready.value) {
        window.electronAPI.terminal.write(terminalId, data)
      }
    })

    // 监听容器尺寸变化
    resizeObserver = new ResizeObserver(() => {
      if (!terminal.value || !fitAddon.value) return
      try {
        fitAddon.value.fit()
        if (ready.value) {
          window.electronAPI.terminal.resize({
            id: terminalId,
            cols: terminal.value.cols,
            rows: terminal.value.rows
          })
        }
      } catch {
        // 忽略 resize 异常
      }
    })
    resizeObserver.observe(el)
  }

  function dispose(): void {
    cleanupOutput?.()
    cleanupOutput = null
    resizeObserver?.disconnect()
    resizeObserver = null
    if (ready.value) {
      window.electronAPI.terminal.destroy(terminalId)
      ready.value = false
    }
    terminal.value?.dispose()
    terminal.value = null
  }

  onBeforeUnmount(dispose)

  return { terminal, fitAddon, ready, init, dispose }
}
