// PM2 — production (one port serves the API, websockets and the built React app)
//
//   client/dist and server/dist are built and committed in the repository: on the server, `git pull` is the whole update.
//   dochub restarts by itself a few seconds after server/dist (or database/) changes; the web app needs no restart.
//   1) server/.env:                        NODE_ENV=production, SERVE_CLIENT_DIR=../client/dist, JWT_SECRET=<random 48+>
//   2) from this folder:                   pm2 start ecosystem.production.config.js --only dochub
//   3) after the Cloudflare tunnel exists: pm2 start ecosystem.production.config.js --only dochub-tunnel
//                                          pm2 save
// Step by step (Thai): docs/DEPLOY_PUBLIC.md
//
// Development stays in ecosystem.config.js (ts-node-dev + vite). Do not run its datahub-server together with
// dochub below: both listen on port 4000.
const fs = require('fs');
const os = require('os');
const path = require('path');

// cloudflared.exe: CLOUDFLARED_PATH wins, then the usual install locations, then PATH
const CLOUDFLARED =
  process.env.CLOUDFLARED_PATH ||
  [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ].find((p) => p && fs.existsSync(p)) ||
  'cloudflared';

// written by hand once (template: deploy/cloudflared/config.example.yml)
const TUNNEL_CONFIG = process.env.CLOUDFLARED_CONFIG || path.join(os.homedir(), '.cloudflared', 'config.yml');

module.exports = {
  apps: [
    {
      name: 'dochub',
      cwd: './server',
      script: './dist/index.js',
      interpreter: 'node',
      windowsHide: true,
      // `git pull` brings a new build → one restart once the files stop changing (a burst of writes = one restart)
      watch: ['dist', '../database'],
      watch_delay: 4000,
      ignore_watch: ['node_modules', 'uploads', 'archive', '**/*.map'],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'dochub-tunnel',
      script: CLOUDFLARED,
      args: ['tunnel', '--no-autoupdate', '--config', TUNNEL_CONFIG, 'run'],
      interpreter: 'none',
      windowsHide: true,
      watch: false,
      autorestart: true,
      restart_delay: 5000,
    },
  ],
};
