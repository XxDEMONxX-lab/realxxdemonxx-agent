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

Exactly eight providers are supported:
1. OpenRouter
2. Groq
3. NVIDIA NIM
4. DeepSeek
5. Mistral
6. Together AI
7. Fireworks AI
8. Cerebras

Select a provider, enter its API key, then search its live `/models` endpoint. If the list is unavailable, enter the exact model ID manually. Actual model availability, rate limits, and tool-calling support depend on the provider and model.

## What the agent can do

- List and search project files.
- Read and write project files.
- Run shell commands and tests after you explicitly approve them.
- Keep conversation context during a session.
- Inspect tool results and continue working through multiple steps.
- Show connection errors and suggestions rather than silently failing.

Example requests:
- `Inspect this project and explain its architecture.`
- `Find the bug in the login flow, fix it, and run the tests.`
- `Build a Discord.js v14 ticket system that matches this project's style.`
- `Review this project for bugs and security issues.`

## Commands

| Command | Function |
| --- | --- |
| `/chat` | Return to the chat prompt |
| `/menu` | Show quick actions |
| `/files` | List project files |
| `/pwd` | Show current project directory |
| `/providers` | Switch provider and model |
| `/models` | Browse models for current provider |
| `/model` | Enter a model ID manually |
| `/provider` | Show active provider and model |
| `/test` | Test API connectivity |
| `/maxsteps` | Set maximum tool cycles (1–30) |
| `/status` | Show session status |
| `/clear` | Clear conversation context |
| `/help` | Show commands |
| `/exit` | Exit |

## Safety and configuration

Provider settings and API keys are stored in `~/.realxxdemonxx-agent/config.json` with owner-only file permissions. Do not share that file or your API key.

File tools are restricted to the current project directory. Shell commands require you to type `YES` before execution; review commands before approving them.

## Compatibility

This is a terminal coding agent, not a full IDE. Choose a model that supports chat completions and tool/function calling for file-editing workflows. A model may support ordinary chat without supporting the tools this agent needs.

## License

MIT
