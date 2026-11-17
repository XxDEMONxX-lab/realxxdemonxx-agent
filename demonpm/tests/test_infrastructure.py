import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from limits import attach
from proxy import switch_upstream
from plugins import load_plugins

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
            with self.assertRaises(ValueError):
                switch_upstream(Path(tmp)/"upstream.conf","api",["127.0.0.1:80; malicious"])

    def test_plugin_manifest_requires_valid_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,"plugins.json").write_text('[{"hook":"unknown","command":["true"]}]')
            with self.assertRaises(ValueError):
                load_plugins(tmp)

if __name__ == "__main__":
    unittest.main()
