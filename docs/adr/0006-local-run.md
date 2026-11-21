# 0006 Local run: one command

Status: accepted (M0).

`./start.sh` is the single documented command: it checks Node, installs when the lockfile changed, builds the client, starts the rooms service on the local Workers runtime (localhost only, no login, no metrics) and serves the build on all interfaces over HTTP and over HTTPS with a locally generated self-signed certificate.
The client reaches rooms at same-origin `/rooms` (HTTP and WebSocket proxied), so a phone needs only one address. Hosting stays easy later because the client is a static build and the rooms URL is a setting.
