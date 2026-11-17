import importlib
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class ModuleImportTests(unittest.TestCase):
    def test_all_runtime_modules_import(self):
        for name in ("demonpm", "api", "config", "deploy", "tui", "limits", "proxy", "plugins"):
            with self.subTest(module=name):
                importlib.import_module(name)

if __name__ == "__main__":
    unittest.main()
