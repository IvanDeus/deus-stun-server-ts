# deus-stun-server-ts
A STUN (Session Traversal Utilities for NAT) server for RTC calls

## Prerequisites
Make sure you have Bun installed: `curl -fsSL https://bun.sh/install | bash`

## To run STUN server:
Run with: `bun run stun-server.ts`

## To use pm2 for process management in production create ecosystem.config.js:
```
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'stun-ts',
    script: '/var/deus-stun-server-ts/stun-server.ts',
    interpreter: '/home/.bun/bin/bun',
    interpreter_args: 'run',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: true
  }]
};
```
And use it: `pm2 start ecosystem.config.js`

2025 [ ivan deus ]
