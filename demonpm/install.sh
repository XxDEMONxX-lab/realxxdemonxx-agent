#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$HOME/.local/bin"
LIB="$HOME/.local/lib/demonpm"
mkdir -p "$BIN" "$LIB"
for module in demonpm.py api.py config.py deploy.py tui.py limits.py proxy.py plugins.py __init__.py; do
    install -m 644 "$ROOT/$module" "$LIB/$module"
done
cat > "$BIN/demonpm" <<'WRAPPER'
#!/bin/sh
exec python3 "$HOME/.local/lib/demonpm/demonpm.py" "$@"
WRAPPER
chmod 755 "$BIN/demonpm"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add this to your shell profile: export PATH=\"$BIN:\$PATH\"";; esac
echo "Installed demonpm. Run: $BIN/demonpm --version"
