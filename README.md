# REALXXDEMONXX AGENT

A Termux-first AI software engineering agent built with Node.js. It provides a terminal workspace, searchable provider directory, model browser, saved favorites, conversational coding assistance, project file tools, and approval-gated shell execution.

## Install in Termux

```sh
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
npm start
```

No native modules or heavy dependencies are required.

## Provider Control Center

On first launch, the agent opens a searchable provider manager.

- Search provider names and IDs.
- Browse provider categories.
- Move through paginated results.
- Mark providers as favorites with `f <number>`.
- Refresh the live directory with `r`.
- See the active provider and endpoint.
- Select a model from the provider's `/models` endpoint when available.
- Fall back to the models.dev catalog or manually enter a model ID.
- Save provider, endpoint, model, API key, and favorites locally.

The provider directory is discovered from models.dev, with built-in profiles for common providers and local endpoints. Its size changes as the directory changes; it is not a promise that every provider uses the same protocol.

## Agent commands

| Command | Action |
| --- | --- |
| `/providers` | Open provider search, categories and model selection |
| `/models` | Browse models from the active provider |
| `/model` | Enter a model ID manually |
| `/provider` | Show active provider, endpoint and model |
| `/favorites` | Show saved favorite providers |
| `/test` | Test the current API connection |
| `/maxsteps` | Change agent tool/reasoning step limit (1–30) |
| `/status` | Show workspace and runtime settings |
| `/clear` | Clear conversation context |
| `/help` | Show commands and examples |
| `/exit` | Close the agent |

Provider and model changes are saved automatically in `~/.realxxdemonxx-agent/config.json`. Keep this file private because it contains your API key.

## Coding features

- Project file listing, reading and writing.
- Shell execution after explicit approval.
- Multi-step tool workflows and conversation context.
- Visible model activity, tool execution and provider errors.
- Configurable agent step limit.

Start the agent from the root of the project you want it to work on:

```sh
cd ~/your-project
node ~/realxxdemonxx-agent/index.js
```

## API compatibility

This release sends OpenAI-compatible `/chat/completions` requests. The directory is for discovery, not a guarantee that every provider implements this API. Providers using Anthropic, Gemini, or another protocol need dedicated adapters. Tool calling also depends on provider/model support.

## Troubleshooting

- Run `/test` to check the configured endpoint and model.
- Run `/providers` to switch providers or re-enter credentials.
- Run `/models` to browse the current provider's available models.
- Use `/model` to enter an exact model ID manually.
- If the directory is unavailable, built-in provider profiles remain available.

## Safety and limitations

File tools are restricted to the current working directory using lexical path checks. Shell commands require you to type `YES`. Review proposed changes and commands before approving them. This is an evolving CLI coding agent, not a full IDE or a guarantee of autonomous production-grade reliability.

## License

MIT
