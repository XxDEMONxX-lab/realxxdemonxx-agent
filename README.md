# Demon Agent 2.3 ⚡

Node.js-first animated full-screen terminal UI (TUI) coding agent with streamed model output, project search, reusable skills and code review for Termux, Linux, macOS and Windows. Live multi-provider model discovery, automatic provider failover, project-aware coding actions, Git inspection, persistent project memory and approval-gated changes.

## Termux install
~~~sh
pkg update && pkg upgrade -y
pkg install nodejs git -y
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
node start.js
~~~
Node.js 18+ required. No Python or npm dependencies in v2.

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
The model can list/read files and propose writes or shell commands. Every write and command requires approval. Proposed writes show a Git-based diff preview. Existing files receive up to 10 local backups; use `/undo PATH` to restore the latest backup. Iterate by asking it to inspect, patch, then test. Review all changes. This is not an OS-level sandbox.

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
| /status | Configuration |
| /files, /read PATH | Inspect project |\n| /search QUERY | Search tracked and unignored project files |\n| /skills, /skill NAME | Discover and activate reusable skills |\n| /review | Ask the model to review uncommitted Git changes |\n| /test | Run npm test with approval |\n| /github auth, repo, prs, issues, pr-status | Use GitHub CLI (optional `gh`) |
| /write PATH | Preview and write with approval |
| /undo PATH | Restore the latest pre-write backup |
| /agent TASK | Coding workflow |
| /run COMMAND | Execute with approval |
| /git status or /git diff | Git inspection |
| /memory show, edit, clear | Persistent project notes |
| /session save NAME | Save the current conversation |
| /session load NAME | Restore a saved conversation |
| /session list | List saved conversations |
| /scroll up, down, bottom | Scroll the TUI transcript |
| /clear | Clear conversation |
| /exit | Quit |

## TUI
Responsive provider sidebar, wrapped transcript, live animated activity indicator, terminal-resize handling, and transcript scrolling with `/scroll up`, `/scroll down`, and `/scroll bottom`. Readline provides input history with the up/down arrow keys. `NO_COLOR=1` disables prompt colors; terminal cursor and screen control sequences remain enabled.

## Tests
~~~sh
npm test
~~~

## Security
Paths are confined to the project root and escaping symlinks are rejected. Model-proposed writes and shell commands require explicit approval. Shell execution is powerful; inspect commands before approving. No OS-level sandbox is provided; use a disposable workspace for untrusted repositories. Project memory is stored outside the repo under ~/.config/demon-agent/memory/. Saved sessions are stored under ~/.config/demon-agent/sessions/ with owner-only file permissions where supported; conversation content is plaintext, so do not save secrets in sessions. Treat model output and repository content as untrusted.
