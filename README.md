# REALXXDEMONXX AGENT

A Termux-compatible AI coding agent with an interactive terminal workflow: inspect a project, plan changes, edit files, run commands with approval, and verify results.

## Install on Termux

```sh
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
npm run check
npm start
```

To update an existing installation:

```sh
cd ~/realxxdemonxx-agent
git pull
npm run check
npm start
```

## Supported API providers

This build intentionally supports exactly eight providers:

1. OpenRouter
2. Groq
3. NVIDIA NIM
4. DeepSeek
5. Mistral
6. Together AI
7. Fireworks AI
8. Cerebras

All eight are configured through OpenAI-compatible chat-completions endpoints. Select a provider, enter its API key, then search its live `/models` endpoint. If the model list is unavailable, type the exact model ID manually. Choose a model that supports tool/function calling for file editing and terminal-agent features.

## Agent workflow

Start the agent from the project directory you want it to work on:

```sh
cd ~/your-project
node ~/realxxdemonxx-agent/index.js
```

The agent can:
- Inspect project folders and files.
- Search source code for text.
- Read and write project files.
- Run tests, scripts and shell commands after you approve them.
- Keep conversation context across a coding task.
- Report tool results and API errors instead of silently failing.

Example requests:
- `Inspect this project and explain its architecture.`
- `Find the bug in the login flow, fix it, and run the tests.`
- `Build a Discord.js v14 ticket system that matches the existing project style.`

## Commands

| Command | Function |
| --- | --- |
| `/providers` | Switch provider and model |
| `/models` | Browse models for the current provider |
| `/model` | Enter a model ID manually |
| `/provider` | Show active provider and model |
| `/test` | Test API connectivity |
| `/maxsteps` | Set maximum tool cycles (1–30) |
| `/status` | Show workspace status |
| `/clear` | Clear conversation context |
| `/help` | Show commands |
| `/exit` | Exit |

## Settings and safety

Provider settings and API keys are stored in `~/.realxxdemonxx-agent/config.json` with owner-only file permissions. Do not share that file or your API key.

File tools are restricted to the current project directory and reject symlinks that resolve outside it. Shell commands require you to type `YES` before execution. Review commands before approving them.

## Compatibility notes

This is an evolving coding-agent CLI, not a full IDE. API providers may differ in model availability, rate limits and tool-calling support. If a model cannot use tools, select a coding model that supports function/tool calling. No claim is made that every model offered by a provider works with this agent.

## License

MIT
