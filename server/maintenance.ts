import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {db,list,remove,settings,acquireLease,releaseLease,dataDir} from './db.ts';
import {deleteCloudFile} from './cloud-storage.ts';

async function discard(file:any){
 if(file.storage==='supabase'||file.objectKey)await deleteCloudFile(file.objectKey);
 else if(file.filename)await unlink(path.join(dataDir,'media',file.filename)).catch(()=>{});
}
/** Bounded batches keep cleanup within the serverless execution window. */
export async function maintenance(now=Date.now()){
 const lease=acquireLease('maintenance:hourly',3600000);if(!lease)return;
 try{
  db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
  db.prepare('DELETE FROM one_time WHERE expires<?').run(now);
  db.prepare('DELETE FROM leases WHERE expires<?').run(now);
  const expired=db.prepare("SELECT * FROM objects WHERE kind='upload' AND CAST(json_extract(data,'$.expires') AS BIGINT)<? LIMIT 20").all(now);
  for(const row of expired){try{await discard(JSON.parse(row.data));remove(row.workspace,'upload',row.id);}catch{/* Retain reservation for the next cleanup attempt. */}}
  for(const w of db.prepare('SELECT id FROM workspaces WHERE demo=1 AND created<? LIMIT 10').all(now-86400000)){
   let complete=true;
   for(const file of [...list(w.id,'media'),...list(w.id,'artwork'),...list(w.id,'upload')]){try{await discard(file);}catch{complete=false;}}
   if(complete)db.prepare('DELETE FROM workspaces WHERE id=? AND demo=1').run(w.id);
  }
  for(const w of db.prepare('SELECT id FROM workspaces').all()){
   const cutoff=now-settings(w.id).retentionDays*86400000;
   db.prepare('DELETE FROM events WHERE workspace=? AND created<?').run(w.id,cutoff);
   db.prepare('DELETE FROM audit WHERE workspace=? AND created<?').run(w.id,cutoff);
  }
 }catch(error){releaseLease('maintenance:hourly',lease);throw error;}
}
