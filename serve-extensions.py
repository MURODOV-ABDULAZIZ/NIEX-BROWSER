#!/usr/bin/env python3
"""
SafeNet Extensions Local Server
Extensionlarni test qilish uchun local server

Usage:
    python serve-extensions.py

Keyin browser da:
    http://localhost:8000/example-adblock-extension.json
"""

import http.server
import socketserver
import os
from pathlib import Path

PORT = 8000
EXTENSIONS_DIR = Path(__file__).parent

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Content-Type', 'application/json')
        super().end_headers()

    def log_message(self, format, *args):
        # Prettier logs
        message = format % args
        if 'extension' in message.lower():
            print(f"✅ {message}")
        else:
            print(f"📍 {message}")

def main():
    os.chdir(EXTENSIONS_DIR)
    
    print("\n" + "="*60)
    print("🚀 SafeNet Extensions Local Server")
    print("="*60)
    print(f"📂 Directory: {EXTENSIONS_DIR}")
    print(f"🌐 URL: http://localhost:{PORT}")
    print("\n📋 Available Extensions:")
    print("-" * 60)
    
    extensions = [
        ("example-adblock-extension.json", "Simple Ad Blocker"),
        ("example-darkmode-extension.json", "Dark Mode"),
        ("example-youtube-filter-extension.json", "YouTube Filter"),
    ]
    
    for filename, name in extensions:
        if (EXTENSIONS_DIR / filename).exists():
            print(f"  ✓ {name}")
            print(f"    URL: http://localhost:{PORT}/{filename}")
        else:
            print(f"  ✗ {filename} not found")
    
    print("\n" + "="*60)
    print("📝 Installation Steps:")
    print("="*60)
    print("1. SafeNet Browser ochish")
    print("2. Settings → Extensions")
    print("3. URL kiriting (yuqoridagi URLlardan biri)")
    print("4. Extension nomi kiriting (ixtiyoriy)")
    print("5. Install tugmasini bosing")
    print("6. F12 Console da logs qarang")
    print("\n💡 Quit: Ctrl+C")
    print("="*60 + "\n")
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n👋 Server to'xtatildi. Xayr!")

if __name__ == "__main__":
    main()
