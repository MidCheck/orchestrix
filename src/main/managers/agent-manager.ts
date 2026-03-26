import type { AgentConfig, AgentInfo, AgentStatus } from '@shared/types'
import type { TerminalManager } from './terminal-manager'
import { randomUUID } from 'crypto'

export class AgentManager {
  private agents: Map<string, AgentInfo> = new Map()
  private statusCallbacks: Array<(agent: AgentInfo) => void> = []

  constructor(private terminalManager: TerminalManager) {}

  onStatusChange(callback: (agent: AgentInfo) => void): void {
    this.statusCallbacks.push(callback)
  }

  private emitStatus(agent: AgentInfo): void {
    for (const cb of this.statusCallbacks) {
      cb(agent)
    }
  }

  async spawn(config: AgentConfig): Promise<AgentInfo> {
    const terminalId = `term-${randomUUID()}`

    // 先创建 PTY 会话
    await this.terminalManager.create({
      id: terminalId,
      cwd: config.projectPath
    })

    const agent: AgentInfo = {
      id: config.id || randomUUID(),
      name: config.name,
      cli: config.cli,
      projectPath: config.projectPath,
      worktreePath: config.worktreePath,
      status: 'running',
      terminalId,
      createdAt: Date.now()
    }

    this.agents.set(agent.id, agent)

    // 在终端中启动 AI CLI 命令
    this.terminalManager.write(terminalId, `${config.cli}\n`)

    this.emitStatus(agent)
    return agent
  }

  kill(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    this.terminalManager.destroy(agent.terminalId)

    agent.status = 'idle'
    this.emitStatus(agent)
    this.agents.delete(agentId)
    return true
  }

  killAll(): void {
    for (const [id] of this.agents) {
      this.kill(id)
    }
  }

  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId)
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values())
  }

  updateStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.status = status
      this.emitStatus(agent)
    }
  }
}
