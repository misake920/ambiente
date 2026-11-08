import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, sqliteDb, dataDir } from '../server/db.ts';
if(!sqliteDb){db.close();throw new Error('No PostgreSQL, exporte o banco com pg_dump ou pelas ferramentas do provedor. O backup SQLite não se aplica.');}
const backupDir=path.join(dataDir,'backups');mkdirSync(backupDir,{recursive:true,mode:0o700});
const destination=path.join(backupDir,`dark-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
await backup(sqliteDb,destination);db.close();console.log(`Backup consistente do banco criado em ${destination}. Preserve também a mídia e a chave de criptografia em armazenamento seguro.`);
