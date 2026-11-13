import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.mjs';
import { createBackup, restoreBackup } from './backup.mjs';

const command = process.argv[2];
const dataDir = process.env.PET_DATA_DIR || resolve('.cache/pet-app-data');
if (command === 'invite') {
  const store = new Store(dataDir);
  try {
    const url = new URL('/', process.env.PET_PUBLIC_URL || 'http://127.0.0.1:8899');
    url.hash = `invite=${store.createInvite({ admin: process.argv.includes('--admin') })}`;
    console.log('一次性邀请（24小时有效，请私下保管）：\n' + url.href);
  } finally { store.close(); }
} else if (command === 'keygen') {
  console.log(randomBytes(32).toString('hex'));
} else if (command === 'backup') {
  if (!process.env.PET_BACKUP_DIR) throw new Error('请配置独立备份目录 PET_BACKUP_DIR');
  const archive = await createBackup({ dataDir, destination: process.env.PET_BACKUP_DIR, key: process.env.PET_BACKUP_KEY });
  console.log('已生成加密快照：' + archive);
} else if (command === 'restore') {
  if (!process.argv.includes('--confirm-offline') || !process.env.PET_RESTORE_ARCHIVE || !process.env.PET_RESTORE_TARGET || !process.env.PET_DELETION_JOURNAL) throw new Error('恢复需停服，并设置 PET_RESTORE_ARCHIVE、空的 PET_RESTORE_TARGET、最新 PET_DELETION_JOURNAL，再加 --confirm-offline');
  await restoreBackup({ archive: process.env.PET_RESTORE_ARCHIVE, dataDir: process.env.PET_RESTORE_TARGET, key: process.env.PET_BACKUP_KEY, deletionJournal: process.env.PET_DELETION_JOURNAL });
  console.log('恢复完成，旧会话与邀请已失效。请检查新目录后再切换生产服务。');
} else {
  console.log('用法：node pet-app/cli.mjs invite [--admin] | keygen | backup | restore --confirm-offline\n密钥和路径从环境变量读取，勿把密钥作为命令参数。');
}
