import * as monaco from 'monaco-editor'

let requestId = 0
const activeClients = new Map<string, { cleanup: () => void }>()

async function getFileContent(filePath: string): Promise<string | null> {
  try {
    const result = await window.electronAPI.workspace.readFile(filePath)
    return result.kind === 'text' ? result.content : null
  } catch { return null }
}

// 用 macrotask yield 确保 IPC 有时间处理
function yieldToEventLoop(ms = 100): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function startLspForFile(filePath: string, languageId: string, projectPath: string): Promise<void> {
  const status = await window.electronAPI.lsp.status()
  const server = status.find((s) => s.languages.includes(languageId))
  if (!server || !server.installed) return

  const clientKey = `${projectPath}:${server.id}`
  if (activeClients.has(clientKey)) return

  // 如果 autoInit 已完成，直接注册 providers（跳过 start/initialize）
  const alreadyRunning = server.running

  // Initialize
  const initResp = await window.electronAPI.lsp.request(server.id, projectPath, ++requestId, 'initialize', {
    processId: null,
    rootUri: `file://${projectPath}`,
    capabilities: {
      textDocument: {
        completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        definition: { linkSupport: true },
        references: {},
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
        publishDiagnostics: { relatedInformation: true },
      },
      workspace: { workspaceFolders: true }
    },
    workspaceFolders: [{ uri: `file://${projectPath}`, name: projectPath.split('/').pop() || '' }]
  })

  if (!alreadyRunning) {
    // 首次启动：走完整初始化流程（但这条路径现在由 autoInit 在 Main 进程完成，不再走这里）
    const started = await window.electronAPI.lsp.start(server.id, projectPath)
    if (!started) return
    const initResp = await window.electronAPI.lsp.request(server.id, projectPath, ++requestId, 'initialize', {
      processId: null, rootUri: `file://${projectPath}`,
      capabilities: { textDocument: { definition: { linkSupport: true }, hover: {}, publishDiagnostics: {}, completion: { completionItem: { snippetSupport: true } }, references: {}, signatureHelp: {} }, workspace: { workspaceFolders: true } },
      workspaceFolders: [{ uri: `file://${projectPath}`, name: projectPath.split('/').pop() || '' }]
    })
    if (!initResp?.result) return
    await window.electronAPI.lsp.notify(server.id, projectPath, 'initialized', {})
  }
  // autoInit 已完成 → 直接到 provider 注册

  // 注册 Monaco providers
  const disposeProviders = registerProviders(server.id, projectPath, languageId)

  // 监听诊断事件
  const disposeEvents = window.electronAPI.lsp.onEvent((sid, pp, message) => {
    if (sid !== server.id || pp !== projectPath) return
    try {
      const msg = JSON.parse(message)
      if (msg.method === 'textDocument/publishDiagnostics') handleDiagnostics(msg.params)
    } catch {}
  })

  activeClients.set(clientKey, { cleanup: () => { disposeProviders(); disposeEvents() } })
}

export async function notifyFileOpen(serverId: string, projectPath: string, filePath: string, languageId: string, content: string): Promise<void> {
  await window.electronAPI.lsp.notify(serverId, projectPath, 'textDocument/didOpen', {
    textDocument: { uri: `file://${filePath}`, languageId, version: 1, text: content }
  })
}

const fileVersions = new Map<string, number>()
export async function notifyFileChange(serverId: string, projectPath: string, filePath: string, content: string): Promise<void> {
  const ver = (fileVersions.get(filePath) || 1) + 1
  fileVersions.set(filePath, ver)
  await window.electronAPI.lsp.notify(serverId, projectPath, 'textDocument/didChange', {
    textDocument: { uri: `file://${filePath}`, version: ver },
    contentChanges: [{ text: content }]
  })
}

// --- Monaco provider registration ---

function registerProviders(serverId: string, projectPath: string, languageId: string): () => void {
  const disposables: monaco.IDisposable[] = []

  async function lspRequest(method: string, params: any): Promise<any> {
    const resp = await window.electronAPI.lsp.request(serverId, projectPath, ++requestId, method, params)
    return resp?.result ?? null
  }

  // Completion
  disposables.push(monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['.', '(', '"', "'", '/'],
    async provideCompletionItems(model, position) {
      const result = await lspRequest('textDocument/completion', {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
      })
      if (!result) return { suggestions: [] }
      const items = Array.isArray(result) ? result : result.items || []
      const word = model.getWordUntilPosition(position)
      return {
        suggestions: items.slice(0, 50).map((item: any) => ({
          label: item.label,
          kind: mapKind(item.kind),
          insertText: item.insertText || item.label,
          insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          detail: item.detail,
          documentation: typeof item.documentation === 'object' ? item.documentation?.value : item.documentation,
          range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
        }))
      }
    }
  }))

  // Hover
  disposables.push(monaco.languages.registerHoverProvider(languageId, {
    async provideHover(model, position) {
      const result = await lspRequest('textDocument/hover', {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
      })
      if (!result?.contents) return null
      const contents = Array.isArray(result.contents) ? result.contents : [result.contents]
      return { contents: contents.map((c: any) => ({ value: typeof c === 'string' ? c : c.value || '' })) }
    }
  }))

  // Definition
  disposables.push(monaco.languages.registerDefinitionProvider(languageId, {
    async provideDefinition(model, position) {
      const result = await lspRequest('textDocument/definition', {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
      })
      if (!result) return null
      const locs = Array.isArray(result) ? result : [result]
      return locs.map((l: any) => ({ uri: monaco.Uri.parse(l.uri), range: toRange(l.range) }))
    }
  }))

  // References
  disposables.push(monaco.languages.registerReferenceProvider(languageId, {
    async provideReferences(model, position) {
      const result = await lspRequest('textDocument/references', {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        context: { includeDeclaration: true }
      })
      if (!result) return null
      return result.map((l: any) => ({ uri: monaco.Uri.parse(l.uri), range: toRange(l.range) }))
    }
  }))

  // Signature Help
  disposables.push(monaco.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: ['(', ','],
    async provideSignatureHelp(model, position) {
      const result = await lspRequest('textDocument/signatureHelp', {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
      })
      if (!result) return null
      return {
        value: {
          signatures: (result.signatures || []).map((s: any) => ({
            label: s.label,
            documentation: typeof s.documentation === 'object' ? s.documentation?.value : s.documentation,
            parameters: (s.parameters || []).map((p: any) => ({ label: p.label, documentation: typeof p.documentation === 'object' ? p.documentation?.value : p.documentation }))
          })),
          activeSignature: result.activeSignature || 0,
          activeParameter: result.activeParameter || 0
        },
        dispose: () => {}
      }
    }
  }))

  return () => disposables.forEach((d) => d.dispose())
}

function handleDiagnostics(params: any): void {
  const uri = monaco.Uri.parse(params.uri)
  const model = monaco.editor.getModel(uri)
  if (!model) return
  monaco.editor.setModelMarkers(model, 'lsp', (params.diagnostics || []).map((d: any) => ({
    severity: [0, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint][d.severity] || monaco.MarkerSeverity.Info,
    message: d.message,
    startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
    source: d.source || 'lsp'
  })))
}

function toRange(r: any): monaco.IRange {
  return { startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 }
}

function mapKind(k: number): monaco.languages.CompletionItemKind {
  const m: Record<number, monaco.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text, 2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function, 4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field, 6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class, 8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module, 10: monaco.languages.CompletionItemKind.Property,
    14: monaco.languages.CompletionItemKind.Keyword, 15: monaco.languages.CompletionItemKind.Snippet,
  }
  return m[k] || monaco.languages.CompletionItemKind.Text
}
