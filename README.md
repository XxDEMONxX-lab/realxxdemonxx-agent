# REALXXDEMONXX AGENT

A Termux-first AI software engineering agent built with Node.js. It provides a polished terminal workspace, model-provider discovery, conversational coding assistance, project file tools, and approval-gated shell execution.

## Install in Termux

```sh
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
npm start
```

No native modules or heavy dependencies are required.

## First launch

1. Search for a provider such as `openrouter`.
2. Select the number shown beside it.
3. Enter your API key.
4. Enter a model that is enabled for your account and supports chat completions. For coding, choose a model with tool/function calling support.

Settings are saved in `~/.realxxdemonxx-agent/config.json`. Keep this file private.

## Use

Start the agent from the root of the project you want it to work on:

```sh
cd ~/your-project
node ~/realxxdemonxx-agent/index.js
```

Try prompts such as:
- `hi` — verifies the model connection and chat response.
- `Inspect this project and explain its architecture.`
- `Find and fix the bug in src/index.js, then run the relevant tests.`
- `Add a clean help command to this CLI.`

Commands: `/help`, `/clear`, `/provider`, `/status`, `/exit`.

## Capabilities

- Dynamic endpoint discovery from models.dev plus built-in profiles.
- OpenAI-compatible chat completions.
- Project file listing, reading, and writing.
- Shell execution with explicit approval.
- Visible model activity, tool execution, and errors.
- Conversation context and multi-step tool workflows.

The directory count is dynamic and is not a guarantee that every listed provider uses the same API protocol. This release uses OpenAI-compatible `/chat/completions`; providers with different protocols require dedicated adapters. Tool calling depends on the selected provider/model supporting it.

## Troubleshooting

If the agent gives no response:
1. Check the API key, endpoint and model in `~/.realxxdemonxx-agent/config.json`.
2. Confirm that the model is enabled for your provider account.
3. Use a model supporting chat completions. For coding tools, use one supporting tool/function calling.
4. Update the project: `git pull`, then run `npm start`.

If you get a provider HTTP error, the agent now prints the provider's error message instead of silently doing nothing.

## Safety and limitations

File tools are restricted to the current working directory using lexical path checks. Shell commands require you to type `YES`. Review proposed changes and commands before approving them. This is an evolving CLI coding agent, not a full IDE or a guarantee of autonomous production-grade reliability.

## License

MIT
