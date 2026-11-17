"""Safe fast-forward Git deployment with a clean-tree rollback boundary."""
from __future__ import annotations
import subprocess
from pathlib import Path

def run(args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True)

def deploy(repo, branch=None, restart=None):
    root = Path(repo).expanduser().resolve()
    if not (root / ".git").exists():
        raise ValueError("deploy directory is not a Git working tree")
    status = run(["git","status","--porcelain"], root).stdout
    if status.strip():
        raise ValueError("refusing deployment: Git working tree is not clean")
    previous = run(["git","rev-parse","HEAD"], root).stdout.strip()
    try:
        run(["git","fetch","--all","--prune"], root)
        args = ["git","pull","--ff-only"]
        if branch: args += ["origin", branch]
        run(args, root)
        if restart: restart()
        current = run(["git","rev-parse","HEAD"], root).stdout.strip()
        return {"previous": previous, "current": current, "rolled_back": False}
    except Exception:
        # Rollback is safe because deployment refuses dirty trees before fetching.
        subprocess.run(["git","reset","--hard",previous], cwd=root, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if restart:
            try: restart()
            except Exception: pass
        raise
