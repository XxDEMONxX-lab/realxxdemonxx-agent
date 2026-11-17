"""Resource-limited plugin hooks. Hooks are NOT a security boundary."""
import json, os, subprocess
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
        result.append((item["hook"],command,cwd,int(item.get("timeout",5))))
    return result

def run_hooks(root, hook, app_name, timeout=5):
    if hook not in HOOKS: raise ValueError("unknown plugin hook")
    for selected, command, cwd, configured_timeout in load_plugins(root):
        if selected != hook: continue
        env={"PATH":os.environ.get("PATH",""),"HOME":str(cwd),
             "DEMONPM_APP":app_name,"DEMONPM_HOOK":hook}
        try:
            subprocess.run(command,cwd=str(cwd),env=env,stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,
                timeout=max(1,min(configured_timeout,timeout)),close_fds=True)
        except Exception as exc:
            raise RuntimeError("plugin hook %s failed: %s" % (hook,exc))
