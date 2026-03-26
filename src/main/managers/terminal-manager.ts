import type { TerminalCreateOptions, TerminalResizeData } from '@shared/types'

// node-pty 类型（运行时动态加载）
interface IPty {
  pid: number
  cols: number
  rows: number
  onData: (callback: (data: string) => void) => { dispose: () => void }
  onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

type OnDataCallback = (terminalId: string, data: string) => void
type OnExitCallback = (terminalId: string, exitCode: number) => void

export class TerminalManager {
  private sessions: Map<string, IPty> = new Map()
  private onDataCallbacks: OnDataCallback[] = []
  private onExitCallbacks: OnExitCallback[] = []

  onData(callback: OnDataCallback): void {
    this.onDataCallbacks.push(callback)
  }

  onExit(callback: OnExitCallback): void {
    this.onExitCallbacks.push(callback)
  }

  async create(options: TerminalCreateOptions): Promise<{ pid: number }> {
    // 动态加载 node-pty（native addon）
    const pty = await import('node-pty')

    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || process.env.HOME || '/',
      env: process.env as Record<string, string>
    })

    this.sessions.set(options.id, ptyProcess)

    ptyProcess.onData((data: string) => {
      for (const cb of this.onDataCallbacks) {
        cb(options.id, data)
      }
    })

    ptyProcess.onExit((e: { exitCode: number }) => {
      for (const cb of this.onExitCallbacks) {
        cb(options.id, e.exitCode)
      }
      this.sessions.delete(options.id)
    })

    return { pid: ptyProcess.pid }
  }

  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId)
    if (session) {
      session.write(data)
    }
  }

  resize(data: TerminalResizeData): void {
    const session = this.sessions.get(data.id)
    if (session) {
      session.resize(data.cols, data.rows)
    }
  }

  destroy(terminalId: string): void {
    const session = this.sessions.get(terminalId)
    if (session) {
      session.kill()
      this.sessions.delete(terminalId)
    }
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id)
    }
  }

  has(terminalId: string): boolean {
    return this.sessions.has(terminalId)
  }
}
