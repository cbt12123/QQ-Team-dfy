import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const envPath = process.argv[2] ?? '/opt/qqbot/.env';
const configDir =
  process.argv[3] ?? '/root/Napcat/opt/QQ/resources/app/app_launcher/napcat/config';

const envText = readFileSync(envPath, 'utf8');
const tokenMatch = envText.match(/^NAPCAT_ACCESS_TOKEN=(.*)$/m);
const token = tokenMatch?.[1]?.trim();
if (!token) throw new Error(`没有在 ${envPath} 找到 NAPCAT_ACCESS_TOKEN`);

mkdirSync(configDir, { recursive: true });

const webuiPath = `${configDir}/webui.json`;
const onebotPath = `${configDir}/onebot11.json`;

writeFileSync(
  webuiPath,
  `${JSON.stringify(
    {
      host: '0.0.0.0',
      port: 6099,
      token,
      loginRate: 3,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
chmodSync(webuiPath, 0o600);

writeFileSync(
  onebotPath,
  `${JSON.stringify(
    {
      network: {
        httpServers: [],
        httpClients: [],
        websocketServers: [
          {
            name: 'qqbot-ws',
            enable: true,
            host: '127.0.0.1',
            port: 3001,
            messagePostFormat: 'array',
            reportSelfMessage: false,
            token,
            enableForcePushEvent: true,
            debug: false,
            heartInterval: 30000,
          },
        ],
        websocketClients: [],
      },
      musicSignUrl: '',
      enableLocalFile2Url: false,
      parseMultMsg: false,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
chmodSync(onebotPath, 0o600);

console.log(`WebUI: ${webuiPath}`);
console.log(`OneBot: ${onebotPath}`);
console.log(`Token: ${token.slice(0, 4)}…${token.slice(-4)} (${token.length} chars)`);
