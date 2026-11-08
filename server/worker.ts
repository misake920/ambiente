import { db, get, list, log, acquireLease, releaseLease, extendLease } from './db.ts';
import { claimInteraction, recoverJobs } from './engine.ts';
import { broadcast, hasConsumer } from './app.ts';
import { publishYouTube, pollYouTube } from './connectors.ts';
import {serverless} from './runtime.ts';
let working=false;
const nextPoll=new Map<string,number>(),inFlight=new Set<string>();
async function sendPublication(job:any,data:any,p:any,a:any,lease:string) {
 try {
  const result=await publishYouTube(job.workspace,a,{...p,...p.overrides?.[a.id]},job.id);
  db.prepare("UPDATE jobs SET state='completed',data=?,updated=? WHERE id=?").run(JSON.stringify({...data,...result}),Date.now(),job.id);
  log(job.workspace,'YouTube confirmou o envio: '+p.title);
 } catch(e:any) {
  const current=db.prepare('SELECT data FROM jobs WHERE id=?').get(job.id) as any;
  const uncertain=!!current&&!!JSON.parse(current.data).uploadSession;
  if(!uncertain&&[429,500,502,503,504].includes(e.remoteStatus)&&job.attempts<3)
   db.prepare("UPDATE jobs SET state='queued',due=?,attempts=attempts+1,error=?,updated=? WHERE id=?").run(Date.now()+30000*2**job.attempts,e.message,Date.now(),job.id);
  else db.prepare('UPDATE jobs SET state=?,error=?,updated=? WHERE id=?').run(uncertain?'needs_review':'failed',e.message||'Falha no envio.',Date.now(),job.id);
  log(job.workspace,'Falha no envio. Consulte o status por destino.');
 } finally {inFlight.delete(a.id);releaseLease('publication-account:'+a.id,lease);broadcast(job.workspace);}
}
export async function tick(now=Date.now(),drain=false) {
 if(working)return;working=true;
 const pending:Promise<unknown>[]=[];
 try {
  recoverJobs(now);
  const workspaces=db.prepare('SELECT id FROM workspaces').all() as {id:string}[];
  for(const {id} of workspaces) {
   if(hasConsumer(id)){const job=claimInteraction(id);if(job)broadcast(id,'interaction',job);}
   for(const a of list(id,'account'))if(a.platform==='youtube'&&a.chatEnabled&&!a.isDemo&&a.status==='connected'&&(nextPoll.get(a.id)||0)<=now) {
    const lease=acquireLease('youtube-chat:'+a.id,60000);if(!lease)continue;
    nextPoll.set(a.id,now+60000);
    const operation=pollYouTube(id,a).then(r=>{const next=Date.now()+r.next;nextPoll.set(a.id,next);extendLease('youtube-chat:'+a.id,lease,next);broadcast(id);}).catch(()=>{log(id,'Leitura do chat indisponível. Verifique a conexão da conta.');});pending.push(operation);
   }
  }
  const due=db.prepare("SELECT * FROM jobs WHERE type='publication' AND state='queued' AND due<=? ORDER BY due LIMIT 20").all(now) as any[];
  for(const job of due) {
   const data=JSON.parse(job.data),p=get(job.workspace,'publication',data.publicationId),a=get(job.workspace,'account',data.accountId);
   if(!p||!a){db.prepare("UPDATE jobs SET state='failed',error='Publicação ou conta removida.',updated=? WHERE id=?").run(now,job.id);continue;}
   if(data.isTest||a.platform!=='youtube'||a.status!=='connected'||!a.tokens){
    db.prepare("UPDATE jobs SET state='awaiting_manual',error=?,updated=? WHERE id=?").run(data.isTest?'Demonstração: nenhum vídeo foi enviado.':'Publicação assistida: envie o vídeo na plataforma e confirme o link.',now,job.id);
    log(job.workspace,'Publicação pronta para envio assistido: '+p.title);broadcast(job.workspace);continue;
   }
   if(inFlight.size>=2||inFlight.has(a.id))continue;
   const duration=serverless?330000:660000,lease=acquireLease('publication-account:'+a.id,duration);if(!lease)continue;
   const result=db.prepare("UPDATE jobs SET state='running',lease=?,updated=? WHERE id=? AND state='queued'").run(now+duration,now,job.id);
   if(!result.changes){releaseLease('publication-account:'+a.id,lease);continue;}inFlight.add(a.id);pending.push(sendPublication(job,data,p,a,lease));
  }
  for(const {id} of workspaces)if(hasConsumer(id))broadcast(id);
  if(drain)await Promise.allSettled(pending);else for(const operation of pending)void operation.catch(()=>console.error('{"level":"error","code":"BACKGROUND_OPERATION"}'));
 }finally{working=false;}
}
export function startWorker(){const t=setInterval(()=>void tick().catch(()=>console.error('{"level":"error","code":"WORKER_TICK"}')),1500);return()=>clearInterval(t);}
