import express, { Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function authToken(userId: string, email = 'user@example.com'): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });
}

export async function withTestServer(
  mount: (app: Express) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use((_req, res, next) => {
    // 避免 keep-alive 让 server.close() 一直等到空闲超时（CI 的 Node 18 会超过 Jest 5 秒）
    res.setHeader('Connection', 'close');
    next();
  });
  app.use(express.json());
  mount(app);

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections?.();
  });
}

export async function jsonRequest(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Connection', 'close');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}
