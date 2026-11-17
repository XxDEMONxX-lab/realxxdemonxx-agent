"""Optional cgroup-v2 resource enforcement. Requires delegated cgroup permissions."""
from pathlib import Path
import re

def attach(pid, name, cpu_percent=0, memory_mb=0, root="/sys/fs/cgroup"):
    if not cpu_percent and not memory_mb:
        return None
    if not 1 <= int(cpu_percent or 1) <= 10000:
        raise ValueError("cpu_percent must be between 1 and 10000")
    if memory_mb and int(memory_mb) < 16:
        raise ValueError("cgroup memory limit must be at least 16 MiB")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    root_path=Path(root)
    required=[]
    if cpu_percent: required.append("cpu")
    if memory_mb: required.append("memory")
    try:
        enabled=(root_path/"cgroup.subtree_control").read_text(encoding="ascii").split()
        missing=[controller for controller in required if controller not in enabled]
        if missing:
            raise RuntimeError("cgroup controllers are not enabled in %s: %s" % (root_path,", ".join(missing)))
    except OSError as exc:
        raise RuntimeError("cgroup-v2 subtree is not delegated at %s: %s" % (root_path,exc))
    base = root_path / "demonpm"
    group = base / safe
    try:
        base.mkdir(exist_ok=True)
        group.mkdir(exist_ok=True)
        if cpu_percent:
            period = 100000
            quota = max(1000, period * int(cpu_percent) // 100)
            (group / "cpu.max").write_text("%d %d" % (quota, period), encoding="ascii")
        if memory_mb:
            (group / "memory.max").write_text(str(int(memory_mb) * 1024 * 1024), encoding="ascii")
        (group / "cgroup.procs").write_text(str(int(pid)), encoding="ascii")
    except OSError as exc:
        raise RuntimeError("cgroup-v2 limit setup failed; enable delegated cgroups or remove hard limits: %s" % exc)
    return str(group)

def detach(group):
    if not group: return
    path = Path(group)
    try:
        path.rmdir()
    except OSError:
        pass
