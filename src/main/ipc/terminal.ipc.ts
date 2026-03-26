import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'
import type { TerminalManager } from '../managers/terminal-manager'
import type { TerminalCreateOptions, TerminalResizeData } from '@shared/types'

export function registerTerminalIPC(terminalManager: TerminalManager): void {
  ipcMain.handle(IPC.TERMINAL_CREATE, async (_event, options: TerminalCreateOptions) => {
    return await terminalManager.create(options)
  })

  ipcMain.on(IPC.TERMINAL_INPUT, (_event, { id, data }: { id: string; data: string }) => {
    terminalManager.write(id, data)
  })

  ipcMain.on(IPC.TERMINAL_RESIZE, (_event, data: TerminalResizeData) => {
    terminalManager.resize(data)
  })

  ipcMain.on(IPC.TERMINAL_DESTROY, (_event, id: string) => {
    terminalManager.destroy(id)
  })

  // 终端输出 -> 广播到所有窗口
  terminalManager.onData((terminalId, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERMINAL_OUTPUT, { id: terminalId, data })
      }
    }
  })
}
