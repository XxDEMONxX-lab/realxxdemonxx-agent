# Demon Agent

A lightweight, command-driven AI coding agent designed for **Termux on Android** and ordinary Python 3.10+ environments. It uses only the Python standard library.

## Install in Termux

```sh
pkg update && pkg upgrade
pkg install python git
git clone https://github.com/XxDEMONxX-lab/realxxdemonxx-agent.git
cd realxxdemonxx-agent
python agent.py
```

Optional global launcher:

```sh
mkdir -p "$HOME/.local/bin"
cp agent.py providers.py workspace.py "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/agent.py"
ln -sf "$HOME/.local/bin/agent.py" "$HOME/.local/bin/demon"
export PATH="$HOME/.local/bin:$PATH"
``

## First run

Use `/provider` to choose a provider and `/key` to save its API key. Keys are stored in `~/.config/demon-agent/config.json` with owner-only permissions where supported. Prefer environment variables for CI or shared devices.

```sh
export OPENAI_API_KEY="..."
python agent.py
``

## Providers and model discovery

Built-in providers include OpenAI, OpenRouter, Groq, Together, Cerebras, DeepSeek, Mistral, Fireworks, xAI, SambaNova, Perplexity, Ollama, Anthropic, and Google Gemini. OpenAI-compatible providers use their own API base URLs. Run `/models` to fetch the current model list from the selected provider; `/models all` attempts discovery across configured providers. Discovery is live and can fail if a provider is offline, rate-limiting, or requires a key.

Custom OpenAI-compatible endpoints can be added with `/custom`.

## Interactive commands

| Command | Purpose |
|---|---|
| `/help` | Show commands |
| `/provider` | List/select provider |
| `/key` | Set API key (input is hidden) |
| `/models` | Fetch provider models |
| `/model ID` | Select a model |
| `/base URL` | Set custom OpenAI-compatible base URL |
| `/custom` | Add a custom provider |
| `/status` | Show active configuration |
| `/read PATH` | Read a project file into context |
| `/write PATH` | Create/replace a file with approval |
| `/run COMMAND` | Run a shell command after confirmation |
| `/files` | List project files |
| `/clear` | Clear conversation history |
| `/exit` | Quit |

Normal text is sent to the selected model. The agent includes loaded file context and recent conversation turns. It does not silently execute model-generated shell commands or modify files: use explicit local commands and review changes yourself.

## Safety and limitations

- Shell commands require interactive confirmation. Do not approve commands you do not understand.
- File operations are confined to the current project directory; path traversal and symlink escapes are rejected.
- API keys are never included in prompts or printed by `/status`.
- Provider APIs, model availability, pricing, context windows, and tool support vary. A listed model may not support chat completions.
- This is a terminal coding assistant, not an autonomous sandbox. Review generated code and run tests before shipping.

## Requirements

Python 3.10+; no pip dependencies. HTTPS connectivity is required for hosted providers. Ollama requires a reachable local or LAN Ollama server.
