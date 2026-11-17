#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
install -m 755 "$ROOT/demonpm.py" "$BIN/demonpm.py"
cat > "$BIN/demonpm" <<'WRAPPER'
#!/bin/sh
exec python3 "$HOME/.local/bin/demonpm.py" "$@"
WRAPPER
chmod 755 "$BIN/demonpm"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add this to your shell profile: export PATH=\"$BIN:\$PATH\"";; esac
echo "Installed demonpm. Run: $BIN/demonpm --version"
