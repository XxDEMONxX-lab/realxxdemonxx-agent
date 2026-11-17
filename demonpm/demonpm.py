#!/usr/bin/env python3
"""demonpm 4.0: dependency-free Linux/Termux process supervisor."""
import argparse, copy, fcntl, gzip, hashlib, json, os, re, signal, socket, subprocess, sys, threading, time, urllib.request
from pathlib import Path

VERSION = "5.0.0"
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
    # Called before a new process opens the log, never while a child has the file open.
    try:
        if path.stat().st_size < LIMIT: return
    except OSError: return
    for i in range(RETAIN, 0, -1):
        old = path.with_name(path.name + "." + str(i) + ".gz")
        if old.exists():
            if i == RETAIN: old.unlink()
            else: old.replace(path.with_name(path.name + "." + str(i + 1) + ".gz"))
    archive = path.with_name(path.name + ".1")
    if archive.exists(): archive.unlink()
    path.replace(archive)
    with archive.open("rb") as source, gzip.open(str(archive) + ".gz", "wb", compresslevel=6) as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk: break
            target.write(chunk)
    archive.unlink()
def stats(pid):
    try:
        raw = Path("/proc/%d/stat" % pid).read_text()
        # comm is parenthesized and may contain whitespace or closing parentheses.
        fields = raw[raw.rfind(")") + 2:].split()
        return {"rss_mb": round(int(fields[21]) * os.sysconf("SC_PAGE_SIZE") / 1048576, 1),
                "ticks": int(fields[11]) + int(fields[12])}
    except (OSError, ValueError, IndexError): return {"rss_mb": None, "ticks": None}

class Manager:
    def __init__(self):
        HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
        LOGS.mkdir(mode=0o700, exist_ok=True)
        os.chmod(HOME, 0o700)
        self.apps, self.children, self.cpu = load(STATE, {}), {}, {}
        # Never signal persisted PIDs: after a daemon crash they may have been reused.
        for app in self.apps.values():
            app.update(status="stopped", pid=None, next_restart=0)
        self.lock, self.alive = threading.RLock(), True
        self.watch_state = {}

    def save(self):
        with self.lock: atomic(STATE, self.apps)

    def snapshot(self, paths):
        digest = hashlib.sha256()
        for raw in paths:
            root = Path(raw).expanduser()
            items = [root] if root.is_file() else root.rglob("*")
            for item in sorted(items, key=str):
                if not item.is_file() or any(part in (".git","node_modules","__pycache__") for part in item.parts):
                    continue
                try:
                    st = item.stat()
                    digest.update(str(item).encode())
                    digest.update(("%d:%d" % (st.st_mtime_ns, st.st_size)).encode())
                except OSError:
                    continue
        return digest.hexdigest()

    def notify(self, app, event, detail):
        hook = app.get("discord_webhook")
        if not hook: return
        body = json.dumps({"content":"[demonpm] %s: %s" % (event, detail)}).encode()
        req = urllib.request.Request(hook, data=body,
            headers={"Content-Type":"application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=4): pass
        except Exception as exc:
            self.log("demonpm", "webhook notification failed: " + str(exc))

    def log(self, name, message):
        path = LOGS / (name + ".log")
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
                "rss_mb": st["rss_mb"], "command": a["command"], "cwd": a.get("cwd"),
                "health_url": a.get("health_url"), "port": a.get("env", {}).get("PORT"),
                "cluster": a.get("cluster")}

    def start(self, name, stack=None):
        stack = tuple(stack or ())
        if name in stack: raise ValueError("dependency cycle: " + " -> ".join(stack + (name,)))
        stack = stack + (name,)
        with self.lock:
            if name not in self.apps: raise ValueError("unknown process: " + name)
            a = self.apps[name]
            for dep in a.get("requires", []):
                if dep not in self.apps: raise ValueError("unknown dependency: " + dep)
                if self.apps[dep].get("status") != "online": self.start(dep, stack)
            old = self.children.get(name)
            if old and old.poll() is None: return self.describe(name)
            env = os.environ.copy()
            env.update(a.get("env", {}))
            path = LOGS / (name + ".log")
            rotate(path)
            from plugins import run_hooks
            run_hooks(HOME / "plugins", "pre-start", name)
            with path.open("a", encoding="utf-8") as out:
                p = subprocess.Popen(a["command"], cwd=a.get("cwd") or None, env=env,
                    stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                    start_new_session=True, close_fds=True)
            try:
                if a.get("cpu_percent") or a.get("hard_memory_mb"):
                    from limits import attach
                    a["cgroup"] = attach(p.pid, name, a.get("cpu_percent", 0),
                        a.get("hard_memory_mb", 0), a.get("cgroup_root", "/sys/fs/cgroup"))
            except Exception:
                try: os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                p.wait()
                raise
            self.children[name] = p
            a.update(status="online", pid=p.pid, started=time.time(), next_restart=0)
            self.log(name, "started pid=%d" % p.pid)
            self.notify(a, "started", "pid %d" % p.pid)
            try: run_hooks(HOME / "plugins", "post-start", name)
            except Exception as exc: self.log(name, "post-start plugin failed: " + str(exc))
            if a.get("watch"):
                self.watch_state[name] = self.snapshot(a["watch"])
            self.save()
            return self.describe(name)

    def stop(self, name):
        with self.lock:
            if name not in self.apps: raise ValueError("unknown process: " + name)
            a, p = self.apps[name], self.children.get(name)
            from plugins import run_hooks
            try: run_hooks(HOME / "plugins", "pre-stop", name)
            except Exception as exc: self.log(name, "pre-stop plugin failed: " + str(exc))
            a["autorestart"] = False
            pid = p.pid if p and p.poll() is None else None
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
            if a.get("cgroup"):
                try:
                    from limits import detach
                    detach(a.pop("cgroup", None))
                except Exception: pass
            try: run_hooks(HOME / "plugins", "post-stop", name)
            except Exception as exc: self.log(name, "post-stop plugin failed: " + str(exc))
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
                    self.notify(a, "exited", "exit code %s" % code)
                    if code:
                        try:
                            from plugins import run_hooks
                            run_hooks(HOME / "plugins", "on-crash", name)
                        except Exception as exc: self.log(name, "on-crash plugin failed: " + str(exc))
                    if a.get("cgroup"):
                        try:
                            from limits import detach
                            detach(a.pop("cgroup", None))
                        except Exception: pass
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
                if a.get("status") == "online" and a.get("watch"):
                    current = self.snapshot(a["watch"])
                    if current != self.watch_state.get(name, current):
                        self.watch_state[name] = current
                        self.log(name, "watched files changed; restarting")
                        try: self.stop(name); a["autorestart"] = True; self.start(name)
                        except Exception as exc: self.log(name, "watch restart failed: " + str(exc))
                if a.get("status") == "online" and a.get("restart_every"):
                    if time.time() - a.get("started", time.time()) >= a["restart_every"]:
                        self.log(name, "scheduled restart")
                        try: self.stop(name); a["autorestart"] = True; self.start(name)
                        except Exception as exc: self.log(name, "scheduled restart failed: " + str(exc))
                if a.get("status") == "online" and a.get("max_memory_mb"):
                    rss = stats(a.get("pid")).get("rss_mb") if a.get("pid") else None
                    if rss is not None and rss > a["max_memory_mb"]:
                        self.log(name, "memory limit exceeded: %s MB" % rss)
                        try: os.killpg(a["pid"], signal.SIGTERM)
                        except ProcessLookupError: pass
                if a.get("status") == "online":
                    if self.health_ok(a):
                        a["health_failures"] = 0
                    else:
                        a["health_failures"] = a.get("health_failures", 0) + 1
                        if a["health_failures"] >= 3:
                            a["health_failures"] = 0
                            self.log(name, "health check failed 3 times; restarting")
                            self.notify(a, "health failure", "3 consecutive failed probes")
                            try:
                                self.stop(name)
                                a["autorestart"] = True
                                self.start(name)
                            except Exception as e: self.log(name, "health restart failed: " + str(e))

    def dispatch(self, q):
        act, name = q.get("action"), q.get("name")
        if name is not None and (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name) or name in (".", "..")):
            raise ValueError("name must be 1-64 safe characters: letters, digits, dot, underscore or hyphen")
        if act == "ping": return {"version": VERSION}
        if act == "start":
            if not name or name in self.apps: raise ValueError("name missing or already exists")
            cmd = q.get("command")
            if not isinstance(q.get("env", {}), dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in q.get("env", {}).items()):
                raise ValueError("env must be a string-to-string object")
            if not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) and x for x in cmd):
                raise ValueError("command must be a non-empty argument array")
            max_restarts=int(q.get("max_restarts",20))
            if max_restarts < -1: raise ValueError("max_restarts must be -1 or non-negative")
            if int(q.get("restart_every",0)) < 0: raise ValueError("restart_every must be non-negative")
            if int(q.get("cpu_percent",0)) < 0 or int(q.get("hard_memory_mb",0)) < 0:
                raise ValueError("resource limits must be non-negative")
            if q.get("health_url"):
                from urllib.parse import urlparse
                if urlparse(q["health_url"]).scheme not in ("http","https"):
                    raise ValueError("health_url must use HTTP or HTTPS")
            if not isinstance(q.get("watch",[]),list) or not all(isinstance(x,str) for x in q.get("watch",[])):
                raise ValueError("watch must be an array of paths")
            self.apps[name] = {"command": cmd, "cwd": q.get("cwd"), "env": q.get("env", {}),
                "autorestart": q.get("autorestart", True), "max_restarts": max_restarts,
                "health_url": q.get("health_url"), "restarts": 0, "status": "stopped", "pid": None,
                "watch": q.get("watch", []), "restart_every": q.get("restart_every", 0),
                "max_memory_mb": q.get("max_memory_mb", 0), "discord_webhook": q.get("discord_webhook"),
                "requires": q.get("requires", []), "cluster": q.get("cluster"),
                "cpu_percent": q.get("cpu_percent", 0), "hard_memory_mb": q.get("hard_memory_mb", 0),
                "cgroup_root": q.get("cgroup_root", "/sys/fs/cgroup")}
            self.save()
            return self.start(name)
        if act == "describe":
            if name not in self.apps: raise ValueError("unknown process: " + str(name))
            return self.describe(name)
        if act == "scale":
            if name not in self.apps: raise ValueError("unknown base process: " + str(name))
            count, base_port = int(q.get("replicas", 1)), int(q.get("base_port", 0))
            if not 1 <= count <= 32: raise ValueError("replicas must be between 1 and 32")
            if not 1 <= base_port <= 65535 or base_port + count - 1 > 65535:
                raise ValueError("base_port must leave room for all replicas")
            source=self.apps[name]
            replicas=["%s-%d" % (name,index) for index in range(1,count+1)]
            conflict=next((replica for replica in replicas if replica in self.apps),None)
            if conflict: raise ValueError("replica already exists: " + conflict)
            created=[]
            try:
                for index,replica in enumerate(replicas,1):
                    cfg=copy.deepcopy(source)
                    cfg["env"]=dict(cfg.get("env",{}), PORT=str(base_port+index-1))
                    cfg["cluster"]=name
                    cfg["status"]="stopped"; cfg["pid"]=None; cfg["restarts"]=0
                    self.apps[replica]=cfg
                    self.save()
                    created.append(self.start(replica))
            except Exception:
                for replica in replicas:
                    if replica in self.apps:
                        try: self.stop(replica)
                        except Exception: pass
                        self.apps.pop(replica,None)
                self.save()
                raise
            return {"cluster":name,"replicas":created}
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
        lock_path=HOME / "daemon.lock"
        self.lock_file=lock_path.open("a+")
        os.chmod(lock_path,0o600)
        try: fcntl.flock(self.lock_file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError("another demonpm daemon already owns the lock")
        SOCK.unlink(missing_ok=True)
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.bind(str(SOCK)); os.chmod(SOCK, 0o600); s.listen(32); s.settimeout(1)
        threading.Thread(target=self.monitor, daemon=True).start()
        # Recover saved applications on every clean daemon startup; stale PIDs were cleared in __init__.
        saved=load(SAVED,{})
        for app_name,config in saved.items():
            if app_name not in self.apps: self.apps[app_name]=config
            self.apps[app_name]["autorestart"]=True
            try: self.start(app_name)
            except Exception as exc: self.log(app_name,"startup recovery failed: "+str(exc))
        self.save()
        while self.alive:
            try: c, _ = s.accept()
            except socket.timeout: continue
            with c:
                try:
                    data=b""
                    while b"\n" not in data:
                        part=c.recv(65536)
                        if not part: break
                        data+=part
                        if len(data)>1024*1024: raise ValueError("request too large")
                    q = json.loads(data.split(b"\n",1)[0].decode())
                    out = {"ok": True, "result": self.dispatch(q)}
                except Exception as e: out = {"ok": False, "error": str(e)}
                c.sendall((json.dumps(out) + "\n").encode())
        s.close(); SOCK.unlink(missing_ok=True)
        # A deliberate daemon shutdown also shuts down its managed process groups.
        for name in list(self.apps):
            try: self.stop(name)
            except Exception: pass

def alive():
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(1); s.connect(str(SOCK)); s.sendall(b'{"action":"ping"}\n')
            return json.loads(s.recv(4096)).get("ok", False)
    except (OSError, ValueError): return False

def ensure():
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    if alive(): return
    if SOCK.exists():
        probe=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        probe.settimeout(.5)
        error=probe.connect_ex(str(SOCK))
        probe.close()
        if error == 0:
            raise RuntimeError("daemon socket accepts connections but did not answer ping; refusing to unlink a live socket")
        if error not in (2, 111, 61):
            raise RuntimeError("cannot safely determine daemon socket state (errno %s)" % error)
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
        s.settimeout(30); s.connect(str(SOCK)); s.sendall(json.dumps(q).encode() + b"\n")
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
    x.add_argument("--watch", action="append", default=[])
    x.add_argument("--restart-every", type=int, default=0)
    x.add_argument("--max-memory-mb", type=int, default=0)
    x.add_argument("--discord-webhook")
    x.add_argument("--requires", action="append", default=[])
    x.add_argument("--cpu-percent",type=int,default=0)
    x.add_argument("--hard-memory-mb",type=int,default=0)
    x.add_argument("command", nargs=argparse.REMAINDER)
    for a in ("stop", "restart", "delete", "logs"):
        x = sp.add_parser(a); x.add_argument("name")
        if a == "logs": x.add_argument("-n", "--lines", type=int, default=100)
    for a in ("list", "list-json", "save", "resurrect", "daemon-stop", "daemon-foreground", "monit", "start-config", "deploy", "api"): sp.add_parser(a)
    x=sp.add_parser("scale"); x.add_argument("name"); x.add_argument("--replicas",type=int,required=True); x.add_argument("--base-port",type=int,required=True)
    x=sp.add_parser("proxy-sync"); x.add_argument("cluster"); x.add_argument("--upstream-file",required=True); x.add_argument("--upstream-name",required=True); x.add_argument("--nginx",default="nginx")
    x=sp.add_parser("bluegreen"); x.add_argument("old"); x.add_argument("new"); x.add_argument("--upstream-file",required=True); x.add_argument("--upstream-name",required=True); x.add_argument("--server",required=True); x.add_argument("--health-url",required=True); x.add_argument("--nginx",default="nginx")
    sp.choices["api"].add_argument("--port", type=int, default=8765)
    sp.choices["api"].add_argument("--host",default="127.0.0.1")
    sp.choices["api"].add_argument("--tls-cert")
    sp.choices["api"].add_argument("--tls-key")
    sp.choices["api"].add_argument("--create-token",choices=("viewer","operator","admin"))
    sp.choices["start-config"].add_argument("file")
    sp.choices["deploy"].add_argument("name")
    sp.choices["deploy"].add_argument("--branch")
    a = p.parse_args()
    if a.action == "daemon-foreground":
        Manager().serve(); return 0
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
                 autorestart=not a.no_autorestart, max_restarts=a.max_restarts, health_url=a.health_url, watch=a.watch, restart_every=max(0,a.restart_every),
                 max_memory_mb=max(0,a.max_memory_mb), discord_webhook=a.discord_webhook, requires=a.requires,
                 cpu_percent=a.cpu_percent, hard_memory_mb=a.hard_memory_mb)
    elif a.action in ("stop", "restart", "delete", "logs"):
        q["name"] = a.name
        if a.action == "logs": q["lines"] = a.lines
    if a.action == "scale":
        result=request({"action":"scale","name":a.name,"replicas":a.replicas,"base_port":a.base_port})
        print(json.dumps(result,indent=2)); return 0
    if a.action == "proxy-sync":
        rows=request({"action":"list"})["processes"]
        from proxy import switch_upstream, healthy
        servers=[]
        for row in rows:
            if row.get("cluster")==a.cluster and row.get("status")=="online" and row.get("port"):
                if row.get("health_url") and not healthy(row["health_url"]): continue
                servers.append("127.0.0.1:"+str(int(row["port"])))
        if not servers: p.error("no healthy online replicas found")
        print(json.dumps(switch_upstream(a.upstream_file,a.upstream_name,servers,a.nginx),indent=2)); return 0
    if a.action == "bluegreen":
        rows=request({"action":"list"})["processes"]
        old=next((x for x in rows if x["name"]==a.old),None)
        new=next((x for x in rows if x["name"]==a.new),None)
        if not old or not new or new["status"]!="online": p.error("old and new must exist; new must be online")
        from proxy import blue_green
        result=blue_green(a.old,a.new,a.health_url,a.upstream_file,a.upstream_name,a.server,a.nginx,
            stop_old=lambda n: request({"action":"stop","name":n}))
        print(json.dumps(result,indent=2)); return 0
    if a.action == "api":
        request({"action":"list"})
        from api import main as api_main
        args=[sys.argv[0],"--port",str(a.port),"--host",a.host]
        if a.tls_cert: args += ["--tls-cert",a.tls_cert]
        if a.tls_key: args += ["--tls-key",a.tls_key]
        if a.create_token: args += ["--create-token",a.create_token]
        sys.argv=args
        api_main(); return 0
    if a.action == "monit":
        from tui import main as tui_main
        tui_main(); return 0
    if a.action == "start-config":
        from config import load_config
        apps = load_config(a.file)
        existing = {x["name"] for x in request({"action":"list"})["processes"]}
        for app in apps:
            if app["name"] in existing: continue
            request({"action":"start","name":app["name"],"command":app["command"],
                "cwd":app.get("cwd"),"env":app.get("env",{}),
                "autorestart":app.get("autorestart",True),
                "max_restarts":app.get("max_restarts",20),
                "health_url":app.get("health_url"),"watch":app.get("watch",[]),
                "restart_every":app.get("restart_every",0),"max_memory_mb":app.get("max_memory_mb",0),
                "discord_webhook":app.get("discord_webhook"),"requires":app.get("requires",[]),
                "cpu_percent":app.get("cpu_percent",0),"hard_memory_mb":app.get("hard_memory_mb",0)})
        print("Started %d applications in dependency order" % len(apps)); return 0
    if a.action == "deploy":
        listing = request({"action":"list"})["processes"]
        app = next((x for x in listing if x["name"] == a.name), None)
        if not app or not app.get("cwd"): p.error("deploy requires a registered app with --cwd")
        from deploy import deploy
        result = deploy(app["cwd"], a.branch,
            restart=lambda: request({"action":"restart","name":a.name}))
        print(json.dumps(result, indent=2)); return 0
    r = request(q)
    if a.action == "list-json":
        print(json.dumps(r["processes"], indent=2)); return 0
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
