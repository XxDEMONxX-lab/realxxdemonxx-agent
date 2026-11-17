# demonpm 5.0

Dependency-free Python process supervisor for Linux and Termux. Python 3.9+; no npm or pip dependencies.

## Install

From the repository root:

~~~sh
sh demonpm/install.sh
export PATH="$HOME/.local/bin:$PATH"
demonpm --version
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

The daemon can be run under systemd using `demonpm/examples/demonpm.service`. It runs in the foreground and restores saved applications after daemon startup. On Termux, install Termux:Boot and use `demonpm/examples/termux-boot.sh`; Android may still kill Termux.

## Monitoring and reliability

~~~sh
demonpm monit
demonpm start api --cwd "$HOME/api" --watch src --health-url http://127.0.0.1:8000/health -- python3 app.py
demonpm start worker --restart-every 3600 --max-memory-mb 256 -- python3 worker.py
~~~

- Exponential crash-restart backoff and consecutive health-probe debounce.
- File-watch polling, scheduled restarts, process-group shutdown.
- Linux `/proc` CPU/RSS telemetry.
- Logs rotate at 5 MiB on the next process start and retain three gzip archives. A currently running process's output file is not compressed while open.
- Discord webhook notifications for lifecycle and health events.

## Multi-instance clusters and Nginx load balancing

Create a base application first, then scale it into local replicas. The app must read the `PORT` environment variable and bind to that port:

~~~sh
demonpm start web --cwd "$HOME/web" -- python3 app.py
demonpm scale web --replicas 3 --base-port 8100
~~~

This creates `web-1`, `web-2`, and `web-3` with ports 8100–8102. Then generate and activate an Nginx upstream file:

~~~sh
demonpm proxy-sync web --upstream-name web_backend --upstream-file /etc/nginx/conf.d/web-upstream.conf
~~~

Include that file from your Nginx configuration and point your `proxy_pass` at `http://web_backend`. Nginx must be installed and the invoking user must have permission to write the include and reload Nginx. Replicas run on the same host; this is not a distributed cluster scheduler.

## Blue-green traffic switching

Start the new version under a separate process name and wait until its health endpoint passes. Then switch Nginx to the new server; the old process is stopped only after Nginx validates and reloads the new upstream:

~~~sh
demonpm start web-green --cwd "$HOME/web-green" --env PORT=8200 -- python3 app.py
demonpm bluegreen web web-green --server 127.0.0.1:8200 --health-url http://127.0.0.1:8200/health --upstream-name web_backend --upstream-file /etc/nginx/conf.d/web-upstream.conf
~~~

This provides an Nginx upstream cutover, not a universal zero-downtime guarantee. Long-lived connections, app readiness, database migrations, and Nginx configuration must be handled by the application operator. If Nginx validation or reload fails, the previous upstream file is restored and the old app is left running.

## Hard resource limits (Linux cgroup v2)

~~~sh
demonpm start worker --cpu-percent 50 --hard-memory-mb 256 -- python3 worker.py
~~~

This limits CPU to 50% of one CPU core and memory to 256 MiB using cgroup v2. The host must delegate writable cgroups to the user and enable the relevant controllers. If setup fails, demonpm kills the just-started child and reports the error rather than silently ignoring the limit. The existing `--max-memory-mb` is a sampled RSS threshold and is not a hard limit. Termux generally cannot configure cgroups; omit these flags there.

## Authenticated web dashboard and RBAC API

Loopback-only by default:

~~~sh
demonpm api --port 8765
~~~

The first start generates an admin bearer token and prints it once. Open `http://127.0.0.1:8765/` and paste the token. Create additional scoped tokens:

~~~sh
demonpm api --create-token viewer
demonpm api --create-token operator
~~~

Roles:
- `viewer`: view process status.
- `operator`: view, stop, restart, read logs, save and resurrect.
- `admin`: operator actions plus delete.

For remote access, use TLS:

~~~sh
demonpm api --host 0.0.0.0 --port 8765 --tls-cert /path/fullchain.pem --tls-key /path/privkey.pem
~~~

Never expose the API over plain HTTP. The token store is hashed and stored in `~/.demonpm/api.tokens.json` with owner-only permissions. The dashboard does not persist the token in browser storage.

## Plugin hooks (bubblewrap required)

Place a `plugins.json` file under `~/.demonpm/plugins/`:

~~~json
[
  {"hook":"post-start","command":["/plugin/notify.sh"],"cwd":".","timeout":5}
]
~~~

Hooks supported: `pre-start`, `post-start`, `pre-stop`, `post-stop`, `on-crash`. Hooks execute with bubblewrap namespaces, no network namespace, read-only host filesystem binds, an isolated temporary directory, a bounded timeout, and a separate process group. If bubblewrap is missing, configured hooks fail closed. Bubblewrap/user namespaces must be supported by the host. Review plugin code before enabling it.

## Git deployment

~~~sh
demonpm deploy web --branch main
~~~

Requires an explicit app working directory, a clean Git tree and a fast-forward update. On failure, demonpm attempts to reset to the previous commit and restart the previous app revision. This is not a replacement for database migration rollback.

## Security and limitations

- Local Unix socket is owner-only; state and token files are mode 0600 under a mode 0700 state directory.
- Commands are argument arrays; no shell string interpolation.
- Environment variables are persisted for resurrection. Avoid placing long-lived secrets in shared state or committing config files.
- Remote API requires TLS and RBAC tokens. Prefer a firewall or private VPN in addition to TLS.
- Plugin hooks require bubblewrap and fail closed without it.
- Local replicas and Nginx upstreams are single-host only. No distributed scheduler, multi-host cluster, built-in service discovery, or Kubernetes integration.
- No generic proxy can guarantee blue-green zero downtime for arbitrary applications.
- Hard CPU/memory limits require delegated Linux cgroup v2; not generally available in Termux.

## Tests

~~~sh
python3 -m compileall -q demonpm
python3 -m unittest discover -s demonpm/tests -v
~~~
