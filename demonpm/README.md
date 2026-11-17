# demonpm 5.0 development branch

Dependency-free Linux/Termux process supervisor. Requires Python 3.9+; no npm or pip dependencies.

## Install

From the repository root:

~~~sh
sh demonpm/install.sh
~~~

If `~/.local/bin` is not already on PATH, add:

~~~sh
export PATH="$HOME/.local/bin:$PATH"
~~~

## Process lifecycle

~~~sh
demonpm start discord --cwd "$HOME/my-bot" --env DISCORD_TOKEN=replace_me -- python3 bot.py
demonpm list
demonpm logs discord -n 200
demonpm restart discord
demonpm stop discord
demonpm delete discord
demonpm save
demonpm resurrect
~~~

## Advanced process options

~~~sh
# Restart when watched source files change (ignores .git, node_modules, __pycache__)
demonpm start api --cwd "$HOME/api" --watch src --watch app.py -- python3 app.py

# Restart periodically; enforce an RSS memory ceiling
demonpm start worker --restart-every 3600 --max-memory-mb 256 -- python3 worker.py

# Dependency ordering; dependencies must already be registered
demonpm start web --requires database -- python3 web.py

# Interactive terminal dashboard
demonpm monit

# Load a validated ecosystem JSON file in dependency order
demonpm start-config demonpm/ecosystem.example.json

# Fast-forward Git deployment; refuses a dirty worktree and resets to the old commit on failure
demonpm deploy api --branch main

# Authenticated loopback-only HTTP API (token is stored in ~/.demonpm/api.token)
demonpm api --port 8765
~~~

The API exposes `GET /v1/processes` and `POST /v1/actions`. Send `Authorization: Bearer <token>`. It binds only to 127.0.0.1; use an SSH tunnel rather than exposing it to the internet.

## Alerts, logs and resource monitoring

Use `--discord-webhook URL` to send start/exit notifications. Logs rotate at 5 MiB and retain three archives. CPU/RSS readings use Linux `/proc`; CPU is sampled between list calls. Memory ceilings trigger process termination and the normal restart policy.

## Termux boot

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

Run `demonpm save` after registering applications. Android battery management can still terminate Termux; no userspace supervisor can prevent that.

## Security

- State and logs live under `~/.demonpm` (override with `DEMONPM_HOME`).
- State directory is owner-only; local daemon socket is mode 0600.
- Commands are argument arrays, not shell strings.
- Environment values are persisted for resurrection. Do not store long-lived secrets on shared devices or commit them.
- API is loopback-only and bearer-token protected. Do not port-forward it publicly without TLS and a stronger deployment boundary.
- Git deploy refuses dirty working trees and uses fast-forward-only pulls.

## Current scope and limitations

This branch adds a local single-user manager, file watch polling, scheduled restarts, RSS limit enforcement, dependency ordering, ecosystem config validation, TUI, loopback API and guarded Git deployment.

It is not yet a full distributed orchestrator: no true zero-downtime/blue-green traffic switching, built-in load balancer, multi-user/RBAC isolation, remote web dashboard, cluster mode, compressed log retention, or plugin sandbox. CPU is observed but not enforced as a hard quota. Android can still kill Termux.

## Tests

~~~sh
python3 -m unittest discover -s demonpm/tests -v
~~~
