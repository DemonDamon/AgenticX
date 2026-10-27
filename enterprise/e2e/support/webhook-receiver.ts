import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

const TOLERANCE_SECONDS = 5 * 60;

export type ReceivedEvent = {
  raw: Buffer;
  id: string;
  timestamp: string;
  signature: string;
  json: unknown;
  verified: boolean;
};

export type WebhookReceiver = {
  url: string;
  received: ReceivedEvent[];
  setSecret(secret: string): void;
  close(): Promise<void>;
};

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Standard Webhooks: whsec_ + base64 key, HMAC-SHA256 over `id.timestamp.` + raw body. */
export function verifySignature(
  raw: Buffer,
  id: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret.startsWith('whsec_') || !id || !timestamp || !signature) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), raw]))
    .digest();
  for (const part of signature.split(' ')) {
    const comma = part.indexOf(',');
    if (comma <= 0) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    const got = Buffer.from(part.slice(comma + 1), 'base64');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

export function eventData(item: ReceivedEvent): { type?: string; resource_id?: string } | null {
  if (!item.json || typeof item.json !== 'object') return null;
  const data = (item.json as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const record = data as { type?: unknown; resource_id?: unknown };
  return {
    ...(typeof record.type === 'string' ? { type: record.type } : {}),
    ...(typeof record.resource_id === 'string' ? { resource_id: record.resource_id } : {}),
  };
}

export function startReceiver(): Promise<WebhookReceiver> {
  const received: ReceivedEvent[] = [];
  let secret = '';
  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const id = header(req, 'webhook-id');
      const timestamp = header(req, 'webhook-timestamp');
      const signature = header(req, 'webhook-signature');
      let json: unknown = null;
      try {
        json = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        json = null;
      }
      const item: ReceivedEvent = {
        raw,
        id,
        timestamp,
        signature,
        json,
        verified: secret !== '' && verifySignature(raw, id, timestamp, signature, secret),
      };
      received.push(item);
      res.writeHead(204);
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('webhook receiver did not bind a TCP port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        received,
        setSecret(next: string) {
          secret = next;
          for (const item of received) {
            item.verified = verifySignature(item.raw, item.id, item.timestamp, item.signature, secret);
          }
        },
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
