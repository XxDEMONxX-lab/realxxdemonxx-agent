"""RBAC HTTP API and browser dashboard. Remote binds require TLS."""
import argparse, hashlib, hmac, json, os, secrets, socket, ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>demonpm</title>
<style>body{font:15px system-ui;background:#10141c;color:#e8edf5;margin:2rem}h1{color:#8ab4ff}button{margin:.2rem;padding:.5rem;background:#26364c;color:white;border:0;border-radius:6px}table{border-collapse:collapse;width:100%}td,th{padding:.6rem;border-bottom:1px solid #344052;text-align:left}.muted{color:#9aa9bd}</style></head><body>
<h1>demonpm dashboard</h1><p class="muted">Authenticated process monitor · token stays in this page memory only.</p>
<button onclick="connect()">Connect / change token</button><span id="status"></span><table><thead><tr><th>Name</th><th>Status</th><th>PID</th><th>CPU</th><th>RAM</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table>
<script>
let token="";
async function api(path,method="GET",body=null){const r=await fetch(path,{method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):null});if(!r.ok)throw Error("HTTP "+r.status);return r.json()}
function connect(){token=prompt("demonpm API token")||"";refresh()}
async function act(action,name){try{await api("/v1/actions","POST",{action,name});await refresh()}catch(e){document.getElementById("status").textContent=e}}
async function refresh(){if(!token)return;try{const data=await api("/v1/processes");document.getElementById("status").textContent=" Connected";document.getElementById("rows").innerHTML=(data.processes||[]).map(p=>"<tr><td>"+esc(p.name)+"</td><td>"+esc(p.status)+"</td><td>"+(p.pid||"-")+"</td><td>"+(p.cpu_percent??"-")+"%</td><td>"+(p.rss_mb??"-")+" MB</td><td><button onclick='act(\"restart\","+JSON.stringify(p.name)+")'>Restart</button><button onclick='act(\"stop\","+JSON.stringify(p.name)+")'>Stop</button></td></tr>").join("")}catch(e){document.getElementById("status").textContent=" "+e}}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
setInterval(refresh,2500);
</script></body></html>"""

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--host",default="127.0.0.1")
    p.add_argument("--port",type=int,default=8765)
    p.add_argument("--home",default=os.environ.get("DEMONPM_HOME",str(Path.home()/".demonpm")))
    p.add_argument("--tls-cert")
    p.add_argument("--tls-key")
    p.add_argument("--create-token",choices=("viewer","operator","admin"))
    a=p.parse_args()
    remote=a.host not in ("127.0.0.1","localhost","::1")
    if remote and not (a.tls_cert and a.tls_key):
        p.error("non-loopback API binds require --tls-cert and --tls-key")
    if bool(a.tls_cert) != bool(a.tls_key): p.error("TLS certificate and key must be supplied together")
    home=Path(a.home).expanduser().resolve(); home.mkdir(mode=0o700,parents=True,exist_ok=True); os.chmod(home,0o700)
    token_file=home/"api.tokens.json"
    tokens={}
    try:
        tokens=json.loads(token_file.read_text(encoding="utf-8"))
        if not isinstance(tokens,dict): raise ValueError("token store must be a JSON object")
    except FileNotFoundError: pass
    except ValueError as exc: p.error("invalid token store: "+str(exc))
    if a.create_token:
        raw=secrets.token_urlsafe(32)
        tokens[hashlib.sha256(raw.encode()).hexdigest()]=a.create_token
        tmp=token_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(tokens,indent=2)+"\n",encoding="utf-8"); os.chmod(tmp,0o600); os.replace(tmp,token_file)
        print(raw); return
    if not tokens:
        raw=secrets.token_urlsafe(32)
        tokens[hashlib.sha256(raw.encode()).hexdigest()]="admin"
        token_file.write_text(json.dumps(tokens,indent=2)+"\n",encoding="utf-8"); os.chmod(token_file,0o600)
        print("New admin API token (shown once): "+raw,flush=True)
    sock_path=home/"demonpm.sock"
    allowed={"operator":{"stop","restart","logs","save","resurrect"},
             "admin":{"stop","restart","delete","logs","save","resurrect"}}
    def call(payload):
        wire=json.dumps(payload).encode()+b"\n"
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.settimeout(10); s.connect(str(sock_path)); s.sendall(wire)
            data=b""
            while b"\n" not in data:
                part=s.recv(65536)
                if not part: break
                data+=part
                if len(data)>1024*1024: raise ValueError("daemon response too large")
        response=json.loads(data.split(b"\n",1)[0].decode())
        if not response.get("ok"): raise ValueError(response.get("error","daemon error"))
        return response["result"]
    class Handler(BaseHTTPRequestHandler):
        server_version="demonpm"
        def log_message(self,*args): pass
        def role(self):
            supplied=self.headers.get("Authorization","")
            if not supplied.startswith("Bearer "): return None
            digest=hashlib.sha256(supplied[7:].encode()).hexdigest()
            for key,role in tokens.items():
                if hmac.compare_digest(key,digest): return role
            return None
        def send(self,status,obj,ctype="application/json"):
            body=obj if isinstance(obj,bytes) else json.dumps(obj).encode()
            self.send_response(status); self.send_header("Content-Type",ctype)
            self.send_header("Content-Length",str(len(body))); self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Cache-Control","no-store"); self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            if self.path=="/": return self.send(200,PAGE.encode(),"text/html; charset=utf-8")
            role=self.role()
            if role not in ("viewer","operator","admin"): return self.send(401,{"error":"unauthorized"})
            if self.path!="/v1/processes": return self.send(404,{"error":"not found"})
            try: self.send(200,call({"action":"list"}))
            except Exception as e: self.send(503,{"error":str(e)})
        def do_POST(self):
            role=self.role()
            if role not in ("operator","admin"): return self.send(403,{"error":"operator or admin role required"})
            if self.path!="/v1/actions": return self.send(404,{"error":"not found"})
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length<1 or length>16384: return self.send(413,{"error":"invalid body size"})
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict) or body.get("action") not in allowed[role]:
                    return self.send(403,{"error":"action not permitted for role"})
                self.send(200,call(body))
            except Exception as e: self.send(400,{"error":str(e)})
    server=ThreadingHTTPServer((a.host,a.port),Handler)
    server.daemon_threads=True
    if a.tls_cert:
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(a.tls_cert,a.tls_key)
        server.socket=context.wrap_socket(server.socket,server_side=True)
    print("demonpm dashboard/API on %s:%d (TLS=%s); token store: %s" %
          (a.host,a.port,bool(a.tls_cert),token_file),flush=True)
    server.serve_forever()

if __name__=="__main__": main()
