<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTerminal } from '../../composables/useTerminal'

const props = defineProps<{
  terminalId: string
  cwd?: string
}>()

const containerRef = ref<HTMLElement | null>(null)
const { init } = useTerminal(containerRef, props.terminalId, props.cwd)

onMounted(() => {
  init()
})
</script>

<template>
  <div class="terminal-pane-wrapper">
    <div ref="containerRef" class="terminal-container" />
  </div>
</template>

<style scoped>
.terminal-pane-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.terminal-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px;
}

.terminal-container :deep(.xterm) {
  height: 100%;
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
