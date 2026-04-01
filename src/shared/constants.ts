// IPC Channel 名称常量
export const IPC = {
  // Agent 相关
  AGENT_SPAWN: 'agent:spawn',
  AGENT_KILL: 'agent:kill',
  AGENT_STATUS: 'agent:status',
  AGENT_LIST: 'agent:list',

  // Terminal 相关
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DESTROY: 'terminal:destroy',

  // Workspace 相关
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_ADD: 'workspace:add',
  WORKSPACE_REMOVE: 'workspace:remove',
  WORKSPACE_FILES: 'workspace:files',

  // File 相关
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_READ_BINARY: 'file:read-binary',
  FILE_CREATE: 'file:create',
  FILE_DELETE: 'file:delete',
  FILE_RENAME: 'file:rename',
  FILE_MKDIR: 'file:mkdir',
  FILE_WATCH: 'file:watch',
  FILE_CHANGED: 'file:changed',
  FILE_SEARCH: 'file:search',

  // Git 相关
  GIT_STATUS: 'git:status',
  GIT_SHOW: 'git:show',
  GIT_IS_REPO: 'git:is-repo',
  GIT_BLAME: 'git:blame',
  GIT_DIFF_LINES: 'git:diff-lines',

  // LSP
  LSP_STATUS: 'lsp:status',
  LSP_INSTALL: 'lsp:install',
  LSP_IMPORT: 'lsp:import',
  LSP_START: 'lsp:start',
  LSP_STOP: 'lsp:stop',
  LSP_REQUEST: 'lsp:request',
  LSP_NOTIFY: 'lsp:notify',
  LSP_EVENT: 'lsp:event',

  // 通知
  TERMINAL_NOTIFY: 'terminal:notify',

  // Store 同步
  STORE_SYNC: 'store:sync',
  STORE_SYNC_BROADCAST: 'store:sync:broadcast'
} as const
