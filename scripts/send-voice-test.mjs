import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { loadEnvFile } from '../src/config.js';

loadEnvFile();
const target = process.argv[2] ?? process.env.VOICE_TEST_QQ;
const file = process.argv[3] ?? '/opt/qqbot/data/voice/test.mp3';
if (!target) throw new Error('用法: node scripts/send-voice-test.mjs <QQ> [音频路径]');

const ws = new WebSocket(process.env.NAPCAT_WS_URL, {
  headers: { Authorization: `Bearer ${process.env.NAPCAT_ACCESS_TOKEN}` },
});

ws.on('open', () => {
  const echo = randomUUID();
  ws.send(
    JSON.stringify({
      action: 'send_private_msg',
      params: {
        user_id: target,
        message: [{ type: 'record', data: { file } }],
      },
      echo,
    }),
  );
  ws.on('message', (raw) => {
    const payload = JSON.parse(String(raw));
    if (payload.echo !== echo) return;
    console.log(JSON.stringify(payload));
    ws.close();
  });
});

ws.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
