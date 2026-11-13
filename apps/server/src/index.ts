import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { initDatabase } from './db';
import { setupRoutes } from './routes';
import { setupWebSocket } from './websocket';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Setup routes
setupRoutes(app);

// HTTP Server
const server = createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ port: Number(WS_PORT) });

async function start() {
  try {
    // Initialize database
    await initDatabase();
    console.log('✅ 数据库初始化完成');

    // Setup WebSocket
    setupWebSocket(wss);
    // 同时在 HTTP 端口的 /ws 路径提供 WebSocket，客户端只需一个地址
    setupWebSocket(new WebSocketServer({ server, path: '/ws' }));
    console.log(`✅ WebSocket 服务器运行在端口 ${WS_PORT}`);

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`✅ HTTP 服务器运行在端口 ${PORT}`);
      console.log(`📡 环境: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

start();
