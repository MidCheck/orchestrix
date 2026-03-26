import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/constants'
import type {
  TerminalCreateOptions,
  TerminalResizeData,
  AgentConfig,
  AgentInfo,
  Project,
  FileEntry,
  FileReadResult,
  GitStatusMap,
  GitBlameLine,
  GitDiffHunk
} from '@shared/types'

// 暴露给 Renderer 的 API
const electronAPI = {
  // Terminal
  terminal: {
    create: (options: TerminalCreateOptions): Promise<{ pid: number }> =>
      ipcRenderer.invoke(IPC.TERMINAL_CREATE, options),

    write: (id: string, data: string): void =>
      ipcRenderer.send(IPC.TERMINAL_INPUT, { id, data }),

    resize: (data: TerminalResizeData): void =>
      ipcRenderer.send(IPC.TERMINAL_RESIZE, data),

    destroy: (id: string): void =>
      ipcRenderer.send(IPC.TERMINAL_DESTROY, id),

    onOutput: (callback: (data: { id: string; data: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; data: string }): void => {
        callback(data)
      }
      ipcRenderer.on(IPC.TERMINAL_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT, handler)
    },

    onNotify: (callback: (data: { terminalId: string; name: string; message: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; name: string; message: string }): void => {
        callback(data)
      }
      ipcRenderer.on(IPC.TERMINAL_NOTIFY, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_NOTIFY, handler)
    }
  },

  // Workspace
  workspace: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke(IPC.WORKSPACE_LIST),

    add: (projectPath?: string): Promise<Project | null> =>
      ipcRenderer.invoke(IPC.WORKSPACE_ADD, projectPath),

    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WORKSPACE_REMOVE, id),

    readDir: (dirPath: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke(IPC.WORKSPACE_FILES, dirPath),

    readFile: (filePath: string): Promise<FileReadResult> =>
      ipcRenderer.invoke(IPC.FILE_READ, filePath),

    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_WRITE, filePath, content),

    readBinary: (filePath: string, offset?: number, length?: number): Promise<string> =>
      ipcRenderer.invoke(IPC.FILE_READ_BINARY, filePath, offset, length),

    createFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_CREATE, filePath),

    deleteFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_DELETE, filePath),

    renameFile: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_RENAME, oldPath, newPath),

    createDir: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_MKDIR, dirPath),

    isGitRepo: (dirPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.GIT_IS_REPO, dirPath),

    gitStatus: (projectPath: string): Promise<GitStatusMap> =>
      ipcRenderer.invoke(IPC.GIT_STATUS, projectPath),

    gitShow: (projectPath: string, filePath: string, ref?: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_SHOW, projectPath, filePath, ref),

    gitBlame: (projectPath: string, filePath: string): Promise<GitBlameLine[]> =>
      ipcRenderer.invoke(IPC.GIT_BLAME, projectPath, filePath),

    gitDiffLines: (projectPath: string, filePath: string): Promise<GitDiffHunk[]> =>
      ipcRenderer.invoke(IPC.GIT_DIFF_LINES, projectPath, filePath)
  },

  // Agent
  agent: {
    spawn: (config: AgentConfig): Promise<AgentInfo> =>
      ipcRenderer.invoke(IPC.AGENT_SPAWN, config),

    kill: (agentId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.AGENT_KILL, agentId),

    list: (): Promise<AgentInfo[]> =>
      ipcRenderer.invoke(IPC.AGENT_LIST),

    onStatus: (callback: (agent: AgentInfo) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agent: AgentInfo): void => {
        callback(agent)
      }
      ipcRenderer.on(IPC.AGENT_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_STATUS, handler)
    }
  },

  // Store 同步
  store: {
    sync: (storeId: string, state: unknown): void =>
      ipcRenderer.send(IPC.STORE_SYNC, storeId, state),

    onSync: (callback: (storeId: string, state: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, storeId: string, state: unknown): void => {
        callback(storeId, state)
      }
      ipcRenderer.on(IPC.STORE_SYNC_BROADCAST, handler)
      return () => ipcRenderer.removeListener(IPC.STORE_SYNC_BROADCAST, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
