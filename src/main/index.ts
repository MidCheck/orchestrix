import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerTerminalIPC } from './ipc/terminal.ipc'
import { registerWorkspaceIPC } from './ipc/workspace.ipc'
import { registerAgentIPC } from './ipc/agent.ipc'
import { registerStoreIPC } from './ipc/store.ipc'
import { registerLspIPC } from './ipc/lsp.ipc'
import { TerminalManager } from './managers/terminal-manager'
import { WorkspaceManager } from './managers/workspace-manager'
import { AgentManager } from './managers/agent-manager'
import { LspManager } from './managers/lsp-manager'

let mainWindow: BrowserWindow | null = null

const terminalManager = new TerminalManager()
const workspaceManager = new WorkspaceManager()
const agentManager = new AgentManager(terminalManager)
const lspManager = new LspManager()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Orchestrix',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (is.dev) {
      mainWindow!.webContents.openDevTools({ mode: 'bottom' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 注册 IPC handlers
  registerTerminalIPC(terminalManager)
  registerWorkspaceIPC(workspaceManager)
  registerAgentIPC(agentManager)
  registerStoreIPC()
  registerLspIPC(lspManager)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 清理所有终端会话
  terminalManager.destroyAll()
  agentManager.killAll()
  lspManager.stopAll()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
