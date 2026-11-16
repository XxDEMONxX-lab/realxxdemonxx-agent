# Demon Agent 3.1 ⚡

Production-oriented Node.js multi-provider coding agent with a keyboard-driven full-screen TUI, native provider streaming, project symbol indexing, parallel analysis subagents, reusable skills, MCP tools, lifecycle hooks and transactional file edits. Supports Termux, Linux, macOS and Windows.

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

## Chat modes
~~~text
/mode                 # choose normal or coding
/mode set 1 openrouter MODEL_ID
/mode set 2 groq MODEL_ID
/mode set 3 deepseek MODEL_ID
/mode set 4 openai MODEL_ID
/mode set 5 ollama MODEL_ID
/mode list
/mode coding          # requires five distinct configured provider/model pairs
/mode normal
~~~
Normal mode uses the selected primary model (with configured failover). Coding mode runs five configured models concurrently as planner, architect, implementation specialist, security reviewer and test engineer. All five must have distinct provider/model pairs and valid credentials before activation. If any call fails, the run is reported as incomplete and no combined response is saved. The five specialists provide independent reports; this chat workflow does not automatically apply file changes. Use `/agent TASK` for the existing approval-gated file-editing workflow.

## Agentic coding
~~~text
/agent inspect this project, find a bug, fix it and run relevant tests
~~~
The agent runs a bounded multi-round tool loop: it can list/read/search files, inspect Git, call configured MCP tools, propose writes or shell commands, receive tool results, and continue up to six rounds. Every write, shell command, and MCP call requires approval. Proposed writes show a Git-based diff preview. Agent writes require the SHA-256 hash returned by a recent read, and are rejected if the file changed before approval or commit. Use `/verify` to syntax-check project JavaScript and optionally run the full test suite. Writes use same-directory temporary files, fsync and atomic rename; existing permissions are preserved. Exact-context patches reject stale hashes and ambiguous matches. Existing files receive up to 10 local backups; use `/undo PATH` to restore the latest backup. Use `/plan TASK` for a plan without execution, `/agent TASK` to execute approved steps, and `/review` to inspect the working-tree diff. This is not an OS-level sandbox.

## Providers
OpenAI, OpenRouter, Groq, Together, Cerebras, DeepSeek, Mistral, Fireworks, xAI, SambaNova, Perplexity, Anthropic, Gemini, Ollama and custom OpenAI-compatible endpoints.
Use /models to discover current models and /models all to query the registry.
Configure failover with /fallback groq MODEL_ID. Use /fallbacks off to disable it. Each fallback needs a model and credentials.

## Commands
| Command | Purpose |
|---|---|
| /mode | Select normal or five-AI coding mode; `/mode set SLOT PROVIDER MODEL` configures a coding slot |
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
| /symbols [QUERY] | Index and search source symbols |
| /diagnose | Run basic project diagnostics |
| /subagents TASK | Parallel planner, architect and tester analysis |
| /palette | Search commands (also Ctrl+K) |
| /symbols [QUERY] | Index and search source symbols across supported languages |
| /diagnose | Run basic project manifest diagnostics |
| /subagents TASK | Run planner, architect and tester analysis in parallel |
| /palette | Open searchable command palette (Ctrl+K) |
| /skills, /skill NAME | Discover and activate reusable skills |
| /review | Review changes with the active model |
| /review all | Run up to three independent model reviewers in parallel |
| /undo PATH | Restore the latest pre-write backup |
| /agent TASK | Execute approved coding actions |
| /plan TASK | Show a plan without executing actions |
| /run COMMAND | Execute a shell command with approval |
| /test | Run npm test with approval |\n| /verify | Check JavaScript syntax, then optionally run the full test suite |
| /mcp add ID | Configure an MCP stdio server |
| /mcp tools ID | Discover its tools |
| /mcp list or remove ID | Manage configured MCP servers |
| /hook add EVENT | Configure a lifecycle hook |
| /hook list or remove EVENT | Manage lifecycle hooks |
| /github auth, repo, prs, issues, pr-status, ci | Read-only GitHub and CI queries |
| /github branch NAME | Create a validated branch after confirmation |
| /github commit MESSAGE | Commit already-staged changes after confirmation |
| /github push | Push current branch after confirmation |
| /github pr-create TITLE \| BODY | Create a pull request after confirmation |
| /git status or /git diff | Git inspection |
| /memory show, edit, clear | Persistent project notes |
| /session save NAME | Save the current conversation |
| /session load NAME | Restore a saved conversation |
| /session list | List saved conversations |
| /scroll up, down, top, bottom | Scroll the TUI transcript |
| /clear | Clear conversation |
| /exit | Quit |

## Transactional editing (3.0)\n\nAgent write actions must include `expectedHash` from the latest read; use `null` only when creating a new file. The runtime checks the hash again at commit time, then writes through an fsynced temporary file and atomic rename. Patch actions require a matching SHA-256 and one unique exact-text context. This prevents an agent from silently overwriting edits made by you or another process while it was reasoning. Each edit still requires approval and runs the configured lifecycle hooks.\n\n## Lifecycle hooks

Optional hooks run before or after file writes and shell commands: `before_write`, `after_write`, `before_run`, and `after_run`. Configure them with `/hook add EVENT`; each hook uses an executable plus a JSON argument array and an optional environment-variable allowlist. Every hook invocation requires its own approval. A failed or denied `before_*` hook blocks the operation; an `after_*` hook reports its result after the operation. Hooks run without a shell and do not inherit provider API keys by default.

## MCP tool servers
Configure a local MCP stdio server with `/mcp add ID`. Enter its executable and argument array as JSON, then optionally provide a JSON array of environment-variable names to allow through (for example, `["GITHUB_TOKEN"]`). Provider API keys and the rest of the Termux environment are not inherited by default. Values are read from the process environment and are not copied into the agent config.

Use `/mcp tools ID` to discover tools, `/mcp list` to inspect configured servers, and `/mcp remove ID` to disconnect. Model-proposed MCP calls display their arguments and require per-call approval. Server output is treated as untrusted. Only the MCP `tools/list` and `tools/call` methods are currently supported. MCP servers execute external code with your Android user's permissions; only configure servers you trust.

## Streaming and skills
OpenAI-compatible providers, Anthropic, Gemini and Ollama stream response tokens into the TUI. SSE and Ollama NDJSON events are parsed incrementally with bounded event buffering and request timeouts. Reusable Markdown skills are discovered from `.demon/skills/NAME/SKILL.md` in the project and `~/.config/demon-agent/skills/NAME/SKILL.md` in the user config directory. Activate one with `/skill NAME`; disable with `/skill`. Treat skill files as untrusted project instructions.

GitHub read operations and CI inspection require the official `gh` CLI to be installed and authenticated. Write operations are explicit: `/github branch NAME`, `/github commit MESSAGE` (commits only files already staged by you), `/github push`, and `/github pr-create TITLE | BODY`. Each operation asks for confirmation. No command stages all files automatically. Review staged diffs before committing.

## TUI
Full-screen alternate-screen interface with a continuously animated activity spinner, live streamed tokens, full-width wrapped transcript and live slash-command suggestions, and terminal-resize redraws. Input is handled in raw terminal mode with cursor editing, Home/End, Delete/Backspace, command history (Up/Down), Ctrl+A/E/U/W editing shortcuts, live `/` command menu with prefix filtering, Up/Down selection, Tab completion and Escape dismissal, Ctrl+K command palette, and Ctrl+C exit. Approval prompts use the same in-screen input editor; no readline prompt is drawn outside the UI. Transcript scrolling supports PageUp/PageDown, Ctrl+Up/Ctrl+Down (three-line steps), and `/scroll up`, `/scroll down`, `/scroll bottom`; the scroll offset is clamped to the available transcript and the status bar shows the current offset. Terminal state (raw mode, cursor visibility, alternate screen, signal handlers) is restored on shutdown. `NO_COLOR=1` disables prompt colors; terminal control sequences remain enabled.

Typing `/` opens the command menu immediately; continue typing to filter commands. Use Up/Down to navigate all matches, Tab to complete the selected command, or Escape to dismiss suggestions. The chat transcript spans the terminal width and expands to use the available terminal height.\n\n## Tests
~~~sh
npm test
~~~

## Security
Paths are confined to the project root and escaping symlinks are rejected. Model-proposed writes and shell commands require explicit approval. Shell execution is powerful; inspect commands before approving. No OS-level sandbox is provided; use a disposable workspace for untrusted repositories. Project memory is stored outside the repo under ~/.config/demon-agent/memory/. Saved sessions are stored under ~/.config/demon-agent/sessions/ with owner-only file permissions where supported; conversation content is plaintext, so do not save secrets in sessions. Treat model output and repository content as untrusted.
