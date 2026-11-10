// PM2 — production (one port serves the API, websockets and the built React app)
//
//   1) build once after every git pull:   cd client && npm run build   then   cd ../server && npm run build
//   2) server/.env:                        NODE_ENV=production, SERVE_CLIENT_DIR=../client/dist, JWT_SECRET=<random 48+>
//   3) from this folder:                   pm2 start ecosystem.production.config.js --only dochub
//   4) after the Cloudflare tunnel exists: pm2 start ecosystem.production.config.js --only dochub-tunnel
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
      watch: false,
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
