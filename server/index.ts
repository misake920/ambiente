import './config.ts';
import { app } from './app.ts';
import { startWorker } from './worker.ts';
import { db, list, remove, settings } from './db.ts';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.ts';
const port=Number(process.env.PORT||3001);
const server=app.listen(port,'0.0.0.0',()=>console.log(`00 do Dark API • porta ${port}`));
const stop=startWorker();
const cleanup=setInterval(()=>{
 const now=Date.now();db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('DELETE FROM one_time WHERE expires<?').run(now);
 for(const w of db.prepare('SELECT id FROM workspaces WHERE demo=1 AND created<?').all(now-86400000) as {id:string}[]) {for(const m of [...list(w.id,'media'),...list(w.id,'artwork')]) {try{unlinkSync(path.join(dataDir,'media',m.filename));}catch{}}db.prepare('DELETE FROM workspaces WHERE id=?').run(w.id);}
 for(const w of db.prepare('SELECT id FROM workspaces').all() as {id:string}[]) { const cutoff=now-settings(w.id).retentionDays*86400000;db.prepare('DELETE FROM events WHERE workspace=? AND created<?').run(w.id,cutoff);db.prepare('DELETE FROM audit WHERE workspace=? AND created<?').run(w.id,cutoff); }
},3600000);
function shutdown(){stop();clearInterval(cleanup);server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
