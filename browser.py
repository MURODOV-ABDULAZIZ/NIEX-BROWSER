"""
SafeNet Browser - Ishga tushiruvchi
Faqat shu faylni run qiling — Electron avtomatik ochiladi!
"""

import sys
import os
import subprocess

def main():
    if sys.platform == 'win32':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    # browser.py ning joylashgan papkasi
    base_dir = os.path.dirname(os.path.abspath(__file__))

    print()
    print("=hd" * 50)
    print("  🛡️  SafeNet Browser ishga tushmoqda...")
    print("=" * 50)

    # node_modules mavjudligini tekshir
    node_modules = os.path.join(base_dir, 'node_modules')
    if not os.path.exists(node_modules):
        print("\n📦 Kutubxonalar o'rnatilmoqda (birinchi marta)...")
        print("   (Bu 1-2 daqiqa olishi mumkin)\n")
        result = subprocess.run(
            ['npm', 'install'],
            cwd=base_dir,
            shell=True
        )
        if result.returncode != 0:
            print("\n❌ npm install xatosi!")
            print("   Node.js o'rnatilganligini tekshiring:")
            print("   https://nodejs.org\n")
            input("Enter bosing...")
            sys.exit(1)
        print("\n✅ Kutubxonalar o'rnatildi!\n")

    # Electron ishga tushir
    print("🚀 SafeNet Browser ochilmoqda...\n")

    try:
        # Windows uchun
        if sys.platform == 'win32':
            electron_path = os.path.join(base_dir, 'node_modules', '.bin', 'electron.cmd')
            if not os.path.exists(electron_path):
                electron_path = 'npx'
                cmd = ['npx', 'electron', '.']
            else:
                cmd = [electron_path, '.']
        else:
            # Mac / Linux
            electron_path = os.path.join(base_dir, 'node_modules', '.bin', 'electron')
            cmd = [electron_path, '.']

        process = subprocess.run(cmd, cwd=base_dir)

    except FileNotFoundError:
        # electron topilmasa npx bilan
        print("⚠️  electron topilmadi, npx ishlatilmoqda...")
        subprocess.run(['npx', 'electron', '.'], cwd=base_dir)

    except KeyboardInterrupt:
        print("\n👋 SafeNet yopildi.")

if __name__ == "__main__":
    main()