import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? `${process.env.DATA_DIR ?? './data'}/group-context.json`;
const groupKey = process.argv[3] ?? process.env.NAPCAT_GROUP_KEY;
if (!groupKey) {
  console.error('用法：node scripts/dump-context.mjs <group-context.json> <平台:群号>');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(file, 'utf8'));
const messages = payload.groups?.[groupKey]?.messages ?? [];

for (const message of messages.slice(-40)) {
  const time = new Date(message.timestamp).toISOString();
  const who = message.isBot ? `${message.userName}(bot)` : message.userName || message.userId;
  console.log(`${time} ${who}: ${message.text}`);
}
