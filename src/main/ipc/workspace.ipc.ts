import { ipcMain, dialog, BrowserWindow } from 'electron'
import { watch as fsWatch, type FSWatcher } from 'fs'
import { readFile as fsReadFile } from 'fs/promises'
import { IPC } from '@shared/constants'
import type { WorkspaceManager } from '../managers/workspace-manager'

export function registerWorkspaceIPC(workspaceManager: WorkspaceManager): void {
  // 获取项目列表
  ipcMain.handle(IPC.WORKSPACE_LIST, () => {
    return workspaceManager.listProjects()
  })

  // 添加项目（打开文件夹选择对话框）
  ipcMain.handle(IPC.WORKSPACE_ADD, async (_event, projectPath?: string) => {
    let targetPath = projectPath

    if (!targetPath) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Project Directory'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      targetPath = result.filePaths[0]
    }

    return workspaceManager.addProject(targetPath)
  })

  // 移除项目
  ipcMain.handle(IPC.WORKSPACE_REMOVE, (_event, id: string) => {
    return workspaceManager.removeProject(id)
  })

  // 读取文件树
  ipcMain.handle(IPC.WORKSPACE_FILES, async (_event, dirPath: string) => {
    return await workspaceManager.readDirectory(dirPath)
  })

  // 读取文件内容
  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) => {
    return await workspaceManager.readFile(filePath)
  })

  // 写入文件内容
  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    await workspaceManager.writeFile(filePath, content)
  })

  // 新建文件
  ipcMain.handle(IPC.FILE_CREATE, async (_event, filePath: string) => {
    await workspaceManager.createFile(filePath)
  })

  // 删除文件/目录
  ipcMain.handle(IPC.FILE_DELETE, async (_event, filePath: string) => {
    await workspaceManager.deleteFile(filePath)
  })

  // 重命名/移动
  ipcMain.handle(IPC.FILE_RENAME, async (_event, oldPath: string, newPath: string) => {
    await workspaceManager.renameFile(oldPath, newPath)
  })

  // 新建目录
  ipcMain.handle(IPC.FILE_MKDIR, async (_event, dirPath: string) => {
    await workspaceManager.createDirectory(dirPath)
  })

  // 文件监听
  const watchers = new Map<string, FSWatcher>()

  ipcMain.handle(IPC.FILE_WATCH, (_event, filePath: string) => {
    if (watchers.has(filePath)) return
    try {
      const watcher = fsWatch(filePath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.FILE_CHANGED, filePath)
            }
          }
        }
      })
      watchers.set(filePath, watcher)
    } catch { /* ignore */ }
  })

  // 读取二进制文件（返回 hex dump）
  ipcMain.handle(IPC.FILE_READ_BINARY, async (_event, filePath: string, offset?: number, length?: number) => {
    const buf = await fsReadFile(filePath)
    const start = offset || 0
    const end = length ? start + length : buf.length
    const slice = buf.slice(start, end)
    return (workspaceManager as any).formatHexDump(slice)
  })

  // Git: 是否 git 仓库
  ipcMain.handle(IPC.GIT_IS_REPO, async (_event, dirPath: string) => {
    return await workspaceManager.isGitRepo(dirPath)
  })

  // Git: 获取文件状态
  ipcMain.handle(IPC.GIT_STATUS, async (_event, projectPath: string) => {
    return await workspaceManager.getGitStatus(projectPath)
  })

  // Git: 获取文件的 HEAD 版本内容
  ipcMain.handle(IPC.GIT_SHOW, async (_event, projectPath: string, filePath: string, ref?: string) => {
    return await workspaceManager.gitShowFile(projectPath, filePath, ref)
  })

  // Git: blame
  ipcMain.handle(IPC.GIT_BLAME, async (_event, projectPath: string, filePath: string) => {
    return await workspaceManager.gitBlame(projectPath, filePath)
  })

  // Git: diff 修改行
  ipcMain.handle(IPC.GIT_DIFF_LINES, async (_event, projectPath: string, filePath: string) => {
    return await workspaceManager.gitDiffLines(projectPath, filePath)
  })
}
