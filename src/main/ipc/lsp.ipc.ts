import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'
import type { LspManager } from '../managers/lsp-manager'

export function registerLspIPC(lspManager: LspManager): void {
  ipcMain.handle(IPC.LSP_STATUS, () => lspManager.getStatus())

  ipcMain.handle(IPC.LSP_INSTALL, async (_event, serverId: string) =>
    await lspManager.install(serverId))

  ipcMain.handle(IPC.LSP_IMPORT, async (_event, serverId: string) =>
    await lspManager.importFromLocal(serverId))

  // 一站式：启动 + initialize + initialized + didOpen，全在 Main 进程完成
  ipcMain.handle('lsp:auto-init', async (_event, serverId: string, projectPath: string, filePath: string, languageId: string, content: string) => {
    const started = lspManager.start(serverId, projectPath)
    if (!started) return false
    lspManager.setNotificationHandler(serverId, projectPath, (method, params) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.LSP_EVENT, serverId, projectPath, JSON.stringify({ method, params }))
      }
    })
    const initResp = await lspManager.sendRequest(serverId, projectPath, 'initialize', {
      processId: process.pid,
      rootUri: `file://${projectPath}`,
      capabilities: { textDocument: { definition: { linkSupport: true }, hover: { contentFormat: ['markdown', 'plaintext'] }, publishDiagnostics: { relatedInformation: true }, completion: { completionItem: { snippetSupport: true } }, references: {}, signatureHelp: {} }, workspace: { workspaceFolders: true } },
      workspaceFolders: [{ uri: `file://${projectPath}`, name: projectPath.split('/').pop() || '' }]
    }, 1)
    if (!initResp?.result) return false
    lspManager.sendNotification(serverId, projectPath, 'initialized', {})
    await new Promise(r => setTimeout(r, 1500))
    lspManager.sendNotification(serverId, projectPath, 'textDocument/didOpen', {
      textDocument: { uri: `file://${filePath}`, languageId, version: 1, text: content }
    })
    return true
  })

  ipcMain.handle(IPC.LSP_START, (_event, serverId: string, projectPath: string) => {
    const started = lspManager.start(serverId, projectPath)
    if (started) {
      // 设置通知转发到 Renderer
      lspManager.setNotificationHandler(serverId, projectPath, (method, params) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.LSP_EVENT, serverId, projectPath, JSON.stringify({ method, params }))
          }
        }
      })
    }
    return started
  })

  ipcMain.handle(IPC.LSP_STOP, (_event, serverId: string, projectPath: string) =>
    lspManager.stop(serverId, projectPath))

  ipcMain.handle('lsp:debug-log', (_event, serverId: string, projectPath: string) =>
    lspManager.getMessageLog(serverId, projectPath))

  // JSON-RPC request（等待 response）
  ipcMain.handle(IPC.LSP_REQUEST, async (_event, serverId: string, projectPath: string, id: number, method: string, params: any) =>
    await lspManager.sendRequest(serverId, projectPath, method, params, id))

  // JSON-RPC notification
  ipcMain.handle(IPC.LSP_NOTIFY, (_event, serverId: string, projectPath: string, method: string, params: any) => {
    lspManager.sendNotification(serverId, projectPath, method, params)
  })
}
