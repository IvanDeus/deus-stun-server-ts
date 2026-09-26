// logger.ts
const LOG_TZ = Bun.env.LOG_TZ || 'UTC';

const OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

const raw = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let zone = LOG_TZ;
let formatter: Intl.DateTimeFormat;

try {
  formatter = new Intl.DateTimeFormat('en-US', { timeZone: LOG_TZ, ...OPTIONS });
} catch {
  // Unknown IANA name: fall back to the host's own timezone instead of crashing.
  formatter = new Intl.DateTimeFormat('en-US', OPTIONS);
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function stamp(date: Date = new Date()): string {
  const p = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value])
  ) as Record<string, string>;
  
  return `[${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}]`;
}

// Cast to `any` to bypass TypeScript's readonly restrictions on the global console object
const patchedConsole = console as any;

for (const method of Object.keys(raw) as (keyof typeof raw)[]) {
  patchedConsole[method] = (...args: any[]) => {
    const prefix = stamp();
    // Merging into the first argument keeps printf-style ('%s') formatting intact.
    if (typeof args[0] === 'string') {
      raw[method](`${prefix} ${args[0]}`, ...args.slice(1));
    } else {
      raw[method](prefix, ...args);
    }
  };
}
// Use `raw` here to avoid double-stamping the initialization messages
if (zone !== LOG_TZ) { raw.error(`[logger] unknown LOG_TZ "${LOG_TZ}", falling back to "${zone}"`); }
raw.log(`[logger] timestamps in ${zone}`);

export { raw };
