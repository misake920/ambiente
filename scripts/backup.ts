import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, dataDir } from '../server/db.ts';
const backupDir=path.join(dataDir,'backups');mkdirSync(backupDir,{recursive:true,mode:0o700});
const destination=path.join(backupDir,`dark-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
await backup(db,destination);db.close();console.log(`Backup consistente do banco criado em ${destination}. Preserve também a mídia e a chave de criptografia em armazenamento seguro.`);
