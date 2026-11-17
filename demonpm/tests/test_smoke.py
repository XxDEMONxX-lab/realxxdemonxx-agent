import os, subprocess, sys, tempfile, unittest
from pathlib import Path
SCRIPT = Path(__file__).resolve().parents[1] / "demonpm.py"

class Smoke(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = os.environ.copy()
        self.env["DEMONPM_HOME"] = self.tmp.name
    def cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=self.env,
                              text=True, capture_output=True, timeout=12)
    def tearDown(self):
        self.cli("daemon-stop")
        self.tmp.cleanup()
    def test_lifecycle(self):
        r = self.cli("start", "test", "--", sys.executable, "-c", "import time; time.sleep(30)")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"status": "online"', r.stdout)
        self.assertEqual(self.cli("list").returncode, 0)
        listed=self.cli("list-json")
        self.assertEqual(listed.returncode,0,listed.stderr)
        self.assertIn('"name": "test"',listed.stdout)
        self.assertEqual(self.cli("stop", "test").returncode, 0)
        self.assertEqual(self.cli("delete", "test").returncode, 0)
    def test_no_command_rejected(self):
        self.assertNotEqual(self.cli("start", "bad", "--").returncode, 0)

if __name__ == "__main__": unittest.main()
