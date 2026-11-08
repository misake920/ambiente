import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
Object.assign(process.env,{NODE_ENV:'test',POSTGRES_URL:'',DATA_DIR:mkdtempSync(path.join(tmpdir(),'dark-models-')),APP_ORIGIN:'http://localhost:5173'});
const {db,list,put,get,settings,jobs}=await import('../server/db.ts');
const {app}=await import('../server/app.ts');
const {ingest,claimInteraction}=await import('../server/engine.ts');
const {builtinModels}=await import('../shared/live-models.ts');
const {modelCatalog}=await import('../server/model-runtime.ts');
const {hash}=await import('../server/security.ts');
after(()=>{db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
async function setup(){
 const agent=request.agent(app),email='models-'+randomUUID()+'@example.invalid';assert.equal((await agent.post('/api/auth/register').send({name:'Model testing',email,password:'test-model-password-2026'})).status,201);
 const me=(await agent.get('/api/me')).body,w=me.workspace;for(const r of list(w,'rule'))put(w,'rule',{enabled:false},r.id);
 return {agent,w};
}
const event=(data:Record<string,any>={})=>({externalId:randomUUID(),provider:'livepix',kind:'donation' as const,user:'Pessoa',message:'Apoio',amount:500,confirmed:true,isTest:false,...data});
async function claim(agent:ReturnType<typeof request.agent>,w:string){const job=claimInteraction(w)!;assert(job);const consumer=randomUUID(),result=await agent.post('/api/player/claim').send({id:job.id,consumer});assert.equal(result.status,200);return {job,consumer};}

test('library contains six editable starting points without creating activity',async()=>{
 const {agent,w}=await setup();const r=await agent.get('/api/live-models');assert.equal(r.status,200);assert.equal(r.body.models.length,6);assert.equal(list(w,'live').length,0);assert.equal(jobs(w).length,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events WHERE workspace=?').get(w).n,0);
 for(const m of r.body.models){assert(m.commands.length);assert(m.tiers.some((t:any)=>t.minCents===1));assert.equal(m.orientation,'portrait');}
});
test('custom models persist and are isolated; incompatible actions and duplicate commands are rejected',async()=>{
 const {agent,w}=await setup(),other=await setup(),base={...builtinModels[0],name:'Meu bot'};
 const saved=await agent.post('/api/live-models').send(base);assert.equal(saved.status,201);assert.equal(saved.body.builtin,false);assert.equal(modelCatalog(w).length,7);
 assert.equal((await other.agent.put('/api/live-models/'+saved.body.id).send(base)).status,404);
 assert.equal((await other.agent.post('/api/live-models/'+saved.body.id+'/start').send({})).status,404);
 assert.equal((await agent.put('/api/live-models/dark-bot').send(base)).status,404);
 assert.equal((await agent.post('/api/live-models').send({...base,tiers:[{...base.tiers[0],action:'execute-html'}]})).status,400);
 assert.equal((await agent.post('/api/live-models').send({...base,commands:[base.commands[0],base.commands[0]]})).status,400);
 assert.equal((await agent.put('/api/live-models/'+saved.body.id).send({...base,name:'Bot atualizado'})).status,200);assert.equal(get(w,'live-model',saved.body.id)?.name,'Bot atualizado');
});
test('starting snapshots the model and zero counters; a second session cannot overwrite it',async()=>{
 const {agent,w}=await setup(),saved=(await agent.post('/api/live-models').send({...builtinModels[0],name:'Snapshot'})).body;
 put(w,'settings',{scene:'Intervalo'},settings(w).id);
 const start=await agent.post('/api/live-models/'+saved.id+'/start').send({title:'Minha live'});assert.equal(start.status,201);assert.equal(start.body.modelState.interactions,0);assert.equal(start.body.model.name,'Snapshot');assert.equal(settings(w).scene,'Principal');
 assert.equal((await agent.post('/api/live-models/community-rocket/start').send({})).status,409);
 await agent.put('/api/live-models/'+saved.id).send({...saved,name:'Configuração futura'});assert.equal(get(w,'live',start.body.id)?.model.name,'Snapshot');
 const overlay=await agent.get('/api/overlay/'+settings(w).overlayToken+'/state');assert.equal(overlay.body.liveModel.id,start.body.id);assert.equal(overlay.body.liveModel.modelState.points,0);
});
test('each starting model matches real Pix and chat, choosing exactly the highest donation tier',async()=>{
 for(const m of builtinModels){
  const {agent,w}=await setup(),live=(await agent.post('/api/live-models/'+m.id+'/start').send({})).body;
  const result=ingest(w,event({amount:2000}));assert.equal(result.actions.length,1);const job=jobs(w)[0];assert.equal(job.data.action,'model');assert.equal(job.data.modelAction,m.tiers[2].action);assert.equal(job.data.units,20);
  assert.equal(get(w,'live',live.id)?.modelState.interactions,0,'enqueueing must not advance the model');
  const claimed=await claim(agent,w);assert.equal(get(w,'live',live.id)?.modelState.interactions,1);assert.equal(get(w,'live',live.id)?.modelState.points,20);
  assert.equal((await agent.post('/api/player/claim').send({id:claimed.job.id,consumer:randomUUID()})).status,409);assert.equal(get(w,'live',live.id)?.modelState.interactions,1);
  await agent.post('/api/player/ack').send({id:claimed.job.id,consumer:claimed.consumer});
  assert.equal(ingest(w,event({kind:'chat',provider:'youtube',user:'Chat '+m.id,message:m.commands[0].command,amount:0})).actions.length,1);
 }
});
test('pending, repeated, moderated and unsupported provider payments cannot trigger a model',async()=>{
 const {agent,w}=await setup();await agent.post('/api/live-models/dark-bot/start').send({});
 const pending=event({confirmed:false});assert.equal(ingest(w,pending).actions.length,0);assert.equal(ingest(w,{...pending,confirmed:true}).actions.length,1);assert.equal(ingest(w,{...pending,confirmed:true}).actions.length,0);
 assert.equal(ingest(w,event({message:'spamproibido'})).actions.length,0);assert.equal(ingest(w,event({provider:'untrusted-browser'})).actions.length,0);
 put(w,'settings',{paused:true},settings(w).id);assert.equal(ingest(w,event()).actions.length,0);
});
test('manual approval and per-person model cooldown also apply to interactive sessions',async()=>{
 const {agent,w}=await setup();await agent.post('/api/live-models/dark-bot/start').send({});
 put(w,'settings',{manualApproval:true},settings(w).id);
 const first=ingest(w,event({kind:'chat',provider:'youtube',message:'!pular',amount:0}));assert.equal(first.actions.length,1);assert.equal(jobs(w)[0].state,'awaiting_approval');assert.equal(claimInteraction(w),null);
 // Advance beyond the generic chat throttle but stay inside the model's 10-second cooldown.
 db.prepare('UPDATE events SET created=? WHERE workspace=?').run(Date.now()-2000,w);
 assert.equal(ingest(w,event({kind:'chat',provider:'youtube',message:'!dancar',amount:0})).actions.length,0);
 await agent.post('/api/jobs/'+first.actions[0]+'/approve').send({});await claim(agent,w);
 assert.equal(list(w,'live')[0].modelState.interactions,1);
});
test('test events animate without advancing real model counters or financial totals',async()=>{
 const {agent,w}=await setup(),live=(await agent.post('/api/live-models/pix-tower/start').send({})).body;
 const response=await agent.post('/api/events/test').send({kind:'donation',user:'Teste',message:'Prévia',amount:2000,confirmed:true});assert.equal(response.body.actions.length,1);
 await claim(agent,w);assert.equal(get(w,'live',live.id)?.modelState.objects,0);assert.equal(get(w,'live',live.id)?.modelState.interactions,0);
 const state=(await agent.get('/api/state')).body;assert.equal(state.stats.revenue,0);assert.equal(state.stats.interactions,0);
});
test('arena routes a confirmed donation to the team named in its message',async()=>{
 const {agent,w}=await setup(),live=(await agent.post('/api/live-models/neon-arena/start').send({})).body;
 ingest(w,event({message:'!verde',amount:500}));await claim(agent,w);const state=get(w,'live',live.id)?.modelState;assert.equal(state.green,5);assert.equal(state.purple,0);
});
test('ending a session cancels its model jobs and stops accepting model commands',async()=>{
 const {agent,w}=await setup(),live=(await agent.post('/api/live-models/dark-bot/start').send({})).body;ingest(w,event());assert.equal(jobs(w)[0].state,'queued');
 assert.equal((await agent.patch('/api/lives/'+live.id).send({status:'ended'})).status,200);assert.equal(jobs(w)[0].state,'cancelled');assert.equal(ingest(w,event()).actions.length,0);
 assert.equal((await agent.post('/api/live-models/gift-orbit/start').send({})).status,201);
});
test('moderators may view the library but cannot create or start models',async()=>{
 const {agent,w}=await setup(),member=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,NULL,NULL,?)').run(member,member+'@example.invalid','Moderador','unused',Date.now());db.prepare('INSERT INTO members VALUES(?,?,?)').run(w,member,'moderator');const token=randomUUID();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),member,w,Date.now()+60000);
 const cookie='dark_session='+token;assert.equal((await request(app).get('/api/live-models').set('Cookie',cookie)).status,200);assert.equal((await request(app).post('/api/live-models/dark-bot/start').set('Cookie',cookie).send({})).status,403);
});

test('a protected TikTok chat bridge authenticates messages, deduplicates and cannot create payments',async()=>{
 const {agent,w}=await setup();await agent.post('/api/live-models/dark-bot/start').send({});
 const created=await agent.post('/api/chat-bridges').send({name:'Meu TikTok',platform:'tiktok'});assert.equal(created.status,201);const bridge=created.body,path='/api/chat-bridges/'+bridge.id+'/events';
 assert.equal(bridge.token.length,64);assert.equal((await agent.get('/api/state')).body.chatBridges[0].secretHash,undefined);assert(!JSON.stringify((await agent.get('/api/state')).body).includes(bridge.token));
 const message={externalId:'tiktok-message-1',user:'Pessoa TikTok',message:'!pular'};
 assert.equal((await request(app).post(path).send(message)).status,401);assert.equal((await request(app).post(path).set('Authorization','Bearer '+'a'.repeat(64)).send(message)).status,401);
 assert.equal((await request(app).post(path).set('Authorization','Bearer '+bridge.token).send({...message,kind:'donation',amount:99999})).status,400);
 const accepted=await request(app).post(path).set('Authorization','Bearer '+bridge.token).send(message);assert.equal(accepted.status,202);assert.equal(accepted.body.actions.length,1);
 const repeat=await request(app).post(path).set('Authorization','Bearer '+bridge.token).send(message);assert.equal(repeat.body.duplicate,true);assert.equal(jobs(w).length,1);
 const state=(await agent.get('/api/state')).body;assert.equal(state.stats.revenue,0);assert.equal(state.events[0].provider,'tiktok');assert.equal(state.events[0].kind,'chat');assert(state.chatBridges[0].lastSeenAt);
 await claim(agent,w);assert.equal(list(w,'live')[0].modelState.interactions,1);
});
test('bridge key rotation and removal revoke incoming access, and moderation still blocks its commands',async()=>{
 const {agent,w}=await setup(),other=await setup();await agent.post('/api/live-models/dark-bot/start').send({});
 const bridge=(await agent.post('/api/chat-bridges').send({name:'Conector externo',platform:'kwai'})).body,path='/api/chat-bridges/'+bridge.id+'/events';
 assert.equal((await other.agent.post('/api/chat-bridges/'+bridge.id+'/rotate').send({})).status,404);
 const rotated=(await agent.post('/api/chat-bridges/'+bridge.id+'/rotate').send({})).body;
 const message={externalId:'command-1',user:'Pessoa',message:'!pular'};
 assert.equal((await request(app).post(path).set('Authorization','Bearer '+bridge.token).send(message)).status,401);
 const blocked=await request(app).post(path).set('Authorization','Bearer '+rotated.token).send({...message,message:'!pular spamproibido'});assert.equal(blocked.status,202);assert(blocked.body.blocked);assert.equal(jobs(w).length,0);
 await agent.delete('/api/chat-bridges/'+bridge.id);assert.equal((await request(app).post(path).set('Authorization','Bearer '+rotated.token).send(message)).status,401);
});

test('testing one automation does not enqueue an unrelated model reaction',async()=>{
 const {agent,w}=await setup();await agent.post('/api/live-models/dark-bot/start').send({});const rule=list(w,'rule')[0];put(w,'rule',{enabled:true},rule.id);
 const response=await agent.post('/api/events/test').send({ruleId:rule.id,kind:'donation',user:'Teste da regra',message:'Teste isolado',amount:1500,confirmed:true});assert.equal(response.body.actions.length,1);assert.equal(jobs(w)[0].data.ruleId,rule.id);assert.notEqual(jobs(w)[0].data.action,'model');
});

test('a model waits in the queue while the interval scene is displayed',async()=>{
 const {agent,w}=await setup();await agent.post('/api/live-models/dark-bot/start').send({});put(w,'settings',{scene:'Intervalo'},settings(w).id);ingest(w,event());assert.equal(claimInteraction(w),null);assert.equal(jobs(w)[0].state,'queued');put(w,'settings',{scene:'Principal'},settings(w).id);assert(claimInteraction(w));
});
