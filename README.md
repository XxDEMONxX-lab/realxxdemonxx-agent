# REALXXDEMONXX AGENT

A Termux-compatible AI coding agent with an interactive chat prompt, project tools, and an agent workflow for inspecting, editing, and testing code.

## Install on Termux

```sh
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
npm run check
npm start
```

Update an existing installation:

```sh
cd ~/realxxdemonxx-agent
git pull
npm run check
npm start
```

## Where is chat?

After choosing a provider, entering your API key, and selecting or entering a model ID, the agent opens a **CHAT READY** screen. The `YOU ›` prompt is the chat box: type your message there and press Enter. For example:

```text
YOU › Explain this project and find bugs
YOU › Fix the bug in src/index.js and run a syntax check
```

If you do not see the prompt, check the error printed above it. You can also type `/chat` to display a reminder or `/menu` for quick actions.

## Supported API providers

Eight API providers are supported: OpenRouter, Groq, NVIDIA NIM, DeepSeek, Mistral, Together AI, Fireworks AI, and Cerebras. OpenRouter also has an **OpenRouter Auto** routing option.

Select **OpenRouter Auto** to use the OpenRouter `openrouter/auto` router. It uses your OpenRouter API key and automatically chooses a suitable model for each request; you do not need to select a model manually. The ordinary OpenRouter option remains available when you want to choose a specific model. Auto routing is provided by OpenRouter, not by this CLI, and actual model availability, rate limits, pricing, and tool-calling support depend on OpenRouter's routing and the models available to your account.

## What the agent can do

- List, map, and search project files.
- Read files and preview proposed edits before writing; existing files are backed up for `/undo`.
- Run shell commands, inspect Git status/diffs, and execute configured test/check scripts with separate permissions.
- Persist project-specific memory and task history across sessions.
- Create named project checkpoints and restore a selected checkpoint after explicit confirmation.
- Keep conversation context during a session and report provider usage when supplied.
- Inspect tool results and continue working through multiple steps.
- Show connection errors and suggestions rather than silently failing.

Example requests:
- `Inspect this project and explain its architecture.`
- `Find the bug in the login flow, fix it, and run the tests.`
- `Build a Discord.js v14 ticket system that matches this project's style.`
- `Review this project for bugs and security issues.`

## Interactive workspace

The terminal interface provides an adaptive multi-panel workspace with an explorer/navigation rail, activity stream, project context panel on wide terminals, keyboard navigation, command suggestions, and live model output. Use `/` to view command suggestions, arrow keys to navigate when the input is empty, Enter to select, Tab to complete a command, Esc to back out, and Ctrl+P to open the command palette. The interface is designed for Termux terminals; layout depends on terminal dimensions and capabilities.

Planning, review, and debugging modes are available through `/plan`, `/review`, and `/debug`. The agent can delegate independent read-only investigations to architect, debugger, security-reviewer, and test-analyst subagents; multiple independent subagent calls can run concurrently. `/map` displays the project structure; `/git` and `/diff` inspect Git state; `/run-tests` runs the project's `test` or `check` script; `/memory` manages persistent project context; `/history` shows recent tasks; `/checkpoint`, `/checkpoints`, and `/restore` manage snapshots; `/fallback` configures backup model IDs; `/usage` reports provider token metadata when available. Provider requests stream output when supported, retry transient failures, and can switch to configured fallback models. This remains a terminal workspace rather than a graphical IDE with Monaco, a full embedded terminal emulator, or a mouse-driven editor.

## Commands

| Command | Function |
| --- | --- |
| `/chat` | Return to the chat prompt |
| `/menu` | Show quick actions |
| `/plan` | Plan a task before editing |
| `/review` | Review code for issues |
| `/debug` | Investigate a bug or error |
| `/map` | Display project structure |
| `/files` | List project files |
| `/open` | Read a selected project file |
| `/edit` | Send a targeted file-edit request to the agent |
| `/terminal` | Run a terminal command after approval |
| `/pwd` | Show current project directory |
| `/providers` | Switch provider and model |
| `/models` | Browse models for current provider |
| `/fallback` | Configure up to five backup model IDs |
| `/memory` | View or replace persistent project memory |
| `/history` | Show recent task history |
| `/git` | Inspect Git status |
| `/diff` | Inspect Git changes |
| `/run-tests` | Run a configured test/check script |
| `/checkpoint` | Save a named project snapshot |
| `/checkpoints` | List saved snapshots |
| `/restore` | Restore a snapshot after confirmation |
| `/model` | Enter a model ID manually |
| `/provider` | Show active provider and model |
| `/test` | Test API connectivity |
| `/maxsteps` | Set maximum tool cycles (1–30) |
| `/status` | Show session status |
| `/usage` | Show session token usage |
| `/clear` | Clear conversation context |
| `/help` | Show commands |
| `/exit` | Exit |

## Safety and configuration

Provider settings and API keys are stored in `~/.realxxdemonxx-agent/config.json` with owner-only file permissions. Do not share that file or your API key.

File tools are restricted to the current project directory. File edits create backups for `/undo`; checkpoint restores first create a safety snapshot. File reads/writes, shell commands, package installation, Git inspection, test execution, and destructive commands have separate approval settings. Shell commands require explicit approval unless you enable the corresponding auto-approval setting.

## Compatibility

This is a terminal coding agent, not a full IDE. Choose a model that supports chat completions and tool/function calling for file-editing workflows. A model may support ordinary chat without supporting the tools this agent needs.

## License

MIT
