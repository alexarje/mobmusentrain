'use strict';

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Room management ─────────────────────────────────────────────────────────
// rooms: Map<roomId, Map<deviceId, WebSocket>>
const rooms = new Map();

function getRoomPeers(roomId) {
  return rooms.get(roomId) || new Map();
}

function broadcastToRoom(roomId, senderDeviceId, message) {
  const peers = getRoomPeers(roomId);
  const data = JSON.stringify(message);
  peers.forEach((ws, deviceId) => {
    if (deviceId !== senderDeviceId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// ─── Connection handler ──────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let roomId = null;
  let deviceId = null;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        // Sanitise inputs
        roomId = String(msg.room || 'default').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
        deviceId = String(msg.deviceId || Math.random().toString(36).slice(2, 8));

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        rooms.get(roomId).set(deviceId, ws);

        const peerCount = rooms.get(roomId).size - 1;
        const peerIds = [...rooms.get(roomId).keys()].filter(id => id !== deviceId);

        ws.send(JSON.stringify({ type: 'joined', roomId, deviceId, peerIds, peerCount }));

        broadcastToRoom(roomId, deviceId, {
          type: 'peer_joined',
          deviceId,
          peerCount: rooms.get(roomId).size,
        });
        break;
      }

      case 'beat': {
        if (!roomId) return;
        broadcastToRoom(roomId, deviceId, {
          type: 'peer_beat',
          deviceId,
          timestamp: Number(msg.timestamp),
          bpm: Number(msg.bpm),
          beatCount: Number(msg.beatCount),
        });
        break;
      }

      case 'pattern': {
        if (!roomId) return;
        broadcastToRoom(roomId, deviceId, {
          type: 'peer_pattern',
          deviceId,
          patternIndex: Number(msg.patternIndex),
        });
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomId || !deviceId || !rooms.has(roomId)) return;
    rooms.get(roomId).delete(deviceId);
    if (rooms.get(roomId).size === 0) {
      rooms.delete(roomId);
    } else {
      broadcastToRoom(roomId, deviceId, {
        type: 'peer_left',
        deviceId,
        peerCount: rooms.get(roomId).size,
      });
    }
  });

  ws.on('error', (err) => console.error('WS error:', err.message));
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`MobMusEntrain → http://localhost:${PORT}`));
