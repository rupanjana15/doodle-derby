"""Dev server for Doodle Derby: like `python3 -m http.server`, but tells the browser not to cache,
so code changes show up on a normal reload."""
import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))  # serve the game folder wherever this is run from

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
print(f"Doodle Derby on http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
