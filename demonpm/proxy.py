"""Nginx upstream generation and atomic blue/green traffic switching."""
import os, re, subprocess, tempfile
from pathlib import Path
from urllib.parse import urlparse
import urllib.request

def healthy(url, timeout=3):
    if not url: return True
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("health URL must be HTTP(S)")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 400
    except Exception:
        return False

def switch_upstream(path, upstream, servers, nginx="nginx"):
    if not upstream.replace("_","").replace("-","").isalnum():
        raise ValueError("invalid nginx upstream name")
    if not servers:
        raise ValueError("upstream server list cannot be empty")
    for server in servers:
        match = re.fullmatch(r"(?:[A-Za-z0-9.-]+|\\[[0-9A-Fa-f:]+\\]):([0-9]{1,5})", server) if isinstance(server, str) else None
        if not match or not 1 <= int(match.group(1)) <= 65535:
            raise ValueError("upstream servers must be host:port entries")
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    content = "upstream %s {\n    least_conn;\n%s\n}\n" % (
        upstream, "".join("    server %s max_fails=2 fail_timeout=5s;\n" % x for x in servers))
    old = target.read_bytes() if target.exists() else None
    fd, tmp_name = tempfile.mkstemp(prefix=".demonpm-", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp_name, 0o644)
        os.replace(tmp_name, target)
        try:
            subprocess.run([nginx, "-t"], check=True, capture_output=True, text=True, timeout=15)
            subprocess.run([nginx, "-s", "reload"], check=True, capture_output=True, text=True, timeout=15)
        except Exception:
            if old is None: target.unlink(missing_ok=True)
            else:
                rollback = target.with_suffix(target.suffix + ".rollback")
                rollback.write_bytes(old); os.replace(rollback, target)
            raise
    finally:
        try: os.unlink(tmp_name)
        except FileNotFoundError: pass
    return {"upstream":upstream,"servers":servers,"config":str(target)}

def blue_green(old_name, new_name, new_health_url, upstream_file, upstream_name,
               new_server, nginx="nginx", stop_old=None):
    if not healthy(new_health_url):
        raise RuntimeError("new instance failed its health check; traffic was not switched")
    result = switch_upstream(upstream_file, upstream_name, [new_server], nginx)
    if stop_old:
        stop_old(old_name)
    result.update({"old":old_name,"new":new_name,"switched":True})
    return result
