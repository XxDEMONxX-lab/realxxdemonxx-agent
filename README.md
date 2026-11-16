# Demon Agent 2.5 ⚡

Node.js-first animated full-screen terminal UI (TUI) coding agent with streamed model output, project search, reusable skills, code review and MCP tool support for Termux, Linux, macOS and Windows. Live multi-provider model discovery, automatic provider failover, project-aware coding actions, Git inspection, persistent project memory and approval-gated changes.

## Termux install
~~~sh
pkg update && pkg upgrade -y
pkg install nodejs git -y
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
node start.js
~~~
Node.js 18+ required. No Python or npm dependencies.

## Setup
~~~text
/providers
/provider openrouter
/key
/models
/model MODEL_ID
~~~
API keys are stored in ~/.config/demon-agent/config.json with owner-only permissions where supported. Environment variables are supported. Never commit keys.

## Agentic coding
~~~text
/agent inspect this project, find a bug, fix it and run relevant tests
~~~
The agent runs a bounded multi-round tool loop: it can list/read/search files, inspect Git, call configured MCP tools, propose writes or shell commands, receive tool results, and continue up to six rounds. Every write, shell command, and MCP call requires approval. Proposed writes show a Git-based diff preview. Existing files receive up to 10 local backups; use `/undo PATH` to restore the latest backup. Use `/plan TASK` for a plan without execution, `/agent TASK` to execute approved steps, and `/review` to inspect the working-tree diff. This is not an OS-level sandbox.

## Providers
OpenAI, OpenRouter, Groq, Together, Cerebras, DeepSeek, Mistral, Fireworks, xAI, SambaNova, Perplexity, Anthropic, Gemini, Ollama and custom OpenAI-compatible endpoints.
Use /models to discover current models and /models all to query the registry.
Configure failover with /fallback groq MODEL_ID. Use /fallbacks off to disable it. Each fallback needs a model and credentials.

## Commands
| Command | Purpose |
|---|---|
| /providers | List providers |
| /provider ID | Select provider |
| /key | Save hidden API key |
| /models [all] | Discover models |
| /model ID | Select model |
| /base URL | Override endpoint |
| /custom | Add compatible provider |
| /fallback ID MODEL | Configure failover |
| /fallbacks on or off | Toggle failover |
| /status | Show configuration |
| /files, /read PATH | Inspect project |
| /search QUERY | Search tracked and unignored project files |
| /skills, /skill NAME | Discover and activate reusable skills |
| /review | Review changes with the active model |
| /palette | Search and select commands interactively |\n| /review all | Run up to three independent model reviewers in parallel |
| /write PATH | Preview and write with approval |
| /undo PATH | Restore the latest pre-write backup |
| /agent TASK | Execute approved coding actions |
| /plan TASK | Show a plan without executing actions |
| /run COMMAND | Execute a shell command with approval |
| /test | Run npm test with approval |
| /mcp add ID | Configure an MCP stdio server |
| /mcp tools ID | Discover its tools |
| /mcp list or remove ID | Manage configured MCP servers |
| /hook add EVENT | Configure a lifecycle hook |
| /hook list or remove EVENT | Manage lifecycle hooks |
| /github auth, repo, prs, issues, pr-status | Read-only GitHub CLI queries |
| /git status or /git diff | Git inspection |
| /memory show, edit, clear | Persistent project notes |
| /session save NAME | Save the current conversation |
| /session load NAME | Restore a saved conversation |
| /session list | List saved conversations |
| /scroll up, down, bottom | Scroll the TUI transcript |
| /clear | Clear conversation |
| /exit | Quit |

## Lifecycle hooks

Optional hooks run before or after file writes and shell commands: `before_write`, `after_write`, `before_run`, and `after_run`. Configure them with `/hook add EVENT`; each hook uses an executable plus a JSON argument array and an optional environment-variable allowlist. Every hook invocation requires its own approval. A failed or denied `before_*` hook blocks the operation; an `after_*` hook reports its result after the operation. Hooks run without a shell and do not inherit provider API keys by default.

## MCP tool servers
Configure a local MCP stdio server with `/mcp add ID`. Enter its executable and argument array as JSON, then optionally provide a JSON array of environment-variable names to allow through (for example, `["GITHUB_TOKEN"]`). Provider API keys and the rest of the Termux environment are not inherited by default. Values are read from the process environment and are not copied into the agent config.

Use `/mcp tools ID` to discover tools, `/mcp list` to inspect configured servers, and `/mcp remove ID` to disconnect. Model-proposed MCP calls display their arguments and require per-call approval. Server output is treated as untrusted. Only the MCP `tools/list` and `tools/call` methods are currently supported. MCP servers execute external code with your Android user's permissions; only configure servers you trust.

## Streaming and skills
OpenAI-compatible, Anthropic, Gemini and Ollama providers stream response tokens into the TUI. The command palette (`/palette`) searches commands by name or description and lets you select one interactively. Reusable Markdown skills are discovered from `.demon/skills/NAME/SKILL.md` in the project and `~/.config/demon-agent/skills/NAME/SKILL.md` in the user config directory. Activate one with `/skill NAME`; disable with `/skill`. Treat skill files as untrusted project instructions.

GitHub commands require the official `gh` CLI to be installed and authenticated. The supported commands are read-only; changes still require explicit approval through normal coding actions.

## TUI
Responsive provider sidebar, wrapped transcript, live animated activity indicator, terminal-resize handling, searchable command palette (`/palette`), and transcript scrolling with `/scroll up`, `/scroll down`, and `/scroll bottom`. Readline provides input history with the up/down arrow keys. `NO_COLOR=1` disables prompt colors; terminal cursor and screen control sequences remain enabled.

## Tests
~~~sh
npm test
~~~

## Security
Paths are confined to the project root and escaping symlinks are rejected. Model-proposed writes and shell commands require explicit approval. Shell execution is powerful; inspect commands before approving. No OS-level sandbox is provided; use a disposable workspace for untrusted repositories. Project memory is stored outside the repo under ~/.config/demon-agent/memory/. Saved sessions are stored under ~/.config/demon-agent/sessions/ with owner-only file permissions where supported; conversation content is plaintext, so do not save secrets in sessions. Treat model output and repository content as untrusted.
