#!/usr/bin/env python3
"""demonpm 4.0: dependency-free Linux/Termux process supervisor."""
import argparse, json, os, signal, socket, subprocess, sys, threading, time, urllib.request
from pathlib import Path

VERSION = "4.0.0"
HOME = Path(os.environ.get("DEMONPM_HOME", Path.home() / ".demonpm"))
SOCK, STATE, SAVED, LOGS = (HOME / x for x in ("demonpm.sock", "state.json", "saved.json", "logs"))
LIMIT, RETAIN = 5 * 1024 * 1024, 3

def atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    os.chmod(path, 0o600)

def load(path, default):
    try: return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError): return default

def rotate(path):
    try:
        if path.stat().st_size < LIMIT: return
    except OSError: return
    path.with_name(path.name + "." + str(RETAIN)).unlink(missing_ok=True)
    for i in range(RETAIN - 1, 0, -1):
        old = path.with_name(path.name + "." + str(i))
        if old.exists(): old.replace(path.with_name(path.name + "." + str(i + 1)))
    path.replace(path.with_name(path.name + ".1"))

def stats(pid):
    try:
        s = Path("/proc/%d/stat" % pid).read_text().split()
        return {"rss_mb": round(int(s[23]) * os.sysconf("SC_PAGE_SIZE") / 1048576, 1),
                "ticks": int(s[13]) + int(s[14])}
    except (OSError, ValueError, IndexError): return {"rss_mb": None, "ticks": None}

class Manager:
    def __init__(self):
        HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
        LOGS.mkdir(mode=0o700, exist_ok=True)
        os.chmod(HOME, 0o700)
        self.apps, self.children, self.cpu = load(STATE, {}), {}, {}
        self.lock, self.alive = threading.RLock(), True

    def save(self):
        with self.lock: atomic(STATE, self.apps)

    def log(self, name, message):
        path = LOGS / (name + ".log")
        rotate(path)
        with path.open("a", encoding="utf-8") as f:
            f.write(time.strftime("[%Y-%m-%d %H:%M:%S] ") + message + "\n")

    def describe(self, name):
        a = self.apps[name]
        p = self.children.get(name)
        pid = p.pid if p and p.poll() is None else a.get("pid")
        st = stats(pid) if pid else {"rss_mb": None, "ticks": None}
        cpu = None
        if st["ticks"] is not None:
            old, stamp = self.cpu.get(name, (st["ticks"], time.monotonic()))
            cpu = round(max(0, st["ticks"] - old) / os.sysconf("SC_CLK_TCK") /
                        max(.01, time.monotonic() - stamp) * 100, 1)
            self.cpu[name] = (st["ticks"], time.monotonic())
        return {"name": name, "status": a.get("status", "stopped"), "pid": pid,
                "uptime": int(time.time() - a["started"]) if a.get("status") == "online" else 0,
                "restarts": a.get("restarts", 0), "cpu_percent": cpu,
                "rss_mb": st["rss_mb"], "command": a["command"], "cwd": a.get("cwd")}

    def start(self, name):
        with self.lock:
            a = self.apps[name]
            old = self.children.get(name)
            if old and old.poll() is None: return self.describe(name)
            env = os.environ.copy()
            env.update(a.get("env", {}))
            path = LOGS / (name + ".log")
            rotate(path)
            with path.open("a", encoding="utf-8") as out:
                p = subprocess.Popen(a["command"], cwd=a.get("cwd") or None, env=env,
                    stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                    start_new_session=True, close_fds=True)
            self.children[name] = p
            a.update(status="online", pid=p.pid, started=time.time(), next_restart=0)
            self.log(name, "started pid=%d" % p.pid)
            self.save()
            return self.describe(name)

    def stop(self, name):
        with self.lock:
            if name not in self.apps: raise ValueError("unknown process: " + name)
            a, p = self.apps[name], self.children.get(name)
            a["autorestart"] = False
            pid = p.pid if p and p.poll() is None else a.get("pid")
            if pid:
                try: os.killpg(int(pid), signal.SIGTERM)
                except ProcessLookupError: pass
                deadline = time.monotonic() + 8
                while p and p.poll() is None and time.monotonic() < deadline: time.sleep(.1)
                if p and p.poll() is None:
                    try: os.killpg(p.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    p.wait()
            self.children.pop(name, None)
            a.update(status="stopped", pid=None, next_restart=0)
            self.log(name, "stopped")
            self.save()
            return self.describe(name)

    def health_ok(self, a):
        if not a.get("health_url"): return True
        try:
            with urllib.request.urlopen(a["health_url"], timeout=3) as r: return 200 <= r.status < 400
        except Exception: return False

    def monitor(self):
        while self.alive:
            time.sleep(1)
            for name in list(self.apps):
                a = self.apps.get(name)
                if not a: continue
                p = self.children.get(name)
                if p and p.poll() is not None:
                    code = p.returncode
                    self.children.pop(name, None)
                    a.update(status="stopped", pid=None, last_exit=code)
                    self.log(name, "exited code=%s" % code)
                    count, limit = a.get("restarts", 0), a.get("max_restarts", 20)
                    if a.get("autorestart", True) and (limit < 0 or count < limit):
                        a["restarts"] = count + 1
                        a["next_restart"] = time.time() + min(60, 2 ** min(count, 6))
                    self.save()
                if a.get("next_restart", 0) and time.time() >= a["next_restart"]:
                    try: self.start(name)
                    except Exception as e:
                        self.log(name, "restart failed: " + str(e))
                        a["next_restart"] = time.time() + 60
                if a.get("status") == "online" and not self.health_ok(a):
                    self.log(name, "health check failed; restarting")
                    try:
                        self.stop(name)
                        a["autorestart"] = True
                        self.start(name)
                    except Exception as e: self.log(name, "health restart failed: " + str(e))

    def dispatch(self, q):
        act, name = q.get("action"), q.get("name")
        if act == "ping": return {"version": VERSION}
        if act == "start":
            if not name or name in self.apps: raise ValueError("name missing or already exists")
            cmd = q.get("command")
            if not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) for x in cmd):
                raise ValueError("command must be a non-empty argument array")
            self.apps[name] = {"command": cmd, "cwd": q.get("cwd"), "env": q.get("env", {}),
                "autorestart": q.get("autorestart", True), "max_restarts": q.get("max_restarts", 20),
                "health_url": q.get("health_url"), "restarts": 0, "status": "stopped", "pid": None}
            self.save()
            return self.start(name)
        if act == "list": return {"processes": [self.describe(n) for n in sorted(self.apps)]}
        if act == "stop": return self.stop(name)
        if act == "restart":
            self.stop(name); self.apps[name]["autorestart"] = True
            return self.start(name)
        if act == "delete":
            self.stop(name); del self.apps[name]; self.save()
            return {"deleted": name}
        if act == "logs":
            if name not in self.apps: raise ValueError("unknown process: " + str(name))
            try: lines = (LOGS / (name + ".log")).read_text(errors="replace").splitlines()
            except OSError: lines = []
            return {"logs": "\n".join(lines[-max(1, min(int(q.get("lines", 100)), 5000)):])}
        if act == "save": atomic(SAVED, self.apps); return {"saved": str(SAVED)}
        if act == "resurrect":
            saved = load(SAVED, {}); started = []
            for n, a in saved.items():
                if n not in self.apps: self.apps[n] = a
                self.apps[n]["autorestart"] = True
                try: started.append(self.start(n))
                except Exception as e: self.log(n, "resurrect failed: " + str(e))
            self.save(); return {"started": started}
        if act == "shutdown": self.alive = False; return {"shutdown": True}
        raise ValueError("unknown action: " + str(act))

    def serve(self):
        SOCK.unlink(missing_ok=True)
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.bind(str(SOCK)); os.chmod(SOCK, 0o600); s.listen(32); s.settimeout(1)
        threading.Thread(target=self.monitor, daemon=True).start()
        while self.alive:
            try: c, _ = s.accept()
            except socket.timeout: continue
            with c:
                try:
                    q = json.loads(c.recv(1024 * 1024).decode())
                    out = {"ok": True, "result": self.dispatch(q)}
                except Exception as e: out = {"ok": False, "error": str(e)}
                c.sendall((json.dumps(out) + "\n").encode())
        s.close(); SOCK.unlink(missing_ok=True)

def alive():
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(1); s.connect(str(SOCK)); s.sendall(b'{"action":"ping"}')
            return json.loads(s.recv(4096)).get("ok", False)
    except (OSError, ValueError): return False

def ensure():
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    if alive(): return
    SOCK.unlink(missing_ok=True)
    log = (HOME / "daemon.log").open("a")
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_daemon"],
        stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
    log.close()
    for _ in range(50):
        if alive(): return
        time.sleep(.1)
    raise RuntimeError("daemon failed to start; inspect " + str(HOME / "daemon.log"))

def request(q):
    ensure()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(30); s.connect(str(SOCK)); s.sendall(json.dumps(q).encode())
        data = b""
        while b"\n" not in data:
            part = s.recv(65536)
            if not part: break
            data += part
    r = json.loads(data.decode())
    if not r.get("ok"): raise RuntimeError(r.get("error", "daemon error"))
    return r["result"]

def main():
    p = argparse.ArgumentParser(prog="demonpm")
    p.add_argument("--version", action="version", version="demonpm " + VERSION)
    sp = p.add_subparsers(dest="action", required=True)
    x = sp.add_parser("start"); x.add_argument("name"); x.add_argument("--cwd")
    x.add_argument("--env", action="append", default=[]); x.add_argument("--no-autorestart", action="store_true")
    x.add_argument("--max-restarts", type=int, default=20); x.add_argument("--health-url")
    x.add_argument("command", nargs=argparse.REMAINDER)
    for a in ("stop", "restart", "delete", "logs"):
        x = sp.add_parser(a); x.add_argument("name")
        if a == "logs": x.add_argument("-n", "--lines", type=int, default=100)
    for a in ("list", "save", "resurrect", "daemon-stop"): sp.add_parser(a)
    a = p.parse_args()
    if a.action == "_daemon": Manager().serve(); return 0
    if a.action == "daemon-stop": request({"action": "shutdown"}); return 0
    q = {"action": a.action}
    if a.action == "start":
        cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
        if not cmd: p.error("start requires command after --")
        env = {}
        for item in a.env:
            if "=" not in item: p.error("--env expects KEY=VALUE")
            k, v = item.split("=", 1); env[k] = v
        q.update(name=a.name, command=cmd, cwd=a.cwd, env=env,
                 autorestart=not a.no_autorestart, max_restarts=a.max_restarts, health_url=a.health_url)
    elif a.action in ("stop", "restart", "delete", "logs"):
        q["name"] = a.name
        if a.action == "logs": q["lines"] = a.lines
    r = request(q)
    if a.action == "list":
        for z in r["processes"]:
            print("%-18s %-8s pid=%s cpu=%s%% mem=%sMB restarts=%s" %
                (z["name"], z["status"], z["pid"] or "-", z["cpu_percent"] if z["cpu_percent"] is not None else "-",
                 z["rss_mb"] if z["rss_mb"] is not None else "-", z["restarts"]))
    elif a.action == "logs": print(r["logs"])
    else: print(json.dumps(r, indent=2))
    return 0

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "_daemon": Manager().serve()
        else: raise SystemExit(main())
    except (RuntimeError, OSError, ValueError) as e:
        print("demonpm: " + str(e), file=sys.stderr); raise SystemExit(1)
