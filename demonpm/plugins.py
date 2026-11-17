"""Bubblewrap-isolated plugin hooks. Fail closed if the sandbox runtime is unavailable."""
import json, os, shutil, signal, subprocess
from pathlib import Path

HOOKS = {"pre-start","post-start","pre-stop","post-stop","on-crash"}

def load_plugins(root):
    root = Path(root).expanduser().resolve()
    manifest = root / "plugins.json"
    if not manifest.exists(): return []
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(data,list): raise ValueError("plugins.json must contain an array")
    result=[]
    for item in data:
        if not isinstance(item,dict) or item.get("hook") not in HOOKS:
            raise ValueError("invalid plugin hook manifest entry")
        command=item.get("command")
        if not isinstance(command,list) or not command or not all(isinstance(x,str) for x in command):
            raise ValueError("plugin command must be a non-empty argument array")
        cwd=(root / item.get("cwd",".")).resolve()
        if cwd != root and root not in cwd.parents:
            raise ValueError("plugin cwd must stay inside plugin directory")
        result.append((item["hook"],command,cwd,max(1,min(int(item.get("timeout",5)),30))))
    return result

def run_hooks(root, hook, app_name, timeout=5):
    if hook not in HOOKS: raise ValueError("unknown plugin hook")
    root=Path(root).expanduser().resolve()
    selected=[x for x in load_plugins(root) if x[0]==hook]
    if not selected: return
    bwrap=shutil.which("bwrap")
    if not bwrap:
        raise RuntimeError("plugins require bubblewrap (bwrap); hooks fail closed without OS isolation")
    binds=[]
    for path in ("/usr","/bin","/sbin","/lib","/lib64","/etc"):
        if Path(path).exists(): binds += ["--ro-bind",path,path]
    for _,command,cwd,configured_timeout in selected:
        relative=cwd.relative_to(root)
        inside="/plugin" if str(relative)=="." else "/plugin/"+relative.as_posix()
        argv=[bwrap,"--die-with-parent","--new-session","--unshare-all",
              "--ro-bind",str(root),"/plugin","--proc","/proc","--dev","/dev",
              "--tmpfs","/tmp","--dir","/run","--chdir",inside,
              "--clearenv","--setenv","PATH","/usr/local/bin:/usr/bin:/bin",
              "--setenv","HOME","/tmp","--setenv","DEMONPM_APP",app_name,
              "--setenv","DEMONPM_HOOK",hook]
        argv += binds + ["--"] + command
        proc=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,close_fds=True,start_new_session=True)
        try:
            code=proc.wait(timeout=min(timeout,configured_timeout))
            if code: raise RuntimeError("plugin exited with status %d" % code)
        except Exception:
            try: os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait()
            raise
