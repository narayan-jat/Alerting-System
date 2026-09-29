"""Replace the Khana section inside ramdhun-scheduler/firestore.rules with firestore-khana.rules.

Usage: python3 update-rules.py [rules_file] [output_file]
Defaults to editing ~/Documents/ramdhun-scheduler/firestore.rules in place (a .bak copy is kept).
"""
import pathlib
import shutil
import sys

START = "    // ---------------------------------------------------------------------\n    // Khana Alert"
END = "    match /{document=**} {"

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "~/Documents/ramdhun-scheduler/firestore.rules").expanduser()
out = pathlib.Path(sys.argv[2]).expanduser() if len(sys.argv) > 2 else src
block = pathlib.Path(__file__).with_name("firestore-khana.rules").read_text()

text = src.read_text()
start, end = text.find(START), text.find(END)
if start == -1 or end == -1 or text.count(END) != 1 or start > end:
    sys.exit("Khana section or the final catch-all block not found; nothing changed.")

if out == src:
    shutil.copy(src, src.with_name(src.name + ".bak"))
out.write_text(text[:start] + block + "\n" + text[end:])
print(f"Khana rules updated in {out}")
