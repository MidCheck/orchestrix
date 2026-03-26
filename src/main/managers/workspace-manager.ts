import { readdir, readFile, writeFile, access, mkdir, rm, rename, stat as fsStat } from 'fs/promises'
import { join, basename, extname, relative, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Project, FileEntry, FileReadResult, FileKind, GitStatusMap, GitBlameLine, GitDiffHunk } from '@shared/types'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

export class WorkspaceManager {
  private projects: Map<string, Project> = new Map()

  addProject(projectPath: string): Project {
    // 检查是否已存在
    for (const p of this.projects.values()) {
      if (p.path === projectPath) return p
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(projectPath),
      path: projectPath,
      worktrees: [],
      createdAt: Date.now()
    }

    this.projects.set(project.id, project)
    return project
  }

  removeProject(id: string): boolean {
    return this.projects.delete(id)
  }

  listProjects(): Project[] {
    return Array.from(this.projects.values())
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id)
  }

  async readDirectory(dirPath: string): Promise<FileEntry[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result: FileEntry[] = []

    for (const entry of entries) {
      // 跳过隐藏文件和 node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      result.push({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory()
      })
    }

    // 目录排前面，然后按名称排序
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return result
  }

  async readFile(filePath: string): Promise<FileReadResult> {
    const ext = extname(filePath).toLowerCase()
    const name = basename(filePath)
    const stats = await fsStat(filePath)
    const kind = this.classifyFile(ext)

    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      // 50MB 以下用 base64 data URL
      if (stats.size <= 50 * 1024 * 1024) {
        const buf = await readFile(filePath)
        const mime = this.extToMime(ext)
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        return { path: filePath, kind, content: dataUrl, language: '', size: stats.size }
      }
      // 大文件返回路径提示
      return { path: filePath, kind, content: '', language: '', size: stats.size }
    }

    if (kind === 'binary') {
      const buf = await readFile(filePath)
      return {
        path: filePath, kind: 'binary', content: '', language: '',
        size: stats.size, hexHead: this.formatHexDump(buf)
      }
    }

    // text
    const content = await readFile(filePath, 'utf-8')
    const specialNames: Record<string, string> = {
      'Dockerfile': 'dockerfile', 'Makefile': 'shell', 'CMakeLists.txt': 'cmake',
      'Gemfile': 'ruby', 'Rakefile': 'ruby',
    }
    const language = specialNames[name] || this.extToLanguage(ext)
    return { path: filePath, kind: 'text', content, language, size: stats.size }
  }

  private classifyFile(ext: string): FileKind {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.avif']
    const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']
    const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma']
    const binaryExts = [
      '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib',
      '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.woff', '.woff2', '.ttf', '.otf', '.eot',
      '.class', '.pyc', '.pyd', '.wasm',
      '.sqlite', '.db', '.node',
    ]
    if (imageExts.includes(ext)) return 'image'
    if (videoExts.includes(ext)) return 'video'
    if (audioExts.includes(ext)) return 'audio'
    if (binaryExts.includes(ext)) return 'binary'
    return 'text'
  }

  private extToMime(ext: string): string {
    const map: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
    }
    return map[ext] || 'application/octet-stream'
  }

  private formatHexDump(buf: Buffer): string {
    const lines: string[] = []
    const len = Math.min(buf.length, 16 * 256) // 最多显示 256 行
    for (let offset = 0; offset < len; offset += 16) {
      const hex: string[] = []
      const ascii: string[] = []
      for (let i = 0; i < 16; i++) {
        if (offset + i < buf.length) {
          const byte = buf[offset + i]
          hex.push(byte.toString(16).padStart(2, '0'))
          ascii.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')
        } else {
          hex.push('  ')
          ascii.push(' ')
        }
      }
      const addr = offset.toString(16).padStart(8, '0')
      lines.push(`${addr}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii.join('')}|`)
    }
    return lines.join('\n')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
  }

  async createFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, '', 'utf-8')
  }

  async deleteFile(filePath: string): Promise<void> {
    await rm(filePath, { recursive: true, force: true })
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await mkdir(dirname(newPath), { recursive: true })
    await rename(oldPath, newPath)
  }

  async createDirectory(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true })
  }

  async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      await access(join(dirPath, '.git'))
      return true
    } catch {
      return false
    }
  }

  async getGitStatus(projectPath: string): Promise<GitStatusMap> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-uall'], {
        cwd: projectPath,
        timeout: 5000
      })
      const result: GitStatusMap = {}
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        // 格式: XY filename 或 XY old -> new
        const status = line.substring(0, 2)
        let filePath = line.substring(3).trim()
        // 处理重命名: old -> new
        if (filePath.includes(' -> ')) {
          filePath = filePath.split(' -> ')[1]
        }
        // 取工作区状态（Y 位），如果为空取暂存区状态（X 位）
        const wsStatus = status[1] !== ' ' ? status[1] : status[0]
        result[filePath] = wsStatus as any
      }
      return result
    } catch {
      return {}
    }
  }

  async gitShowFile(projectPath: string, filePath: string, ref: string = 'HEAD'): Promise<string> {
    const relPath = relative(projectPath, filePath)
    try {
      const { stdout } = await execFileAsync('git', ['show', `${ref}:${relPath}`], {
        cwd: projectPath,
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024
      })
      return stdout
    } catch {
      return ''
    }
  }

  async gitBlame(projectPath: string, filePath: string): Promise<GitBlameLine[]> {
    const relPath = relative(projectPath, filePath)
    try {
      const { stdout } = await execFileAsync(
        'git', ['blame', '--porcelain', relPath],
        { cwd: projectPath, timeout: 10000, maxBuffer: 10 * 1024 * 1024 }
      )
      const result: GitBlameLine[] = []
      const lines = stdout.split('\n')
      let i = 0
      while (i < lines.length) {
        const headerMatch = lines[i]?.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
        if (!headerMatch) { i++; continue }
        const hash = headerMatch[1]
        const lineNum = parseInt(headerMatch[2], 10)
        let author = '', date = '', summary = ''
        i++
        while (i < lines.length && !lines[i]?.startsWith('\t')) {
          const line = lines[i]
          if (line.startsWith('author ')) author = line.substring(7)
          else if (line.startsWith('author-time ')) {
            const ts = parseInt(line.substring(12), 10)
            date = new Date(ts * 1000).toISOString()
          }
          else if (line.startsWith('summary ')) summary = line.substring(8)
          i++
        }
        i++ // skip the content line (starts with \t)
        result.push({ hash, author, date, summary, line: lineNum })
      }
      return result
    } catch {
      return []
    }
  }

  async gitDiffLines(projectPath: string, filePath: string): Promise<GitDiffHunk[]> {
    const relPath = relative(projectPath, filePath)
    try {
      const { stdout } = await execFileAsync(
        'git', ['diff', '-U0', '--', relPath],
        { cwd: projectPath, timeout: 5000 }
      )
      const hunks: GitDiffHunk[] = []
      // 解析 @@ -a,b +c,d @@ 格式，取 +c,d (新文件的修改行)
      const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm
      let match
      while ((match = hunkRegex.exec(stdout)) !== null) {
        hunks.push({
          startLine: parseInt(match[1], 10),
          lineCount: match[2] !== undefined ? parseInt(match[2], 10) : 1
        })
      }
      return hunks
    } catch {
      return []
    }
  }

  private extToLanguage(ext: string): string {
    const map: Record<string, string> = {
      // JavaScript / TypeScript
      '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
      '.jsx': 'javascript', '.tsx': 'typescript',
      // Web
      '.vue': 'vue',
      '.json': 'json', '.jsonc': 'json',
      '.html': 'html', '.htm': 'html', '.xml': 'html', '.svg': 'html',
      '.css': 'css', '.scss': 'css', '.less': 'css',
      // Markdown
      '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
      // Python
      '.py': 'python', '.pyw': 'python', '.pyi': 'python',
      // C / C++ / ObjC
      '.c': 'c', '.h': 'c',
      '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
      '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
      '.m': 'objectivec', '.mm': 'objectivec',
      // JVM
      '.java': 'java',
      '.kt': 'kotlin', '.kts': 'kotlin',
      // .NET
      '.cs': 'csharp',
      // Shell
      '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
      '.ps1': 'powershell', '.psm1': 'powershell',
      // Systems
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      // Scripting
      '.rb': 'ruby', '.rake': 'ruby',
      '.lua': 'lua',
      '.pl': 'perl', '.pm': 'perl',
      // Data / Config
      '.yml': 'yaml', '.yaml': 'yaml',
      '.toml': 'toml',
      '.sql': 'sql',
      // Build
      '.cmake': 'cmake',
      // Misc
      '.txt': 'text', '.log': 'text', '.env': 'text',
      '.gitignore': 'text', '.dockerignore': 'text',
    }
    return map[ext] || 'text'
  }
}
