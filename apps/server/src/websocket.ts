import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { WSEvent } from '@gteam/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  teamIds?: Set<string>;
}

const clients = new Map<string, AuthenticatedWebSocket>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    console.log('新的 WebSocket 连接');

    // 处理认证
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'auth') {
          const token = message.token;
          
          try {
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            ws.userId = decoded.userId;
            
            // 查询用户所属的团队
            const { query } = await import('./db');
            const result = await query(
              'SELECT DISTINCT t.id FROM teams t JOIN team_members tm ON t.id = tm.team_id WHERE tm.user_id = $1',
              [ws.userId]
            );
            
            ws.teamIds = new Set(result.rows.map((row: any) => row.id));
            if (ws.userId) {
              clients.set(ws.userId, ws);
              ws.send(JSON.stringify({ type: 'auth_success', userId: ws.userId }));
              console.log(`用户 ${ws.userId} 已认证`);
            }
          } catch (error) {
            ws.send(JSON.stringify({ type: 'auth_error', error: '认证失败' }));
            ws.close();
          }
        }
      } catch (error) {
        console.error('WebSocket 消息处理错误:', error);
      }
    });

    ws.on('close', () => {
      if (ws.userId) {
        clients.delete(ws.userId);
        console.log(`用户 ${ws.userId} 断开连接`);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket 错误:', error);
    });
  });

  console.log('WebSocket 服务器已设置');
}

/**
 * 广播事件给团队成员
 */
export function broadcastEvent(event: WSEvent) {
  const message = JSON.stringify(event);
  
  clients.forEach((client, userId) => {
    if (client.readyState === WebSocket.OPEN && client.teamIds) {
      // 只发送给该团队的成员
      if (client.teamIds.has(event.teamId)) {
        client.send(message);
      }
    }
  });
}
