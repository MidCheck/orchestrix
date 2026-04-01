import { app, dialog } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, statSync } from 'fs'
import { cp } from 'fs/promises'

export interface LspServerInfo {
  id: string
  name: string
  languages: string[]
  installed: boolean
  running: boolean
}

interface LspInstance {
  process: ChildProcess
  serverId: string
  projectPath: string
  pendingRequests: Map<number, { resolve: (msg: any) => void; timer: ReturnType<typeof setTimeout> }>
  notificationHandler: ((method: string, params: any) => void) | null
  buffer: Buffer
  messageLog: string[]
}

export class LspManager {
  private lspDir: string
  private instances: Map<string, LspInstance> = new Map()

  constructor() {
    this.lspDir = join(app.getPath('userData'), 'lsp')
    mkdirSync(this.lspDir, { recursive: true })
  }

  private servers = [
    {
      id: 'pyright',
      name: 'Pyright (Python)',
      languages: ['python'],
      npmPackage: 'pyright',
      checkInstalled: (dir: string) =>
        existsSync(join(dir, 'pyright', 'node_modules', 'pyright', 'langserver.index.js')),
      command: (dir: string) => {
        const js = join(dir, 'pyright', 'node_modules', 'pyright', 'langserver.index.js')
        if (!existsSync(js)) return null
        // 用系统 node 运行 pyright（Electron binary 的 stdio 行为不同）
        const nodePaths = process.platform === 'win32'
          ? ['node.exe']
          : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', 'node']
        let nodePath = 'node'
        for (const p of nodePaths) {
          if (p === 'node' || existsSync(p)) { nodePath = p; break }
        }
        return { cmd: nodePath, args: [js, '--stdio'] }
      }
    }
  ]

  getStatus(): LspServerInfo[] {
    return this.servers.map((s) => ({
      id: s.id,
      name: s.name,
      languages: s.languages,
      installed: s.checkInstalled(this.lspDir),
      running: Array.from(this.instances.values()).some((i) => i.serverId === s.id)
    }))
  }

  async install(serverId: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.find((s) => s.id === serverId)
    if (!server) return { success: false, error: 'Unknown server' }
    const installDir = join(this.lspDir, serverId)
    mkdirSync(installDir, { recursive: true })

    return new Promise((resolve) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(npmCmd, ['install', '--prefix', installDir, server.npmPackage || serverId], {
        cwd: installDir,
        env: { ...process.env, HOME: app.getPath('home') },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      child.stderr?.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => {
        resolve(code === 0 && server.checkInstalled(this.lspDir)
          ? { success: true }
          : { success: false, error: stderr || `Exit code ${code}` })
      })
      child.on('error', (err) => resolve({ success: false, error: err.message }))
      setTimeout(() => { child.kill(); resolve({ success: false, error: 'Timeout 120s' }) }, 120000)
    })
  }

  async importFromLocal(serverId: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.find((s) => s.id === serverId)
    if (!server) return { success: false, error: 'Unknown server' }

    const result = await dialog.showOpenDialog({
      title: `Import ${server.name}`,
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'npm package', extensions: ['tgz'] }, { name: 'All', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePaths.length) return { success: false, error: 'Cancelled' }

    const source = result.filePaths[0]
    const installDir = join(this.lspDir, serverId)
    mkdirSync(installDir, { recursive: true })

    if (statSync(source).isDirectory()) {
      // 检查目录结构
      for (const sub of [join(source, 'node_modules', 'pyright'), join(source, 'pyright'), source]) {
        if (existsSync(join(sub, 'dist', 'pyright-langserver.js'))) {
          const target = join(installDir, 'node_modules', 'pyright')
          mkdirSync(join(installDir, 'node_modules'), { recursive: true })
          await cp(sub, target, { recursive: true })
          if (server.checkInstalled(this.lspDir)) return { success: true }
        }
      }
      await cp(source, installDir, { recursive: true })
      return server.checkInstalled(this.lspDir)
        ? { success: true }
        : { success: false, error: 'Invalid directory structure' }
    }

    // tgz
    return new Promise((resolve) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(npmCmd, ['install', '--prefix', installDir, source], {
        cwd: installDir, stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      child.stderr?.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => {
        resolve(code === 0 && server.checkInstalled(this.lspDir)
          ? { success: true }
          : { success: false, error: stderr || `Failed code ${code}` })
      })
      child.on('error', (err) => resolve({ success: false, error: err.message }))
    })
  }

  // --- 启动 LSP（带 JSON-RPC 消息解析）---

  start(serverId: string, projectPath: string): boolean {
    const key = `${projectPath}:${serverId}`
    if (this.instances.has(key)) return true

    const server = this.servers.find((s) => s.id === serverId)
    if (!server || !server.checkInstalled(this.lspDir)) return false
    const cmd = server.command(this.lspDir)
    if (!cmd) return false

    // 不传 env —— 继承父进程环境但避免 Electron 特有变量干扰
    const cleanEnv = { ...process.env }
    delete cleanEnv['ELECTRON_RUN_AS_NODE']
    delete cleanEnv['ELECTRON_NO_ASAR']
    const child = spawn(cmd.cmd, cmd.args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv
    })

    const instance: LspInstance = {
      process: child,
      serverId,
      projectPath,
      pendingRequests: new Map(),
      notificationHandler: null,
      buffer: Buffer.alloc(0),
      messageLog: []
    }

    // 设置 stdout JSON-RPC 消息解析
    child.stdout!.on('data', (data: Buffer) => {
      instance.buffer = Buffer.concat([instance.buffer, data])
      this.parseMessages(instance)
    })

    child.on('exit', () => { this.instances.delete(key) })
    child.stderr?.on('data', () => {}) // 防止 stderr 堵塞

    this.instances.set(key, instance)
    return true
  }

  private parseMessages(instance: LspInstance): void {
    const SEPARATOR = Buffer.from('\r\n\r\n')
    while (true) {
      const headerEnd = instance.buffer.indexOf(SEPARATOR)
      if (headerEnd === -1) break
      const header = instance.buffer.slice(0, headerEnd).toString('ascii')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) { instance.buffer = instance.buffer.slice(headerEnd + 4); continue }
      const len = parseInt(match[1])
      const bodyStart = headerEnd + 4
      if (instance.buffer.length < bodyStart + len) break // 字节数不够
      const body = instance.buffer.slice(bodyStart, bodyStart + len).toString('utf-8')
      instance.buffer = instance.buffer.slice(bodyStart + len)

      try {
        const msg = JSON.parse(body)
        // 日志（更详细）
        const logEntry = `id=${msg.id ?? '-'} method=${msg.method ?? '-'} hasResult=${!!msg.result} hasError=${!!msg.error} resultType=${typeof msg.result === 'object' ? (Array.isArray(msg.result) ? 'array['+msg.result.length+']' : 'object') : typeof msg.result}`
        instance.messageLog.push(logEntry)
        if (instance.messageLog.length > 30) instance.messageLog.shift()

        if (msg.id !== undefined && msg.id !== null && !msg.method) {
          // Response to our request
          const pending = instance.pendingRequests.get(msg.id)
          if (pending) {
            clearTimeout(pending.timer)
            instance.pendingRequests.delete(msg.id)
            pending.resolve(msg)
          }
        } else if (msg.id !== undefined && msg.method) {
          // Server→Client request — 必须回应
          const response = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null })
          const respBuf = Buffer.from(response, 'utf-8')
          instance.process.stdin?.write(`Content-Length: ${respBuf.length}\r\n\r\n${response}`)
        }
        if (msg.method && instance.notificationHandler) {
          instance.notificationHandler(msg.method, msg.params)
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // --- JSON-RPC 通信 ---

  async sendRequest(serverId: string, projectPath: string, method: string, params: any, id: number): Promise<any> {
    const key = `${projectPath}:${serverId}`
    const instance = this.instances.get(key)
    if (!instance || !instance.process.stdin) return null

    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    const content = Buffer.from(message, 'utf-8')
    instance.process.stdin.write(`Content-Length: ${content.length}\r\n\r\n${message}`)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        instance.pendingRequests.delete(id)
        resolve(null)
      }, 15000)
      instance.pendingRequests.set(id, { resolve, timer })
    })
  }

  sendNotification(serverId: string, projectPath: string, method: string, params: any): void {
    const key = `${projectPath}:${serverId}`
    const instance = this.instances.get(key)
    if (!instance || !instance.process.stdin) {
      console.log(`[LSP] sendNotification: no instance for ${key}`)
      return
    }

    const message = JSON.stringify({ jsonrpc: '2.0', method, params })
    const content = Buffer.from(message, 'utf-8')
    const ok = instance.process.stdin.write(`Content-Length: ${content.length}\r\n\r\n${message}`)
    console.log(`[LSP] sendNotification ${method}: write=${ok} bytes=${content.length}`)
  }

  setNotificationHandler(serverId: string, projectPath: string, handler: (method: string, params: any) => void): void {
    const key = `${projectPath}:${serverId}`
    const instance = this.instances.get(key)
    if (instance) instance.notificationHandler = handler
  }

  stop(serverId: string, projectPath: string): void {
    const key = `${projectPath}:${serverId}`
    const instance = this.instances.get(key)
    if (instance) { instance.process.kill(); this.instances.delete(key) }
  }

  stopAll(): void {
    for (const [, instance] of this.instances) instance.process.kill()
    this.instances.clear()
  }

  getMessageLog(serverId: string, projectPath: string): string[] {
    const key = `${projectPath}:${serverId}`
    return this.instances.get(key)?.messageLog || []
  }

  getServerForLanguage(language: string) {
    return this.servers.find((s) => s.languages.includes(language))
  }
}
