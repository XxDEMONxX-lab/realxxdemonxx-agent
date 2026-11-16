"""Provider registry and HTTP adapters. Standard-library only."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Provider:
    name: str
    base_url: str
    kind: str = "openai"  # openai, anthropic, gemini, ollama
    env_key: str | None = None
    models_path: str = "/models"


PROVIDERS: dict[str, Provider] = {
    "openai": Provider("OpenAI", "https://api.openai.com/v1", env_key="OPENAI_API_KEY"),
    "openrouter": Provider("OpenRouter", "https://openrouter.ai/api/v1", env_key="OPENROUTER_API_KEY"),
    "groq": Provider("Groq", "https://api.groq.com/openai/v1", env_key="GROQ_API_KEY"),
    "together": Provider("Together AI", "https://api.together.xyz/v1", env_key="TOGETHER_API_KEY"),
    "cerebras": Provider("Cerebras", "https://api.cerebras.ai/v1", env_key="CEREBRAS_API_KEY"),
    "deepseek": Provider("DeepSeek", "https://api.deepseek.com/v1", env_key="DEEPSEEK_API_KEY"),
    "mistral": Provider("Mistral", "https://api.mistral.ai/v1", env_key="MISTRAL_API_KEY"),
    "fireworks": Provider("Fireworks", "https://api.fireworks.ai/inference/v1", env_key="FIREWORKS_API_KEY"),
    "xai": Provider("xAI", "https://api.x.ai/v1", env_key="XAI_API_KEY"),
    "sambanova": Provider("SambaNova", "https://api.sambanova.ai/v1", env_key="SAMBANOVA_API_KEY"),
    "perplexity": Provider("Perplexity", "https://api.perplexity.ai", env_key="PERPLEXITY_API_KEY"),
    "ollama": Provider("Ollama (local)", "http://127.0.0.1:11434/api", "ollama", None, "/tags"),
    "anthropic": Provider("Anthropic", "https://api.anthropic.com/v1", "anthropic", "ANTHROPIC_API_KEY", "/models"),
    "gemini": Provider("Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini", "GEMINI_API_KEY", "/models"),
}


class ProviderError(RuntimeError):
    pass


def _request(url: str, *, headers: dict[str, str] | None = None,
             body: dict[str, Any] | None = None, timeout: int = 25) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ProviderError("Provider response exceeded 8 MiB limit.")
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", "replace")
        raise ProviderError(f"HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise ProviderError(f"Network error: {exc.reason}") from None
    except (TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProviderError(f"Request failed: {exc}") from None


def api_key(provider_id: str, configured: dict[str, Any]) -> str:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        custom = configured.get("custom_providers", {}).get(provider_id, {})
        env_name = custom.get("env_key")
    else:
        env_name = provider.env_key
    key = os.environ.get(env_name, "") if env_name else ""
    if not key:
        key = configured.get("keys", {}).get(provider_id, "")
    return key


def provider_info(provider_id: str, configured: dict[str, Any]) -> Provider:
    if provider_id in PROVIDERS:
        base = configured.get("base_urls", {}).get(provider_id, PROVIDERS[provider_id].base_url)
        p = PROVIDERS[provider_id]
        return Provider(p.name, base.rstrip("/"), p.kind, p.env_key, p.models_path)
    custom = configured.get("custom_providers", {}).get(provider_id)
    if custom:
        return Provider(custom["name"], custom["base_url"].rstrip("/"), "openai",
                        custom.get("env_key"), "/models")
    raise ProviderError(f"Unknown provider: {provider_id}")


def discover_models(provider_id: str, configured: dict[str, Any]) -> list[str]:
    p = provider_info(provider_id, configured)
    key = api_key(provider_id, configured)
    headers = {"Accept": "application/json", "User-Agent": "DemonAgent/1.0"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if p.kind == "anthropic":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
        payload = _request(p.base_url + "/models?limit=1000", headers=headers)
        return sorted(x["id"] for x in payload.get("data", []) if x.get("id"))
    if p.kind == "gemini":
        if not key:
            raise ProviderError("Set GEMINI_API_KEY or use /key first.")
        payload = _request(p.base_url + "/models?" + urllib.parse.urlencode({"key": key}))
        return sorted(x["name"].removeprefix("models/") for x in payload.get("models", [])
                      if x.get("name") and "generateContent" in x.get("supportedGenerationMethods", []))
    if p.kind == "ollama":
        payload = _request(p.base_url + "/tags", headers=headers)
        return sorted(x["name"] for x in payload.get("models", []) if x.get("name"))
    if not key and provider_id != "openrouter":
        raise ProviderError(f"No API key configured for {provider_id}. Use /key or set its environment variable.")
    payload = _request(p.base_url + p.models_path, headers=headers)
    return sorted(str(x.get("id")) for x in payload.get("data", []) if x.get("id"))


def chat(provider_id: str, model: str, messages: list[dict[str, str]],
         configured: dict[str, Any], temperature: float = 0.2) -> str:
    p = provider_info(provider_id, configured)
    key = api_key(provider_id, configured)
    if p.kind == "anthropic":
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        turns = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01",
                   "content-type": "application/json"}
        payload = _request(p.base_url + "/messages", headers=headers,
                           body={"model": model, "max_tokens": 4096, "system": system,
                                 "messages": turns, "temperature": temperature})
        return "".join(x.get("text", "") for x in payload.get("content", []) if x.get("type") == "text")
    if p.kind == "gemini":
        if not key:
            raise ProviderError("Missing Gemini API key.")
        contents = []
        system_parts = []
        for m in messages:
            if m["role"] == "system":
                system_parts.append(m["content"])
            else:
                contents.append({"role": "model" if m["role"] == "assistant" else "user",
                                 "parts": [{"text": m["content"]}]})
        url = p.base_url + "/models/" + urllib.parse.quote(model, safe="") + ":generateContent?" + urllib.parse.urlencode({"key": key})
        payload = {"contents": contents, "generationConfig": {"temperature": temperature}}
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_parts)}]}
        result = _request(url, headers={"content-type": "application/json"}, body=payload)
        try:
            return "".join(x.get("text", "") for x in result["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError, TypeError):
            raise ProviderError("Gemini returned no text candidate.") from None
    if p.kind == "ollama":
        payload = _request(p.base_url + "/chat", headers={"content-type": "application/json"},
                           body={"model": model, "messages": messages, "stream": False,
                                 "options": {"temperature": temperature}})
        try:
            return payload["message"]["content"]
        except (KeyError, TypeError):
            raise ProviderError("Ollama returned an unexpected response.") from None
    if not key:
        raise ProviderError(f"No API key configured for {provider_id}.")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = _request(p.base_url + "/chat/completions", headers=headers,
                       body={"model": model, "messages": messages, "temperature": temperature})
    try:
        return payload["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise ProviderError("Provider returned an unexpected chat response.") from None
