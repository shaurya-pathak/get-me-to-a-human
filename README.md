# Get Me to a Human static frontend

This directory is an independently deployable static site for `human.shauryapathak.com`.
It talks to the Mac-hosted Callbox API at `https://api.shauryapathak.com`.

The public walkthrough and architecture diagram work without the Mac. Live calls require:

- the Mac appliance and named Cloudflare Tunnel to be running;
- `api.shauryapathak.com` routed to `http://127.0.0.1:8765`;
- the private Callbox operator token entered in the browser session.

The static frontend deploys from this repository to GitHub Pages. The custom domain is
`human.shauryapathak.com`; the Mac-hosted API remains a separate service.
