# REALXXDEMONXX AGENT

A terminal-based AI coding agent designed for Android Termux and Node.js 18+. It supports multiple API endpoints, project-scoped file tools, and approval-gated shell execution.

## Install in Termux

```sh
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
npm start
```

No native modules or heavy dependencies are required.

## Providers

At startup the agent loads built-in endpoint profiles and attempts to download the live provider directory from models.dev. The displayed count depends on directory availability. Built-in profiles include OpenRouter, OpenAI, Groq, Together AI, Fireworks, DeepSeek, Mistral, Ollama, LM Studio and a custom OpenAI-compatible endpoint.

The models.dev directory is a discovery catalog, not a guarantee that every listed provider uses the same API protocol. This first release sends OpenAI-compatible `/chat/completions` requests. Providers using other protocols need a dedicated adapter. Many model vendors can also be reached through an aggregator such as OpenRouter.

## Configure

First run asks for provider, API key and model. Settings are stored at `~/.realxxdemonxx-agent/config.json` with restrictive file permissions. You can edit that file to change provider, endpoint, model, or maxSteps.

Never commit API keys or share your config file.

## Agent tools

- List project files
- Read and write project files
- Run shell commands only after the user types `YES`
- Restricts file tools to the current working directory
- Conversation commands: `/help`, `/clear`, `/provider`, `/exit`

Run the agent from the root of the project you want it to work on. Review generated changes before using them.

## Limitations

This is an initial functional foundation, not a full IDE or a claim of autonomous production-grade reliability. Tool calling depends on the selected model and provider supporting OpenAI-compatible tool calls. Keep backups and review commands and edits.

## License

MIT
