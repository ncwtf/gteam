import assert from 'node:assert/strict';
import test from 'node:test';
import { toWebSocketUrl } from '../src/lib/serverUrl.ts';

test('https server urls use wss on the same host and /ws', () => {
  assert.equal(toWebSocketUrl('https://team.example.com'), 'wss://team.example.com/ws');
  assert.equal(toWebSocketUrl('https://team.example.com/'), 'wss://team.example.com/ws');
  assert.equal(toWebSocketUrl('https://team.example.com/ws'), 'wss://team.example.com/ws');
});

test('http server urls use ws and keep the port', () => {
  assert.equal(toWebSocketUrl('http://192.168.1.200:3000'), 'ws://192.168.1.200:3000/ws');
  assert.equal(toWebSocketUrl('http://127.0.0.1:3000/'), 'ws://127.0.0.1:3000/ws');
  assert.equal(toWebSocketUrl('ws://host:3000/ws'), 'ws://host:3000/ws');
});

test('a bare host is treated as ws', () => {
  assert.equal(toWebSocketUrl('team.example.com'), 'ws://team.example.com/ws');
});
