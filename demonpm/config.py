"""Validated ecosystem JSON and deterministic dependency ordering."""
from __future__ import annotations
import json, re
from pathlib import Path

def load_config(path):
    data=json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data,dict) or not isinstance(data.get("apps"),list):
        raise ValueError("config must be an object with an apps array")
    apps,names=data["apps"],set()
    for app in apps:
        if not isinstance(app,dict): raise ValueError("each app must be an object")
        name,command=app.get("name"),app.get("command")
        if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}",name) or name in (".","..") or name in names:
            raise ValueError("app names must be unique and use 1-64 safe characters")
        if not isinstance(command,list) or not command or not all(isinstance(x,str) and x and "\0" not in x for x in command):
            raise ValueError("app %s command must be a non-empty string array" % name)
        env=app.get("env",{})
        if not isinstance(env,dict) or not all(isinstance(k,str) and k and "=" not in k and "\0" not in k and isinstance(v,str) and "\0" not in v for k,v in env.items()):
            raise ValueError("app %s env must map valid strings to strings" % name)
        for field in ("max_restarts","restart_every","max_memory_mb","cpu_percent","hard_memory_mb"):
            value=app.get(field,0 if field!="max_restarts" else 20)
            if not isinstance(value,int) or isinstance(value,bool):
                raise ValueError("app %s %s must be an integer" % (name,field))
            if field=="max_restarts" and value < -1: raise ValueError("max_restarts must be -1 or non-negative")
            if field!="max_restarts" and value < 0: raise ValueError("%s must be non-negative" % field)
        requires=app.get("requires",[])
        if not isinstance(requires,list) or not all(isinstance(x,str) for x in requires):
            raise ValueError("requires for %s must be a string array" % name)
        watch=app.get("watch",[])
        if not isinstance(watch,list) or not all(isinstance(x,str) for x in watch):
            raise ValueError("watch for %s must be a string array" % name)
        names.add(name)
    by_name={a["name"]:a for a in apps}
    result,temporary,permanent=[],set(),set()
    def visit(name):
        if name in permanent:return
        if name in temporary:raise ValueError("dependency cycle involving "+name)
        if name not in by_name:raise ValueError("unknown dependency "+name)
        temporary.add(name)
        for dep in by_name[name].get("requires",[]):visit(dep)
        temporary.remove(name);permanent.add(name);result.append(by_name[name])
    for app in apps:visit(app["name"])
    return result
