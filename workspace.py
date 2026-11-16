"""Guarded project file and shell operations."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path


class WorkspaceError(RuntimeError):
    pass


class Workspace:
    def __init__(self, root: str | Path | None = None):
        self.root = Path(root or Path.cwd()).resolve()

    def resolve(self, raw: str) -> Path:
        candidate = (self.root / raw).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError:
            raise WorkspaceError("Path is outside the project directory.") from None
        return candidate

    def read(self, raw: str, limit: int = 200_000) -> str:
        path = self.resolve(raw)
        if not path.is_file():
            raise WorkspaceError(f"Not a file: {raw}")
        if path.stat().st_size > limit:
            raise WorkspaceError(f"File exceeds {limit} byte read limit.")
        try:
            return path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            raise WorkspaceError(f"Cannot read file: {exc}") from None

    def write(self, raw: str, content: str) -> None:
        path = self.resolve(raw)
        if len(content.encode("utf-8")) > 1_000_000:
            raise WorkspaceError("Refusing to write more than 1 MiB in one operation.")
        path.parent.mkdir(parents=True, exist_ok=True)
        # Resolve again after mkdir to reject symlinked parent directories.
        path = self.resolve(raw)
        if path.exists() and path.is_dir():
            raise WorkspaceError("Target is a directory.")
        path.write_text(content, encoding="utf-8")

    def list_files(self, max_items: int = 200) -> list[str]:
        ignored = {".git", ".venv", "venv", "__pycache__", "node_modules"}
        result = []
        for path in self.root.rglob("*"):
            if any(part in ignored for part in path.relative_to(self.root).parts):
                continue
            if path.is_file():
                result.append(str(path.relative_to(self.root)))
                if len(result) >= max_items:
                    break
        return sorted(result)

    def run(self, command: str, timeout: int = 120) -> tuple[int, str]:
        if not command.strip():
            raise WorkspaceError("Command cannot be empty.")
        try:
            proc = subprocess.run(command, shell=True, cwd=self.root, text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  timeout=timeout, check=False,
                                  env={**os.environ, "PYTHONUNBUFFERED": "1"})
            return proc.returncode, proc.stdout[-30_000:]
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", "replace")
            return 124, str(output)[-30_000:] + "\n[command timed out]"
        except OSError as exc:
            raise WorkspaceError(f"Could not execute command: {exc}") from None
