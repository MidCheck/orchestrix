<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { OpenFile } from '../../stores/editor'

const props = defineProps<{ file: OpenFile }>()

const hexContent = ref(props.file.hexHead || '')
const selectedOffset = ref<number | null>(null)

// 解析 hex dump 为结构化行
const hexLines = computed(() => {
  return hexContent.value.split('\n').map((line) => {
    // 格式: 00000000  48 65 6c 6c 6f 20 57 6f  72 6c 64 0a 00 00 00 00  |Hello World.....|
    const addrMatch = line.match(/^([0-9a-f]{8})/)
    const addr = addrMatch ? addrMatch[1] : ''
    const asciiMatch = line.match(/\|(.{0,16})\|$/)
    const ascii = asciiMatch ? asciiMatch[1] : ''

    // 提取 hex 字节
    const hexPart = line.substring(10, 10 + 48).trim()
    const bytes = hexPart.split(/\s+/).filter(Boolean)

    return { addr, bytes, ascii, raw: line }
  }).filter((l) => l.addr)
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function selectByte(lineIndex: number, byteIndex: number): void {
  selectedOffset.value = lineIndex * 16 + byteIndex
}

const selectedByte = computed(() => {
  if (selectedOffset.value === null) return null
  const lineIdx = Math.floor(selectedOffset.value / 16)
  const byteIdx = selectedOffset.value % 16
  const line = hexLines.value[lineIdx]
  if (!line || byteIdx >= line.bytes.length) return null
  const hex = line.bytes[byteIdx]
  const dec = parseInt(hex, 16)
  return {
    offset: `0x${selectedOffset.value.toString(16).padStart(8, '0')}`,
    hex,
    dec,
    oct: `0${dec.toString(8)}`,
    bin: dec.toString(2).padStart(8, '0'),
    char: dec >= 32 && dec <= 126 ? `'${String.fromCharCode(dec)}'` : 'N/A'
  }
})
</script>

<template>
  <div class="hex-editor">
    <!-- 工具栏 -->
    <div class="hex-toolbar">
      <span class="hex-title">Hex Editor</span>
      <span class="hex-size">{{ formatSize(file.size) }}</span>
      <span v-if="hexLines.length >= 256" class="hex-truncated">
        Showing first 4 KB of {{ formatSize(file.size) }}
      </span>
    </div>

    <!-- Hex 表格 -->
    <div class="hex-body">
      <div class="hex-table">
        <!-- 头部 -->
        <div class="hex-row header">
          <span class="hex-addr">Offset</span>
          <span class="hex-bytes">
            <span v-for="i in 16" :key="i" class="hex-col-header">{{ (i - 1).toString(16).toUpperCase().padStart(2, '0') }}</span>
          </span>
          <span class="hex-ascii">ASCII</span>
        </div>

        <!-- 数据行 -->
        <div
          v-for="(line, lineIdx) in hexLines"
          :key="lineIdx"
          class="hex-row"
        >
          <span class="hex-addr">{{ line.addr }}</span>
          <span class="hex-bytes">
            <span
              v-for="(byte, byteIdx) in line.bytes"
              :key="byteIdx"
              class="hex-byte"
              :class="{
                selected: selectedOffset === lineIdx * 16 + byteIdx,
                null: byte === '00',
                high: parseInt(byte, 16) > 127
              }"
              @click="selectByte(lineIdx, byteIdx)"
            >{{ byte }}</span>
          </span>
          <span class="hex-ascii">
            <span
              v-for="(ch, chIdx) in line.ascii.split('')"
              :key="chIdx"
              class="hex-char"
              :class="{ selected: selectedOffset === lineIdx * 16 + chIdx, dot: ch === '.' }"
              @click="selectByte(lineIdx, chIdx)"
            >{{ ch }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 选中字节详情 -->
    <div v-if="selectedByte" class="hex-status">
      <span>Offset: <b>{{ selectedByte.offset }}</b></span>
      <span>Hex: <b>{{ selectedByte.hex }}</b></span>
      <span>Dec: <b>{{ selectedByte.dec }}</b></span>
      <span>Oct: <b>{{ selectedByte.oct }}</b></span>
      <span>Bin: <b>{{ selectedByte.bin }}</b></span>
      <span>Char: <b>{{ selectedByte.char }}</b></span>
    </div>
    <div v-else class="hex-status">
      <span>Click a byte to inspect</span>
    </div>
  </div>
</template>

<style scoped>
.hex-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: Menlo, Monaco, 'Courier New', monospace;
}

.hex-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: #181825;
  border-bottom: 1px solid #313244;
  font-size: 12px;
  flex-shrink: 0;
}

.hex-title { color: #89b4fa; font-weight: 600; }
.hex-size { color: #6c7086; }
.hex-truncated { color: #f9e2af; font-size: 11px; }

.hex-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.hex-table {
  display: table;
  border-collapse: collapse;
  min-width: 100%;
}

.hex-row {
  display: flex;
  align-items: center;
  height: 22px;
  border-bottom: 1px solid rgba(49, 50, 68, 0.3);
}

.hex-row:hover { background: rgba(255, 255, 255, 0.03); }

.hex-row.header {
  position: sticky;
  top: 0;
  background: #181825;
  border-bottom: 1px solid #313244;
  z-index: 1;
  color: #6c7086;
  font-weight: 600;
  font-size: 11px;
}

.hex-addr {
  width: 80px;
  padding: 0 12px 0 8px;
  color: #6c7086;
  flex-shrink: 0;
  font-size: 12px;
}

.hex-bytes {
  display: flex;
  gap: 4px;
  padding: 0 8px;
  flex-shrink: 0;
}

.hex-col-header {
  width: 22px;
  text-align: center;
}

.hex-byte {
  width: 22px;
  text-align: center;
  font-size: 12px;
  cursor: pointer;
  border-radius: 2px;
  color: #cdd6f4;
}

.hex-byte:hover { background: rgba(137, 180, 250, 0.15); }
.hex-byte.selected { background: #89b4fa; color: #1e1e2e; }
.hex-byte.null { color: #45475a; }
.hex-byte.high { color: #f9e2af; }

.hex-ascii {
  padding: 0 8px;
  font-size: 12px;
  letter-spacing: 1px;
  color: #a6adc8;
  border-left: 1px solid #313244;
}

.hex-char {
  cursor: pointer;
}

.hex-char.selected { background: #89b4fa; color: #1e1e2e; border-radius: 2px; }
.hex-char.dot { color: #45475a; }

.hex-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 12px;
  background: #181825;
  border-top: 1px solid #313244;
  font-size: 11px;
  color: #6c7086;
  flex-shrink: 0;
}

.hex-status b { color: #cdd6f4; }
</style>
