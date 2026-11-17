import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from limits import attach
from proxy import switch_upstream
from plugins import load_plugins
from demonpm import ssh_request, stats, rotate, LIMIT, Manager

class InfrastructureTests(unittest.TestCase):
    def test_cgroup_limits_write_cpu_memory_and_pid(self):
        with tempfile.TemporaryDirectory() as tmp:
            group=attach(1234,"web",cpu_percent=50,memory_mb=128,root=tmp)
            path=Path(group)
            self.assertEqual((path/"cpu.max").read_text(),"50000 100000")
            self.assertEqual((path/"memory.max").read_text(),str(128*1024*1024))
            self.assertEqual((path/"cgroup.procs").read_text(),"1234")

    def test_proxy_config_rolls_back_when_nginx_validation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/"upstream.conf"
            target.write_text("old-config")
            with patch("proxy.subprocess.run",side_effect=RuntimeError("nginx config invalid")):
                with self.assertRaises(RuntimeError):
                    switch_upstream(target,"api",["127.0.0.1:8000"])
            self.assertEqual(target.read_text(),"old-config")

    def test_proxy_rejects_injection_in_server(self):
        with tempfile.TemporaryDirectory() as tmp:
            for server in ("127.0.0.1:80; malicious","127.0.0.1:99999","127.0.0.1:80 malicious"):
                with self.subTest(server=server), self.assertRaises(ValueError):
                    switch_upstream(Path(tmp)/"upstream.conf","api",[server])

    def test_proxy_accepts_ipv6_literal(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/"upstream.conf"
            with patch("proxy.subprocess.run"):
                switch_upstream(target,"api",["[::1]:8080"])
            self.assertIn("[::1]:8080",target.read_text())

    def test_live_log_capture_rotates_while_process_runs(self):
        import subprocess, threading, sys, gzip
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)/"home"; logs=home/"logs"
            with patch("demonpm.HOME",home), patch("demonpm.LOGS",logs), patch("demonpm.STATE",home/"state.json"):
                manager=Manager()
                process=subprocess.Popen([sys.executable,"-c",
                    "import sys; sys.stdout.buffer.write(b'x' * (%d + 32))" % LIMIT],
                    stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
                manager.children["test"]=process
                reader=threading.Thread(target=manager.capture_output,args=("test",process))
                manager.log_threads["test"]=reader; reader.start()
                self.assertEqual(process.wait(timeout=15),0)
                reader.join(timeout=5)
                self.assertFalse(reader.is_alive())
                with gzip.open(logs/"test.log.1.gz","rb") as archive:
                    self.assertEqual(len(archive.read()),LIMIT)
                self.assertEqual((logs/"test.log").stat().st_size,32)

    def test_proc_stats_parse_current_process(self):
        import os
        result=stats(os.getpid())
        self.assertIsNotNone(result["rss_mb"])
        self.assertIsNotNone(result["ticks"])

    def test_log_rotation_compresses_previous_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"worker.log"
            path.write_bytes(b"x"*(LIMIT+1))
            rotate(path)
            import gzip
            with gzip.open(str(path)+".1.gz","rb") as archive:
                self.assertEqual(len(archive.read()),LIMIT+1)
            self.assertFalse(path.exists())

    def test_ssh_node_rejects_remote_command_injection(self):
        with self.assertRaises(ValueError):
            ssh_request("host; touch /tmp/pwned", {"action":"list"})

    def test_ssh_request_uses_fixed_remote_command(self):
        import subprocess
        completed=subprocess.CompletedProcess([],0,'{"processes":[]}',"")
        with patch("demonpm.subprocess.run",return_value=completed) as run:
            self.assertEqual(ssh_request("deploy@example.com",{"action":"list"}),{"processes":[]})
            self.assertEqual(run.call_args.args[0][-2:],["demonpm","remote-request"])
            self.assertIn("StrictHostKeyChecking=yes",run.call_args.args[0])

    def test_plugin_manifest_requires_valid_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,"plugins.json").write_text('[{"hook":"unknown","command":["true"]}]')
            with self.assertRaises(ValueError):
                load_plugins(tmp)

if __name__ == "__main__":
    unittest.main()
