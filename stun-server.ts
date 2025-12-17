//stun-server.ts
//rate limit 15000 requests per 10 sec and 3 sec cool down
import dgram from 'node:dgram';
import type { RemoteInfo } from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
// --- Load Configuration ---
let config: any;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('Failed to load config file, using defaults:', error);
  // Default fallback values
  config = {
    rateLimit: {
      maxRequests: 15000,
      timeWindowMs: 10000,
      pauseDurationMs: 3000
    },
    server: {
      bindIp: '0.0.0.0',
      bindPort: 3478
    }
  };
}
// Use config values
const BIND_IP = config.server.bindIp;
const BIND_PORT = config.server.bindPort;
const RATE_LIMIT_MAX_REQUESTS = config.rateLimit.maxRequests;
const RATE_LIMIT_TIME_WINDOW_MS = config.rateLimit.timeWindowMs;
const RATE_LIMIT_PAUSE_DURATION_MS = config.rateLimit.pauseDurationMs;

const STUN_MAGIC_COOKIE = 0x2112A442;
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

const LOG_DEBOUNCE_MS = 5000;
const lastLogTime = new Map<string, number>();
// --- Types ---
interface ParsedStunMessage {
  type: number;
  length: number;
  transactionId: Buffer;
  attributes: Buffer;
}
// --- Rate Limiter Class ---
class RateLimiter {
  private timestamps: number[] = [];
  private isPaused = false;
  private readonly maxRequests: number;
  private readonly timeWindow: number;
  private readonly pauseDuration: number;

  constructor(maxRequests: number, timeWindowMs: number, pauseDurationMs: number) {
    // Validate inputs
    if (maxRequests <= 0) {
      throw new Error('maxRequests must be greater than 0');
    }
    if (timeWindowMs <= 0) {
      throw new Error('timeWindowMs must be greater than 0');
    }
    if (pauseDurationMs <= 0) {
      throw new Error('pauseDurationMs must be greater than 0');
    }

    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
    this.pauseDuration = pauseDurationMs;
  }
  
  public check(): boolean {
    if (this.isPaused) return false;
    const now = Date.now();
    // Prune old timestamps
    this.timestamps = this.timestamps.filter(ts => now - ts < this.timeWindow);
    // Add new timestamp
    this.timestamps.push(now);
    // Check limit
    if (this.timestamps.length > this.maxRequests) {
      this.triggerPause();
      return false;
    }
    return true;
  }

  public getPausedState(): boolean {
    return this.isPaused;
  }

  public getCurrentCount(): number {
    return this.timestamps.length;
  }

  private triggerPause() {
    this.isPaused = true;
    console.warn(`[${getTimestamp()}] Rate limit exceeded. Pausing for ${this.pauseDuration / 1000}s.`);
    
    setTimeout(() => {
      this.isPaused = false;
      this.timestamps = []; // Reset logic after pause
      console.log(`[${getTimestamp()}] Resuming after pause.`);
    }, this.pauseDuration);
  }
}

// --- Helper Functions ---
function getTimestamp(): string {
  return new Date().toLocaleString('en-US');
}

function parseStunMessage(data: Buffer): ParsedStunMessage | null {
  if (data.length < 20) return null;

  const type = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  const cookie = data.readUInt32BE(4);
  const transactionId = data.subarray(8, 20);

  if (cookie !== STUN_MAGIC_COOKIE) return null;
  if (data.length !== 20 + length) return null;

  return { type, length, transactionId, attributes: data.subarray(20) };
}

function createXorMappedAddress(family: number, port: number, address: string, transactionId: Buffer): Buffer {
  // Structure: Type (2) + Length (2) + Reserved (1) + Family (1) + X-Port (2) + X-Address (4)
  const buf = Buffer.alloc(12); 
  // Attribute Header
  buf.writeUInt16BE(STUN_ATTR_XOR_MAPPED_ADDRESS, 0);
  buf.writeUInt16BE(8, 2); // Length of value part (1+1+2+4)
  // Value
  buf.writeUInt8(0, 4);      // Reserved
  buf.writeUInt8(family, 5); // Family (1 for IPv4)
  // XOR Port
  const xorPort = port ^ (STUN_MAGIC_COOKIE >> 16);
  buf.writeUInt16BE(xorPort, 6);
  // XOR Address (IPv4)
  // Note: The original logic XORs against Cookie AND TransactionID. 
  // Standard RFC5389 for IPv4 usually only XORs against the Cookie.
  // I have kept your original logic intact to ensure client compatibility.
  const addrBytes = address.split('.').map(Number);
  const addrBuf = Buffer.from(addrBytes);
  // XOR with Magic Cookie
  for (let i = 0; i < 4; i++) {
    addrBuf[i] ^= (STUN_MAGIC_COOKIE >> (24 - i * 8)) & 0xFF;
  }
  // XOR with Transaction ID (from original script)
  for (let i = 0; i < transactionId.length && i < 4; i++) {
     addrBuf[i] ^= transactionId[i];
  }
  addrBuf.copy(buf, 8);
  return buf;
}

function createStunResponse(type: number, transactionId: Buffer, attributes: Buffer[]): Buffer {
  const attrBuf = Buffer.concat(attributes);
  const bodyLength = attrBuf.length;

  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(bodyLength, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);
  return Buffer.concat([header, attrBuf]);
}

// --- Main Server Logic ---
const server = dgram.createSocket('udp4');
const limiter = new RateLimiter(
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_TIME_WINDOW_MS,
  RATE_LIMIT_PAUSE_DURATION_MS
);
console.log(`[${getTimestamp()}] Loaded config: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_TIME_WINDOW_MS/1000}s, ${RATE_LIMIT_PAUSE_DURATION_MS/1000}s pause`);

server.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
  // 1. Rate Limiting
  if (!limiter.check()) {
    // Only log the drop if we aren't already in a "paused" state to avoid log spam
    // or if you want to see every dropped packet:
    console.log(`[${getTimestamp()}] Dropping ${rinfo.address}`);
    return;
  }
  // 2. Parse Message
  const parsed = parseStunMessage(msg);
  // Validate STUN Binding Request
  if (!parsed || parsed.type !== STUN_BINDING_REQUEST) {
    console.log(`[${getTimestamp()}] Invalid/Non-binding request from ${rinfo.address}:${rinfo.port}`);
    return;
  }
  // 3. Create Attribute (XOR-MAPPED-ADDRESS)
  const family = 1; // IPv4
  const xorAttr = createXorMappedAddress(family, rinfo.port, rinfo.address, parsed.transactionId);
  // 4. Create Response
  const response = createStunResponse(STUN_BINDING_RESPONSE, parsed.transactionId, [xorAttr]);
  // 5. Send 
  server.send(response, rinfo.port, rinfo.address, (err) => {
    if (err) {
      console.error(`[${getTimestamp()}] Error sending response:`, err);
    } else {
      const now = Date.now();
      const lastLog = lastLogTime.get(rinfo.address);
      
      if (!lastLog || (now - lastLog) > LOG_DEBOUNCE_MS) {
        console.log(`[${getTimestamp()}] Sent Binding Response to ${rinfo.address}:${rinfo.port}`);
        lastLogTime.set(rinfo.address, now);
      }
    }
  });
});

server.on('error', (err) => {
  console.error(`[${getTimestamp()}] Server fatal error:`, err);
  server.close();
});

server.bind(BIND_PORT, BIND_IP, () => {
  console.log(`[${getTimestamp()}] STUN server running with Bun on ${BIND_IP}:${BIND_PORT}`);
});
