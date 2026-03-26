# 🚀 Orchestrix

> Orchestrate multiple AI agents across projects — all in one workspace.

---

## 🧠 What is Orchestrix?

Orchestrix is a **multi-agent development workspace** designed for developers who work with AI.

Instead of a single AI assistant tied to one project, Orchestrix allows you to:

* Run **multiple AI agents in parallel**
* Manage **multiple projects in one workspace**
* Control everything through a **terminal-first interface**

Think of it as:

> 🧠 AI agents + 🧩 multi-project workspace + 💻 terminal = Orchestrix

---

## ✨ Why Orchestrix?

Current tools are limited:

* Traditional IDEs → single project, single AI context
* AI editors → one agent at a time
* Terminals → no orchestration

Orchestrix solves this by introducing:

> 🎼 **AI Orchestration**

Run multiple agents like a symphony — each working on different tasks, projects, or branches.

---

## 🔥 Core Features

### 🧩 Multi-Project Workspace

* Manage multiple repositories in one place
* Switch contexts instantly

---

### 🤖 Multi-Agent Execution

* Run multiple AI agents in parallel
* Isolated context per project / task

---

### 💻 Terminal-First Workflow

* Built for developers who live in the terminal
* Integrates with existing CLI tools (Claude, Codex, etc.)

---

### 🌿 Git Worktree Friendly

* Each agent can operate on its own branch/worktree
* No conflicts, fully isolated environments

---

## 🧠 Concept

```text
Workspace
 ├── Project A → Agent A
 ├── Project B → Agent B
 ├── Project C → Agent C
```

```text
           ┌─────────────────────────┐
           │      Frontend UI        │
           │ ┌────────────────────┐  │
           │ │  Vue3 + Vite       │  │
           │ │  Multi-pane layout │  │
           │ │  File Explorer     │  │
           │ │  xterm.js terminal │  │
           │ └────────────────────┘  │
           └─────────────┬────────-──┘
                         │ IPC / Event
                         ▼
           ┌────────────────────────┐
           │     Electron Main      │
           │ (Node.js Runtime / IPC)│
           └─────────────┬──────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
 ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
 │ Agent       │   │ Workspace    │   │ TerminalMgr  │
 │ Manager     │   │ Manager      │   │ (PTY Handler)│
 │ - spawn CLI │   │ - Git worktree│  │ - shell session
 │ - multiple  │   │ - project dirs│  │ - capture agent output
 │   agent     │   │ - project isolation│ 
 └─────────────┘   └──────────────┘   └──────────────┘
        │                │                 │
        ▼                ▼                 ▼
 ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
 │ AI Agent CLI│   │ Local FS /   │   │ Shell / PTY  │
 │ (Claude /   │   │ Git Project │   │ Sessions     │
 │ Codex / ... │   │ Files       │   │              │
 └─────────────┘   └──────────────┘   └──────────────┘
```

Orchestrix acts as the **conductor** 🎼 — coordinating all agents.

---

## Design Principles

1. Terminal-first: core interactions are terminal-based, no complex IDE UI
2. Agent as a process: each agent runs independently, isolated context
3. Workspace isolation: Git worktree + filesystem ensures multiple projects do not conflict
4. Pure client: no backend or server dependency

## 🛠️ Tech Stack (Planned)

* Frontend: Vue 3 + Vite + Naive UI / Element Plus
* Terminal: xterm.js
* Desktop Container: Electron
* Terminal Management: Node.js child_process + PTY
* Workspace Isolation: Git worktree + Node.js fs / containers
* Agent Integration: CLI-based (Claude, Codex, etc.)
* Cross-platform Windows / MacOS / Linux


---

## 🚧 Status

> ⚠️ Early stage / MVP in progress

---

## 🧭 Vision

Orchestrix is not just a tool — it's a step toward:

> 🧠 **An operating system for AI-driven development**

---

## 🤝 Contributing

PRs, ideas, and discussions are welcome.

---

## 📜 License

MIT License © 2026 Orchestrix

Allows personal use, modification, and learning
Please retain the original author information
Unauthorized commercial redistribution is prohibited
