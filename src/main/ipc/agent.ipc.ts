import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'
import type { AgentManager } from '../managers/agent-manager'
import type { AgentConfig } from '@shared/types'

export function registerAgentIPC(agentManager: AgentManager): void {
  // 启动 Agent
  ipcMain.handle(IPC.AGENT_SPAWN, async (_event, config: AgentConfig) => {
    return await agentManager.spawn(config)
  })

  // 停止 Agent
  ipcMain.handle(IPC.AGENT_KILL, (_event, agentId: string) => {
    return agentManager.kill(agentId)
  })

  // 获取 Agent 列表
  ipcMain.handle(IPC.AGENT_LIST, () => {
    return agentManager.listAgents()
  })

  // Agent 状态变更 -> 广播到所有窗口
  agentManager.onStatusChange((agent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.AGENT_STATUS, agent)
      }
    }
  })
}
