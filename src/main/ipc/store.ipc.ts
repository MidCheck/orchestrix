import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'

export function registerStoreIPC(): void {
  // Renderer 发来的 store 变更 -> 广播到其他窗口
  ipcMain.on(IPC.STORE_SYNC, (event, storeId: string, state: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)

    for (const win of BrowserWindow.getAllWindows()) {
      if (win !== sourceWindow && !win.isDestroyed()) {
        win.webContents.send(IPC.STORE_SYNC_BROADCAST, storeId, state)
      }
    }
  })
}
