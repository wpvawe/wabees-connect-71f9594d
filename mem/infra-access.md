---
name: Infra access (server + repos)
description: Hostinger SSH, FTP, GitHub PAT, and the 3-surface deploy workflow for Wabees
type: reference
---
Three surfaces to keep in sync:
1. Website repo — current Lovable project (auto-syncs to its GitHub).
2. App repo — wpvawe/wabees-plus (Flutter + PHP backend + landing/download). Push via GitHub PAT.
3. Live server — wabees.live Hostinger PHP 8.2. Edit/debug via SSH.

## Secrets saved (env vars, never echo)
- HOSTINGER_SSH_HOST = 82.180.143.183
- HOSTINGER_SSH_PORT = 65002
- HOSTINGER_SSH_USER = u664356407
- HOSTINGER_SSH_PASSWORD
- GITHUB_PERSONAL_ACCESS_TOKEN (scope: repo, user: wpvawe)

## SSH (sandbox has no ssh by default)
nix shell nixpkgs#openssh nixpkgs#sshpass -c sshpass -p "$HOSTINGER_SSH_PASSWORD" ssh -p $HOSTINGER_SSH_PORT -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST '<cmd>'

Web root: domains/wabees.live/public_html (index.php landing, api/, config/, download/, logs/).
api.wabees.live serves from /api in same public_html.

## FTP fallback
ftp.wabees.live / u664356407.ftppwabeeslive / Ht@143*#$ — FTP root = web root, do NOT prefix public_html/.

## GitHub push to wabees-plus
git clone https://wpvawe:$GITHUB_PERSONAL_ACCESS_TOKEN@github.com/wpvawe/wabees-plus.git /tmp/wabees-plus

## Workflow rule
PHP backend change = edit in wabees-plus repo first (commit+push), then deploy same file to live server via SSH.

## Landing / download
React app `/` redirects to /auth. Public landing + APK download served by PHP from app repo's backend/ on wabees.live root — never recreate landing in React project.
