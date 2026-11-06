"""Chrome extension: the manifest is valid and complete, and the page reader passes its site fixtures (when Node + Playwright exist)."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "extension")


class ExtensionTest(unittest.TestCase):
    def test_manifest_is_mv3_least_privilege_and_complete(self):
        m = json.load(open(os.path.join(EXT, "manifest.json")))
        self.assertEqual(m["manifest_version"], 3)
        self.assertEqual(sorted(m["permissions"]), ["activeTab", "scripting", "storage"])  # no "tabs", no access to every site
        self.assertTrue(all(h.startswith(("http://127.0.0.1", "http://localhost")) for h in m["host_permissions"]))
        files = [m["action"]["default_popup"], *m["icons"].values(), *m["action"]["default_icon"].values(), "popup.js", "popup.css", "extract.js"]
        for f in files:
            self.assertTrue(os.path.exists(os.path.join(EXT, f)), f)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_page_reader_fixtures(self):
        env = dict(os.environ)
        try:
            env["NODE_PATH"] = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, timeout=20).stdout.strip()
        except Exception:
            pass
        probe = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True, env=env)
        if probe.returncode:
            self.skipTest("Playwright not installed for Node")
        r = subprocess.run(["node", os.path.join(ROOT, "tests", "ext", "extract.test.js")], capture_output=True, text=True, env=env, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
