<script setup lang="ts">
import { computed } from 'vue'
import type { OpenFile } from '../../stores/editor'

const props = defineProps<{ file: OpenFile }>()

const fileUrl = computed(() => props.file.content)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="media-preview">
    <!-- 图片 -->
    <div v-if="file.kind === 'image'" class="preview-container">
      <img v-if="fileUrl" :src="fileUrl" :alt="file.name" class="preview-image" />
      <div v-else class="too-large">File too large to preview ({{ formatSize(file.size) }})</div>
    </div>

    <!-- 视频 -->
    <div v-else-if="file.kind === 'video'" class="preview-container">
      <video :src="fileUrl" controls class="preview-video" />
    </div>

    <!-- 音频 -->
    <div v-else-if="file.kind === 'audio'" class="preview-container audio">
      <div class="audio-icon">♫</div>
      <div class="audio-name">{{ file.name }}</div>
      <audio :src="fileUrl" controls class="preview-audio" />
    </div>

    <!-- 文件信息 -->
    <div class="file-info">
      <span>{{ file.name }}</span>
      <span class="separator">·</span>
      <span>{{ formatSize(file.size) }}</span>
      <span class="separator">·</span>
      <span class="kind">{{ file.kind }}</span>
    </div>
  </div>
</template>

<style scoped>
.media-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #1e1e2e;
  overflow: auto;
}

.preview-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-height: 0;
  overflow: auto;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
  background: repeating-conic-gradient(#313244 0% 25%, #1e1e2e 0% 50%) 50% / 16px 16px;
}

.preview-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
  outline: none;
}

.preview-container.audio {
  flex-direction: column;
  gap: 16px;
}

.audio-icon {
  font-size: 64px;
  color: #89b4fa;
}

.audio-name {
  font-size: 16px;
  color: #cdd6f4;
}

.preview-audio {
  width: 400px;
  max-width: 90%;
  outline: none;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 12px;
  color: #6c7086;
  border-top: 1px solid #313244;
  width: 100%;
  flex-shrink: 0;
}

.separator { color: #45475a; }
.kind { text-transform: uppercase; color: #89b4fa; font-weight: 600; font-size: 10px; }
</style>
