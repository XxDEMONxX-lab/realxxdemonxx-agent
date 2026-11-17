"""Loopback-only authenticated HTTP API bridge to the daemon Unix socket."""
import argparse, hmac, json, os, secrets, socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--host",default="127.0.0.1")
    p.add_argument("--port",type=int,default=8765)
    p.add_argument("--home",default=os.environ.get("DEMONPM_HOME",str(Path.home()/".demonpm")))
    a=p.parse_args()
    if a.host not in ("127.0.0.1","localhost"):
        p.error("API is deliberately restricted to loopback; use an SSH tunnel for remote access")
    home=Path(a.home); home.mkdir(mode=0o700,parents=True,exist_ok=True)
    token_path=home/"api.token"
    if not token_path.exists():
        token_path.write_text(secrets.token_urlsafe(32),encoding="utf-8")
        os.chmod(token_path,0o600)
    token=token_path.read_text(encoding="utf-8").strip()
    sock_path=home/"demonpm.sock"
    allowed={"list","stop","restart","delete","logs","save","resurrect"}
    def call(payload):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.settimeout(10); s.connect(str(sock_path)); s.sendall(json.dumps(payload).encode())
            data=b""
            while b"\n" not in data:
                part=s.recv(65536)
                if not part: break
                data+=part
        response=json.loads(data.decode())
        if not response.get("ok"): raise ValueError(response.get("error","daemon error"))
        return response["result"]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def authorized(self):
            supplied=self.headers.get("Authorization","")
            return hmac.compare_digest(supplied,"Bearer "+token)
        def send(self,status,obj):
            body=json.dumps(obj).encode()
            self.send_response(status); self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            if not self.authorized(): return self.send(401,{"error":"unauthorized"})
            if self.path!="/v1/processes": return self.send(404,{"error":"not found"})
            try: self.send(200,call({"action":"list"}))
            except Exception as e: self.send(503,{"error":str(e)})
        def do_POST(self):
            if not self.authorized(): return self.send(401,{"error":"unauthorized"})
            if self.path!="/v1/actions": return self.send(404,{"error":"not found"})
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length<1 or length>16384: return self.send(413,{"error":"invalid body size"})
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict) or body.get("action") not in allowed:
                    return self.send(400,{"error":"unsupported action"})
                self.send(200,call(body))
            except Exception as e: self.send(400,{"error":str(e)})
    server=ThreadingHTTPServer((a.host,a.port),Handler)
    print("demonpm API listening on %s:%d; token stored in %s" % (a.host,a.port,token_path),flush=True)
    server.serve_forever()

if __name__=="__main__": main()
