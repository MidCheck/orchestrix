// Agent 相关类型
export interface AgentConfig {
  id: string
  name: string
  cli: string // 'claude' | 'codex' | custom command
  projectPath: string
  worktreePath?: string
}

export interface AgentInfo {
  id: string
  name: string
  cli: string
  projectPath: string
  worktreePath?: string
  status: AgentStatus
  terminalId: string
  createdAt: number
}

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error'

// Terminal 相关类型
export interface TerminalCreateOptions {
  id: string
  cols?: number
  rows?: number
  cwd?: string
}

export interface TerminalResizeData {
  id: string
  cols: number
  rows: number
}

// Workspace 相关类型
export interface Project {
  id: string
  name: string
  path: string
  gitBranch?: string
  worktrees: string[]
  createdAt: number
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

// File 相关类型
export type FileKind = 'text' | 'image' | 'video' | 'audio' | 'binary'

export interface FileReadResult {
  path: string
  kind: FileKind
  content: string       // text: 文本内容; image/video/audio: data URL; binary: ''
  language: string      // 仅 text 有效
  size: number          // 文件字节数
  hexHead?: string      // binary: 前 N 字节的 hex dump
}

// Git 相关类型
export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'U' | '?' | '!' | ''

export interface GitStatusMap {
  [relativePath: string]: GitFileStatus
}

export interface GitShowResult {
  content: string
}

// git blame 行信息
export interface GitBlameLine {
  hash: string
  author: string
  date: string        // ISO 日期字符串
  summary: string     // commit message
  line: number        // 行号 (1-based)
}

// git diff 修改的行范围
export interface GitDiffHunk {
  startLine: number   // 1-based
  lineCount: number
}
