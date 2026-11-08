import type {Express,Request,Response,NextFunction} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {db,postgres,postgresSchema,acquireLease,releaseLease} from './db.ts';
import {origin} from './config.ts';
import {prepareStorage} from './cloud-storage.ts';

function internal(req:Request,res:Response,next:NextFunction){
 const expected=process.env.CRON_SECRET,provided=req.get('authorization')||'';
 if(!expected||provided.length!==expected.length+7||!timingSafeEqual(Buffer.from(provided),Buffer.from('Bearer '+expected)))return res.status(401).json({error:'Não autorizado.'});next();
}
export function registerCloudSetup(app:Express){
 app.post('/api/internal/setup',internal,async(_req,res)=>{
  if(!postgres||!process.env.ENCRYPTION_KEY||!origin.startsWith('https://'))throw Object.assign(new Error('Configure PostgreSQL, chave permanente e domínio HTTPS antes de ativar o backend.'),{status:503});
  await prepareStorage();
  db.exec('CREATE EXTENSION IF NOT EXISTS pg_cron;CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;');
  const save=db.prepare('INSERT INTO runtime_secrets(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  save.run('cron-secret',process.env.CRON_SECRET!);save.run('app-origin',origin);
  const schema='"'+postgresSchema+'"';
  const sql=`SELECT net.http_post(url := (SELECT value FROM ${schema}.runtime_secrets WHERE key='app-origin') || '/api/internal/tick',headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT value FROM ${schema}.runtime_secrets WHERE key='cron-secret')),body := '{}'::jsonb,timeout_milliseconds := 290000);`;
  const job=db.prepare('SELECT cron.schedule(?,?,?) AS id').get('00-do-dark-worker','* * * * *',sql);
  save.run('setup-complete','1');res.json({ok:true,schedulerJob:job.id,storage:'private',paidResources:false});
 });
 app.post('/api/internal/tick',internal,async(_req,res)=>{
  const lease=acquireLease('worker:cron',285000);if(!lease)return res.json({ok:true,busy:true});
  try{const {tick}=await import('./worker.ts');await tick(Date.now(),true);res.json({ok:true});}finally{releaseLease('worker:cron',lease);}
 });
}
