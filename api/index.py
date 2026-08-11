import sys
import os
from http.server import BaseHTTPRequestHandler

# Add root directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import MechshaktiRequestHandler
from db import init_db

# Initialize database schema on Vercel cold start
try:
    init_db()
except Exception as e:
    print(f"Vercel init error: {e}")

# Vercel top-level BaseHTTPRequestHandler entrypoints
class handler(MechshaktiRequestHandler):
    def do_GET(self):
        super().do_GET()

    def do_POST(self):
        super().do_POST()

    def do_PUT(self):
        super().do_PUT()

    def do_OPTIONS(self):
        super().do_OPTIONS()

# Top-level exports for Vercel discovery
app = handler
application = handler
