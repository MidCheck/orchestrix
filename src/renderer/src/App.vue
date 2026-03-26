<script setup lang="ts">
import { onMounted } from 'vue'
import AppLayout from './components/layout/AppLayout.vue'
import { useWorkspaceStore } from './stores/workspace'
import { useAgentStore } from './stores/agent'
import { useUIStore } from './stores/ui'

const workspaceStore = useWorkspaceStore()
const agentStore = useAgentStore()
const uiStore = useUIStore()

onMounted(async () => {
  // 加载初始数据
  await workspaceStore.loadProjects()
  await agentStore.refresh()

  // 监听 Agent 状态变更
  window.electronAPI.agent.onStatus((agent) => {
    agentStore.updateAgent(agent)
  })
})
</script>

<template>
  <AppLayout />
</template>

<style>
@import '@xterm/xterm/css/xterm.css';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #1e1e2e;
}
</style>
