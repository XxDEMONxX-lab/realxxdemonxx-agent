# demonpm 4.0

Dependency-free process supervisor for Debian, Termux and Linux. Requires Python 3.9+; no npm or pip packages.

## Install

From the repository root:

~~~sh
mkdir -p "$HOME/.local/bin"
cp demonpm/demonpm.py "$HOME/.local/bin/demonpm.py"
cat > "$HOME/.local/bin/demonpm" <<'SH'
#!/bin/sh
exec python3 "$HOME/.local/bin/demonpm.py" "$@"
SH
chmod 755 "$HOME/.local/bin/demonpm" "$HOME/.local/bin/demonpm.py"
grep -q 'HOME/.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
. "$HOME/.bashrc"
demonpm --version
~~~

## Commands

~~~sh
demonpm start discord --cwd "$HOME/my-bot" --env DISCORD_TOKEN=replace_me -- node index.js
demonpm start worker --cwd "$HOME/app" -- python3 worker.py
demonpm list
demonpm logs discord -n 200
demonpm restart discord
demonpm stop discord
demonpm delete discord
demonpm save
demonpm resurrect
~~~

Optional flags: --no-autorestart, --max-restarts N (-1 means unlimited), --health-url URL. A failed HTTP health probe restarts the process.

## Runtime and security

State and logs are in ~/.demonpm; set DEMONPM_HOME to move them. The directory is mode 0700 and the Unix control socket is 0600. Commands are passed as argument arrays, never through a shell. Environment variables are stored locally to support save/resurrect; avoid storing secrets on shared devices or committing them. Logs rotate at 5 MiB and retain three archives. Stop sends SIGTERM to the process group and escalates to SIGKILL after eight seconds.

## Termux:Boot

Install and open Termux:Boot once, then create:

~~~sh
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/20-demonpm" <<'SH'
#!/data/data/com.termux/files/usr/bin/sh
export PATH="$HOME/.local/bin:$PATH"
demonpm resurrect
SH
chmod 700 "$HOME/.termux/boot/20-demonpm"
~~~

Run demonpm save after registering applications. Android battery management can still terminate Termux; no userspace supervisor can prevent that.

## Scope

This is a local single-user supervisor. CPU/RSS metrics use Linux /proc; CPU is sampled across list calls. It does not provide remote API access, multi-user isolation, zero-downtime deploys, Git rollback or dependency graphs.
