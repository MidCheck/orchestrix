# Orchestrix 设计文档索引

本目录包含 Orchestrix 的技术方案和设计文档，供开发者和 AI 助手参考。

## 文档列表

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构：进程模型、图层模型、IPC 通信、安全模型 |
| [tech-stack.md](./tech-stack.md) | 技术栈选型：各依赖的选择理由、注意事项、跨平台说明 |
| [state-management.md](./state-management.md) | 状态管理：分栏布局模型、项目布局持久化、光标恢复、IPC 同步 |
| [project-structure.md](./project-structure.md) | 项目目录结构：文件组织、模块依赖、编辑器组件层次 |
| [mvp-plan.md](./mvp-plan.md) | MVP 实现计划：已完成功能、待实现功能、技术风险 |

## 核心设计决策

- **图层模型**：Terminal 层 + Editor 层，同一时间只显示一层，类似 Photoshop 图层
- **项目即 Shell**：每个终端面板绑定一个项目，添加/删除项目同步创建/关闭 Shell
- **分栏编辑器**：VS Code 风格拖拽分栏，每个项目独立保存/恢复布局和光标
- **UI 框架**：Naive UI（TypeScript 友好、轻量）
- **开发环境**：electron-vite（HMR）→ 发布用 electron-builder
- **Agent 集成**：优先纯 CLI spawn（通过 node-pty），后续考虑 API/SDK
- **状态管理**：Pinia (Renderer) + Main SharedStore + IPC 双向同步
- **代码编辑器**：CodeMirror 6（轻量、多语言高亮、主题定制）
- **测试**：Playwright 直接驱动 Electron 进程进行 E2E 自动化测试
