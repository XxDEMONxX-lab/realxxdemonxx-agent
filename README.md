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
- Persist project-specific memory and task history across sessions, and resume the last saved conversation with `/resume`.
- Create named project checkpoints and restore a selected checkpoint after explicit confirmation.
- Keep recent conversation context with automatic bounded-history compaction and report provider usage when supplied.
- Format Markdown headings, lists, inline code, and fenced code in the terminal chat.
- Edit chat prompts with cursor movement, Home/End, Delete, Backspace, Ctrl+A/E/U/W, multiline Shift+Enter, paste support, and prompt history.
- Classify common package-install and destructive shell commands separately for permission checks.
- Run built-in regression tests with `npm test`.
- Run configured checks, tests, lint and type checks with `/diagnostics` without installing tools automatically.
- Inspect JavaScript/TypeScript syntax trees and perform TypeScript-language-service cross-file symbol renames when TypeScript is installed.
- Search public web pages and fetch readable public URLs after network permission is granted.
- Connect configured Model Context Protocol (MCP) stdio servers and expose their tools after explicit trust approval.
- Create, list, and remove isolated Git worktrees under `~/.realxxdemonxx-agent/worktrees/<project-id>`.
- Route simple, complex, review, and debug tasks to separately configured model IDs.
- Load repository-specific instructions from `AGENTS.md` and reusable `SKILL.md` files from project or user skill folders.
- Delegate independent investigations to architect, debugger, security, test, research, performance, dependency, and documentation specialists.
- Inspect tool results and continue working through multiple steps.
- Show connection errors and suggestions rather than silently failing.

Example requests:
- `Inspect this project and explain its architecture.`
- `Find the bug in the login flow, fix it, and run the tests.`
- `Build a Discord.js v14 ticket system that matches this project's style.`
- `Review this project for bugs and security issues.`

## Interactive workspace

The terminal interface provides an adaptive multi-panel workspace with an explorer/navigation rail, activity stream, project context panel on wide terminals, keyboard navigation, command suggestions, and live model output. Use `/` to view command suggestions, arrow keys to navigate when the input is empty, Enter to send, Shift+Enter to add a line, Tab to complete a command, Esc to back out, and Ctrl+P to open the command palette. The chat editor supports cursor movement, deletion, prompt history, and multi-character paste input. The interface is designed for Termux terminals; layout depends on terminal dimensions and capabilities.

Planning, review, and debugging modes are available through `/plan`, `/review`, and `/debug`. The agent can delegate independent read-only investigations to architect, debugger, security-reviewer, and test-analyst subagents; multiple independent subagent calls can run concurrently. `/map` displays the project structure; `/git` and `/diff` inspect Git state; `/run-tests` runs the project's `test` or `check` script; `/memory` manages persistent project context; `/history` shows recent tasks; `/checkpoint`, `/checkpoints`, and `/restore` manage snapshots; `/fallback` configures backup model IDs; `/usage` reports provider token metadata when available. Provider requests stream output when supported, retry transient failures, and can switch to configured fallback models. The agent compacts older conversation turns to limit unbounded context growth and instructs itself to verify code changes with relevant checks and a final diff. `/routing` configures task-specific model IDs; `/web` toggles public web access; `/mcp` configures MCP servers. The workspace includes a built-in keyboard-driven file editor, but it remains a terminal application rather than a graphical IDE with Monaco or a full terminal emulator.

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
| `/editor` | Open the built-in keyboard file editor (Ctrl+S saves, Ctrl+Q cancels) |
| `/terminal` | Run a terminal command after approval |
| `/pwd` | Show current project directory |
| `/providers` | Switch provider and model |
| `/models` | Browse models for current provider |
| `/routing` | Configure simple, complex, review and debug models |
| `/skills` | List available reusable skills |
| `/web` | Toggle public web research |
| `/mcp` | Add or remove MCP stdio servers |
| `/fallback` | Configure up to five backup model IDs |
| `/memory` | View or replace persistent project memory |
| `/history` | Show recent task history |
| `/git` | Inspect Git status |
| `/diff` | Inspect Git changes |
| `/run-tests` | Run a configured test/check script |
| `/diagnostics` | Run available tests, lint and type diagnostics |
| `/checkpoint` | Save a named project snapshot |
| `/checkpoints` | List saved snapshots |
| `/restore` | Restore a snapshot after confirmation |
| `/model` | Enter a model ID manually |
| `/provider` | Show active provider and model |
| `/test` | Test API connectivity |
| `/maxsteps` | Set maximum tool cycles (1–30) |
| `/status` | Show session status |
| `/usage` | Show session token usage |
| `/resume` | Restore the last saved conversation |
| `/clear` | Clear conversation context and saved session |
| `/help` | Show commands |
| `/exit` | Exit |

## Tests and verification

Run `npm test` for the built-in regression tests and `npm run check` for JavaScript syntax checks. GitHub Actions runs both checks and imports the core modules. These checks do not replace interactive testing on Termux or live provider API tests.

## Safety and configuration

Provider settings and API keys are stored in `~/.realxxdemonxx-agent/config.json` with owner-only file permissions. Do not share that file or your API key.

MCP servers execute external programs and can access whatever those programs can access. Only configure servers you trust; server commands and arguments are stored in the local config. Public web results and MCP output are treated as untrusted data. URL checks block common local/private address forms but are not a substitute for a network sandbox.

Place repository guidance in `AGENTS.md`. Reusable skills use `.agent/skills/<skill-name>/SKILL.md` inside a project or `~/.realxxdemonxx-agent/skills/<skill-name>/SKILL.md` globally; list them with `/skills`.

AST inspection and semantic rename use the TypeScript compiler API when it is installed in the project. Install it only if needed with `npm install -D typescript` after reviewing the dependency.

Git worktrees are stored outside the project under `~/.realxxdemonxx-agent/worktrees/<project-id>`; removal requires a separate confirmation and Git refuses to remove worktrees with uncommitted changes unless forced.

File tools are restricted to the current project directory. File edits create backups for `/undo`; checkpoint restores first create a safety snapshot. Checkpoints are bounded snapshots: they skip dependency/build directories, files over 250 KB, and projects beyond the configured depth/file limits. Restore rewrites captured files but does not delete files created after the checkpoint or restore skipped files. File reads/writes, shell commands, package installation, Git inspection, test execution, and destructive commands have separate approval settings. Shell commands require explicit approval unless you enable the corresponding auto-approval setting.

## Compatibility

This is a terminal coding agent, not a full IDE. Choose a model that supports chat completions and tool/function calling for file-editing workflows. A model may support ordinary chat without supporting the tools this agent needs.

## License

MIT


## Advanced agent features

The current upgrade branch adds:

- **Specialist teams:** `/agents` runs up to four parallel, read-only specialists for architecture, debugging, security, tests, performance, dependencies and documentation.
- **Project profile:** `/profile` identifies common frameworks, package scripts, dependency counts and file types.
- **Security audit:** `/security` scans source and manifests for likely exposed credentials and risky patterns. Findings are heuristic; credentials are redacted.
- **MCP catalog:** `/mcp-catalog` lists starter configurations; `/mcp-add` adds one after explicit confirmation.
- **MCP transports:** configured servers can use stdio or Streamable HTTP. HTTP entries use `{ "name": "remote", "transport": "http", "url": "https://host.example/mcp", "headers": {} }`.
- **Workflow plans:** `/workflows` lists feature, bugfix, refactor, security, release, documentation, performance and test workflows. `/workflow` generates a gated checklist.

### MCP environment variables

MCP server arguments support `${NAME}` placeholders. Export secrets in Termux instead of writing them into the agent config. For example, PostgreSQL templates use `${POSTGRES_URL}`; set it in your shell before starting the agent. GitHub MCP can inherit `GITHUB_PERSONAL_ACCESS_TOKEN` from the environment.

MCP servers execute third-party code and may access the resources granted to them. Review every server, its arguments, credentials and permissions before trusting it. Browser and database integrations still require their external runtimes and credentials.
