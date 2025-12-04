# deus-stun-server-ts  
A high-performance STUN (Session Traversal Utilities for NAT) server implementation for WebRTC and real-time communication applications.

## Prerequisites  
Ensure you have [Bun](https://bun.sh) installed:  
```bash
curl -fsSL https://bun.sh/install | bash
```

## Running the STUN Server  
Start the server with:  
```bash
bun run stun-server.ts
```

## Production Deployment with PM2  
For process management in production environments, create an `ecosystem.config.js` file:  

```javascript
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

Then start the service:  
```bash
pm2 start ecosystem.config.js
```

---

2025 [ ivan deus ]
