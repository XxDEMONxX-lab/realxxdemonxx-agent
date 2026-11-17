"""Strict JSON ecosystem configuration validation and dependency ordering."""
from __future__ import annotations
import json
from pathlib import Path

def load_config(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("apps"), list):
        raise ValueError("config must be an object with an apps array")
    apps, names = data["apps"], set()
    for app in apps:
        if not isinstance(app, dict): raise ValueError("each app must be an object")
        name, command = app.get("name"), app.get("command")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("app names must be unique non-empty strings")
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise ValueError("app %s command must be a non-empty string array" % name)
        if not isinstance(app.get("env", {}), dict) or not all(isinstance(k,str) and isinstance(v,str) for k,v in app.get("env",{}).items()):
            raise ValueError("app %s env must map strings to strings" % name)
        names.add(name)
    by_name = {a["name"]: a for a in apps}
    result, temporary, permanent = [], set(), set()
    def visit(name):
        if name in permanent: return
        if name in temporary: raise ValueError("dependency cycle involving " + name)
        if name not in by_name: raise ValueError("unknown dependency " + name)
        temporary.add(name)
        deps = by_name[name].get("requires", [])
        if not isinstance(deps, list) or not all(isinstance(x,str) for x in deps):
            raise ValueError("requires for %s must be a string array" % name)
        for dep in deps: visit(dep)
        temporary.remove(name); permanent.add(name); result.append(by_name[name])
    for app in apps: visit(app["name"])
    return result
