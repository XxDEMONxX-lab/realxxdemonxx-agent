import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import load_config

class ConfigTests(unittest.TestCase):
    def write(self, data):
        tmp = tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False)
        json.dump(data, tmp); tmp.close()
        self.addCleanup(Path(tmp.name).unlink, missing_ok=True)
        return tmp.name

    def test_dependencies_are_sorted_before_dependents(self):
        path = self.write({"apps":[
            {"name":"web","command":["python3","web.py"],"requires":["db"]},
            {"name":"db","command":["python3","db.py"]}
        ]})
        self.assertEqual([x["name"] for x in load_config(path)], ["db","web"])

    def test_dependency_cycle_is_rejected(self):
        path = self.write({"apps":[
            {"name":"a","command":["a"],"requires":["b"]},
            {"name":"b","command":["b"],"requires":["a"]}
        ]})
        with self.assertRaisesRegex(ValueError, "cycle"):
            load_config(path)

    def test_duplicate_names_are_rejected(self):
        path = self.write({"apps":[
            {"name":"a","command":["a"]},{"name":"a","command":["b"]}
        ]})
        with self.assertRaisesRegex(ValueError, "unique"):
            load_config(path)

if __name__ == "__main__":
    unittest.main()
