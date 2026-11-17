"""Curses dashboard for demonpm CLI."""
import curses, json, subprocess, sys, time

def call(*args):
    p = subprocess.run(["demonpm", *args], capture_output=True, text=True)
    if p.returncode: raise RuntimeError(p.stderr.strip() or p.stdout.strip())
    return p.stdout

def main():
    def ui(screen):
        curses.curs_set(0); screen.timeout(500); selected = 0; message = ""
        while True:
            try: rows = json.loads(call("list-json"))
            except Exception as exc:
                rows = []; message = str(exc)
            screen.erase()
            screen.addnstr(0,0,"demonpm dashboard | ↑/↓ select | r restart | s stop | q quit", max(1,curses.COLS-1))
            screen.addnstr(1,0,message,max(1,curses.COLS-1))
            for i, app in enumerate(rows[:max(0,curses.LINES-3)]):
                line = "%s %-20s %-9s pid=%-8s restarts=%s" % (
                    ">" if i == selected else " ", app.get("name","?"),
                    app.get("status","?"), app.get("pid") or "-", app.get("restarts",0))
                screen.addnstr(i+3,0,line,max(1,curses.COLS-1))
            screen.refresh()
            key = screen.getch()
            if key == ord("q"): break
            if key == curses.KEY_DOWN and rows: selected = min(len(rows)-1,selected+1)
            elif key == curses.KEY_UP and rows: selected = max(0,selected-1)
            elif rows and key in (ord("r"),ord("s")):
                action = "restart" if key == ord("r") else "stop"
                try: call(action, rows[selected]["name"]); message = action+" requested"
                except Exception as exc: message = str(exc)
    curses.wrapper(ui)

if __name__ == "__main__": main()
