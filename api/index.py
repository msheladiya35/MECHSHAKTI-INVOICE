import sys
import os

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import MechshaktiRequestHandler
from db import init_db

# Initialize database schema on cold start
try:
    init_db()
except Exception as e:
    print(f"Cold start init error: {e}")

# Vercel Serverless Function export
handler = MechshaktiRequestHandler
