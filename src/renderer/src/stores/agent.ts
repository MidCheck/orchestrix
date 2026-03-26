import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentInfo, AgentConfig } from '@shared/types'

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<AgentInfo[]>([])

  async function spawn(config: AgentConfig): Promise<AgentInfo> {
    const agent = await window.electronAPI.agent.spawn(config)
    agents.value.push(agent)
    return agent
  }

  async function kill(agentId: string): Promise<void> {
    await window.electronAPI.agent.kill(agentId)
    agents.value = agents.value.filter((a) => a.id !== agentId)
  }

  async function refresh(): Promise<void> {
    agents.value = await window.electronAPI.agent.list()
  }

  function updateAgent(updated: AgentInfo): void {
    const index = agents.value.findIndex((a) => a.id === updated.id)
    if (index !== -1) {
      agents.value[index] = updated
    }
  }

  return { agents, spawn, kill, refresh, updateAgent }
})
