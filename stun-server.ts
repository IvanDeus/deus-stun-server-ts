// stun-server.ts
// A basic STUN server implementation in TypeScript with Bun
// Handles STUN Binding Requests and responds with the client's public IP and port
// Rate limit: Pause for 3 seconds if more than 30 requests are received in 10 seconds

// STUN constants
const STUN_MAGIC_COOKIE = 0x2112A442;
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

// Server configuration
const BIND_IP = '0.0.0.0'; // Listen on all interfaces
const BIND_PORT = 3478;    // Standard STUN port

// Rate limiting constants
const MAX_REQUESTS = 30;         // Max requests allowed in window
const TIME_WINDOW = 10 * 1000;   // 10 seconds in milliseconds
const PAUSE_DURATION = 3 * 1000; // 3 seconds pause in milliseconds

// Rate limiting state
let requestTimestamps: number[] = []; // Store timestamps of incoming requests
let isPaused = false;       // Track if server is paused

interface StunMessage {
  type: number;
  length: number;
  transactionId: Buffer;
  attributes: Buffer;
}

// Function to parse STUN message
function parseStunMessage(data: Buffer): StunMessage | null {
  if (data.length < 20) return null;

  const type = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  const cookie = data.readUInt32BE(4);
  const transactionId = data.slice(8, 20);

  if (cookie !== STUN_MAGIC_COOKIE) return null;
  if (data.length !== 20 + length) return null;

  return { type, length, transactionId, attributes: data.slice(20) };
}

// Function to create XOR-MAPPED-ADDRESS attribute
function createXorMappedAddress(family: number, port: number, address: string, transactionId: Buffer): Buffer {
  const buf = Buffer.alloc(20); // Max for IPv6, but we'll use IPv4
  buf.writeUInt16BE(STUN_ATTR_XOR_MAPPED_ADDRESS, 0);
  let offset = 4;

  // Family: 1 for IPv4
  buf.writeUInt8(0, offset); // Reserved
  buf.writeUInt8(family, offset + 1);
  offset += 2;

  // XOR Port
  const xorPort = port ^ (STUN_MAGIC_COOKIE >> 16);
  buf.writeUInt16BE(xorPort, offset);
  offset += 2;

  // XOR Address (IPv4)
  const addrBytes = address.split('.').map(Number);
  const addrBuf = Buffer.from(addrBytes);
  for (let i = 0; i < 4; i++) {
    addrBuf[i] ^= (STUN_MAGIC_COOKIE >> (24 - i * 8)) & 0xFF;
  }
  for (let i = 0; i < transactionId.length; i++) {
    addrBuf[i % 4] ^= transactionId[i];
  }
  addrBuf.copy(buf, offset);

  // Length
  const attrLength = offset + 4 - 4; // Exclude type and length fields
  buf.writeUInt16BE(attrLength, 2);

  return buf.slice(0, offset + 4);
}

// Function to create STUN response
function createStunResponse(type: number, transactionId: Buffer, attributes: Buffer[]): Buffer {
  const attrBuf = Buffer.concat(attributes);
  const length = attrBuf.length;

  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(length, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);

  return Buffer.concat([header, attrBuf]);
}

// Get local timestamp for logging
function getTimestamp(): string {
  return new Date().toLocaleString('en-US'); // Server TZ
}

// Check and enforce rate limiting
function checkRateLimit(): boolean {
  const now = Date.now();
  // Remove timestamps older than TIME_WINDOW
  requestTimestamps = requestTimestamps.filter(ts => now - ts < TIME_WINDOW);

  // Add current request timestamp
  requestTimestamps.push(now);

  // Check if rate limit is exceeded
  if (requestTimestamps.length > MAX_REQUESTS && !isPaused) {
    isPaused = true;
    console.log(`[${getTimestamp()}] Rate limit exceeded (${requestTimestamps.length} requests in ${TIME_WINDOW/1000}s). Pausing for ${PAUSE_DURATION/1000}s.`);
    
    // Pause for PAUSE_DURATION
    setTimeout(() => {
      isPaused = false;
      requestTimestamps = []; // Reset after pause
      console.log(`[${getTimestamp()}] Resuming after pause.`);
    }, PAUSE_DURATION);
    
    return false; // Indicate rate limit exceeded
  }
  
  return true; // Within rate limit
}

// Create UDP server using Bun
const server = Bun.listen({
  hostname: BIND_IP,
  port: BIND_PORT,
  socket: {
    data(socket, data: Buffer) {
      // Check rate limit
      if (isPaused || !checkRateLimit()) {
        console.log(`[${getTimestamp()}] Dropping request from ${socket.remoteAddress}:${socket.remotePort} due to rate limit or pause.`);
        return;
      }

      const parsed = parseStunMessage(data);
      if (!parsed || parsed.type !== STUN_BINDING_REQUEST) {
        console.log(`[${getTimestamp()}] Invalid or non-binding request from ${socket.remoteAddress}:${socket.remotePort}`);
        return;
      }

      // Create XOR-MAPPED-ADDRESS with client's address
      const family = 1; // IPv4
      const xorAttr = createXorMappedAddress(family, socket.remotePort, socket.remoteAddress, parsed.transactionId);

      // Create response
      const response = createStunResponse(STUN_BINDING_RESPONSE, parsed.transactionId, [xorAttr]);

      // Send response
      socket.write(response);

      console.log(`[${getTimestamp()}] Handled Binding Request from ${socket.remoteAddress}:${socket.remotePort}`);
    },
    
    error(socket, error) {
      console.error(`[${getTimestamp()}] Socket error:`, error);
    },
    
    open(socket) {
      console.log(`[${getTimestamp()}] Socket opened for ${socket.remoteAddress}:${socket.remotePort}`);
    },
    
    close(socket) {
      console.log(`[${getTimestamp()}] Socket closed for ${socket.remoteAddress}:${socket.remotePort}`);
    },
    
    drain(socket) {
      console.log(`[${getTimestamp()}] Socket drained for ${socket.remoteAddress}:${socket.remotePort}`);
    }
  }
});

console.log(`[${getTimestamp()}] STUN server listening on ${BIND_IP}:${BIND_PORT}`);
