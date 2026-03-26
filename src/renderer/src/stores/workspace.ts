import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Project, FileEntry } from '@shared/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const projects = ref<Project[]>([])
  const activeProjectId = ref<string | null>(null)

  const activeProject = computed(() => {
    if (!activeProjectId.value) return null
    return projects.value.find((p) => p.id === activeProjectId.value) || null
  })

  async function loadProjects(): Promise<void> {
    projects.value = await window.electronAPI.workspace.list()
  }

  async function addProject(path?: string): Promise<Project | null> {
    const project = await window.electronAPI.workspace.add(path)
    if (project) {
      projects.value.push(project)
      activeProjectId.value = project.id
    }
    return project
  }

  async function removeProject(id: string): Promise<void> {
    await window.electronAPI.workspace.remove(id)
    projects.value = projects.value.filter((p) => p.id !== id)
    if (activeProjectId.value === id) {
      activeProjectId.value = projects.value.length > 0 ? projects.value[0].id : null
    }
  }

  function setActiveProject(id: string): void {
    activeProjectId.value = id
  }

  async function readDirectory(dirPath: string): Promise<FileEntry[]> {
    return await window.electronAPI.workspace.readDir(dirPath)
  }

  // 按面板顺序重排项目列表
  function reorderByPanes(panes: Array<{ projectId: string | null }>): void {
    const ordered: Project[] = []
    for (const pane of panes) {
      if (!pane.projectId) continue
      const p = projects.value.find((proj) => proj.id === pane.projectId)
      if (p && !ordered.includes(p)) ordered.push(p)
    }
    // 追加不在面板中的项目
    for (const p of projects.value) {
      if (!ordered.includes(p)) ordered.push(p)
    }
    projects.value = ordered
  }

  return {
    projects,
    activeProjectId,
    activeProject,
    loadProjects,
    addProject,
    removeProject,
    setActiveProject,
    readDirectory,
    reorderByPanes
  }
})
