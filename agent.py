#!/usr/bin/env python3
"""Demon Agent: a standard-library coding assistant for Termux."""
from __future__ import annotations

import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any

from providers import PROVIDERS, ProviderError, chat, discover_models, provider_info
from workspace import Workspace, WorkspaceError

APP_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "demon-agent"
CONFIG_FILE = APP_DIR / "config.json"
SYSTEM_PROMPT = """You are Demon Agent, a precise senior software engineering assistant.
Give production-quality code. Inspect supplied project context carefully. Explain assumptions,
edge cases, security implications, and tests. Do not claim to have edited files or run commands:
the user must invoke local workspace commands. Never ask the user to reveal secrets.
Prefer minimal, reversible changes and show complete code when practical."""


def load_config() -> dict[str, Any]:
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("configuration root must be an object")
        return data
    except FileNotFoundError:
        return {"provider": "openrouter", "model": "", "keys": {},
                "base_urls": {}, "custom_providers": {}}
    except (json.JSONDecodeError, OSError, ValueError) as exc:
        print(f"Config warning: {exc}. Starting with defaults.", file=sys.stderr)
        return {"provider": "openrouter", "model": "", "keys": {},
                "base_urls": {}, "custom_providers": {}}


def save_config(config: dict[str, Any]) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    temp = CONFIG_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(config, indent=2), encoding="utf-8")
    try:
        temp.chmod(0o600)
        os.replace(temp, CONFIG_FILE)
        APP_DIR.chmod(0o700)
    except OSError:
        os.replace(temp, CONFIG_FILE)


def print_help() -> None:
    print("""
Commands
  /help                 Show this help
  /provider [ID]        List providers or select one
  /key                  Set API key (hidden input)
  /models [all]         Fetch live models for current/all providers
  /model MODEL_ID       Select a model
  /base URL             Override current provider base URL
  /custom               Add an OpenAI-compatible provider
  /status               Show active provider/model (never prints keys)
  /read PATH            Load a project file into conversation context
  /write PATH           Create/replace a file (asks for confirmation)
  /files                List project files
  /run COMMAND          Execute a shell command (asks for confirmation)
  /clear                Clear conversation and loaded file context
  /exit                 Quit
  Any other input       Chat with the selected model
""")


class Agent:
    def __init__(self) -> None:
        self.config = load_config()
        self.workspace = Workspace()
        self.history: list[dict[str, str]] = []
        self.file_context: dict[str, str] = {}

    @property
    def provider(self) -> str:
        return self.config.get("provider", "openrouter")

    @property
    def model(self) -> str:
        return self.config.get("model", "")

    def run(self) -> None:
        print("\033[1;36mDemon Agent\033[0m — Termux coding assistant")
        print(f"Project: {self.workspace.root}")
        print("Type /help for commands. Configure a provider with /provider and /key.")
        while True:
            try:
                line = input("\n\033[1;32mdemon>\033[0m ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nBye.")
                return
            if not line:
                continue
            if line.startswith("/"):
                if not self.command(line):
                    return
            else:
                self.ask(line)

    def command(self, line: str) -> bool:
        command, _, arg = line.partition(" ")
        arg = arg.strip()
        try:
            if command == "/help":
                print_help()
            elif command == "/provider":
                self.select_provider(arg)
            elif command == "/key":
                self.set_key()
            elif command == "/models":
                self.models(arg == "all")
            elif command == "/model":
                if not arg:
                    print("Usage: /model MODEL_ID")
                else:
                    self.config["model"] = arg
                    self.persist()
                    print(f"Model set to {arg}")
            elif command == "/base":
                if not arg:
                    print("Usage: /base https://host/v1")
                else:
                    self.config.setdefault("base_urls", {})[self.provider] = arg.rstrip("/")
                    self.persist()
                    print("Base URL saved.")
            elif command == "/custom":
                self.add_custom()
            elif command == "/status":
                print(f"Provider: {self.provider}\nModel: {self.model or '(not selected)'}")
                print(f"Project: {self.workspace.root}")
            elif command == "/read":
                self.load_file(arg)
            elif command == "/write":
                self.write_file(arg)
            elif command == "/files":
                for item in self.workspace.list_files():
                    print(item)
            elif command == "/run":
                self.run_command(arg)
            elif command == "/clear":
                self.history.clear()
                self.file_context.clear()
                print("Conversation and loaded file context cleared.")
            elif command in ("/exit", "/quit"):
                return False
            else:
                print(f"Unknown command: {command}. Type /help.")
        except (ProviderError, WorkspaceError, OSError, ValueError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
        return True

    def persist(self) -> None:
        save_config(self.config)

    def select_provider(self, provider_id: str) -> None:
        choices = {**PROVIDERS, **self.config.get("custom_providers", {})}
        if not provider_id:
            for key, value in choices.items():
                label = value.name if hasattr(value, "name") else value.get("name", key)
                print(f"  {key:14} {label}")
            print("Use /provider ID to select.")
            return
        if provider_id not in choices:
            raise ValueError(f"Unknown provider '{provider_id}'. Use /provider to list.")
        self.config["provider"] = provider_id
        self.config["model"] = ""
        self.persist()
        print(f"Selected {provider_id}. Run /models to fetch available models.")

    def set_key(self) -> None:
        provider = provider_info(self.provider, self.config)
        if provider.kind == "ollama":
            print("Ollama local endpoint does not require an API key.")
            return
        key = getpass.getpass(f"API key for {self.provider} (hidden): ").strip()
        if not key:
            print("No change.")
            return
        self.config.setdefault("keys", {})[self.provider] = key
        self.persist()
        print("API key saved with restricted file permissions.")

    def models(self, all_providers: bool = False) -> None:
        targets = list({**PROVIDERS, **self.config.get("custom_providers", {})}) if all_providers else [self.provider]
        for provider_id in targets:
            try:
                found = discover_models(provider_id, self.config)
                print(f"\n{provider_id} — {len(found)} model(s)")
                for item in found[:250]:
                    print("  " + item)
                if len(found) > 250:
                    print(f"  ... {len(found) - 250} more")
                if provider_id == self.provider and found and not self.model:
                    self.config["model"] = found[0]
                    self.persist()
                    print(f"Selected first model: {found[0]}")
            except ProviderError as exc:
                print(f"{provider_id}: {exc}", file=sys.stderr)

    def add_custom(self) -> None:
        provider_id = input("Provider ID (lowercase, e.g. myserver): ").strip().lower()
        name = input("Display name: ").strip()
        base = input("OpenAI-compatible base URL (e.g. https://host/v1): ").strip().rstrip("/")
        env_key = input("API-key environment variable (optional): ").strip() or None
        if not provider_id or not provider_id.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Provider ID must contain only letters, numbers, - or _.")
        if provider_id in PROVIDERS:
            raise ValueError("That ID is already built in.")
        if not name or not base.startswith(("https://", "http://")):
            raise ValueError("A display name and HTTP(S) base URL are required.")
        self.config.setdefault("custom_providers", {})[provider_id] = {
            "name": name, "base_url": base, "env_key": env_key}
        self.config["provider"] = provider_id
        self.config["model"] = ""
        self.persist()
        print(f"Added and selected {provider_id}. Run /models.")

    def load_file(self, raw: str) -> None:
        if not raw:
            print("Usage: /read PATH")
            return
        content = self.workspace.read(raw)
        self.file_context[raw] = content
        print(f"Loaded {raw} ({len(content)} characters) into model context.")

    def write_file(self, raw: str) -> None:
        if not raw:
            print("Usage: /write PATH, then paste content; finish with a line containing .done")
            return
        print(f"Enter file content for {raw}. Finish with a line containing .done")
        lines = []
        while True:
            line = input()
            if line == ".done":
                break
            lines.append(line)
        content = "\n".join(lines) + "\n"
        answer = input(f"Replace/write {raw} ({len(content)} chars)? [y/N] ").strip().lower()
        if answer == "y":
            self.workspace.write(raw, content)
            print("File written.")
        else:
            print("Cancelled.")

    def run_command(self, command: str) -> None:
        if not command:
            print("Usage: /run COMMAND")
            return
        print(f"Working directory: {self.workspace.root}")
        print(f"Command: {command}")
        if input("Execute this shell command? [y/N] ").strip().lower() != "y":
            print("Cancelled.")
            return
        code, output = self.workspace.run(command)
        print(output or "(no output)")
        print(f"Exit code: {code}")

    def ask(self, prompt: str) -> None:
        if not self.model:
            print("No model selected. Run /models after configuring your provider.")
            return
        context = ""
        if self.file_context:
            context = "\n\nPROJECT FILES (read-only context):\n" + "\n".join(
                f"\n--- {name} ---\n{content}" for name, content in self.file_context.items())
        messages = [{"role": "system", "content": SYSTEM_PROMPT + context}]
        messages.extend(self.history[-20:])
        messages.append({"role": "user", "content": prompt})
        try:
            answer = chat(self.provider, self.model, messages, self.config)
            print("\n" + answer)
            self.history.extend([{"role": "user", "content": prompt},
                                 {"role": "assistant", "content": answer}])
            self.history = self.history[-40:]
        except ProviderError as exc:
            print(f"Provider error: {exc}", file=sys.stderr)


def main() -> int:
    try:
        Agent().run()
        return 0
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
