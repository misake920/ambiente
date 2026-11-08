import {db,get,list,put,settings} from './db.ts';
import {builtinModels,emptyModelState,evolveModel,type LiveModel,type ModelAction} from '../shared/live-models.ts';
import type {IncomingEvent} from './engine.ts';
export function modelCatalog(workspace:string){return [...list(workspace,'live-model').map(m=>({...m,builtin:false})),...builtinModels];}
export function findModel(workspace:string,id:string):LiveModel|undefined{return modelCatalog(workspace).find(m=>m.id===id) as LiveModel|undefined;}
export function activeModel(workspace:string){return list(workspace,'live').find(l=>l.status==='preview'&&l.model);}
export function matchModel(workspace:string,input:IncomingEvent,eventId:string){
 if(input.isTest&&input.ruleId)return null;
 const live=activeModel(workspace),config=settings(workspace);if(!live||config.paused||config.emergency)return null;
 const model=live.model as LiveModel;let match:{action:string;units:number}|undefined;
 const command=model.commands.find(c=>c.command.toLowerCase()===input.message.trim().split(/\s+/)[0]?.toLowerCase());
 if(input.kind==='donation'&&input.confirmed&&(input.provider==='livepix'||input.isTest)){
  match=[...model.tiers].sort((a,b)=>b.minCents-a.minCents).find(t=>input.amount>=t.minCents);
  if(match&&model.scene==='arena'&&command&&['purple','green'].includes(command.action))match={...match,action:command.action};
 }else if(input.kind==='chat'){
  match=command;
  if(match&&!input.isTest){
   const key='model:'+live.id+':'+input.provider+':'+input.user.normalize('NFKC').toLowerCase(),last=list(workspace,'cooldown').find(c=>c.key===key);
   if(last&&Date.now()-last.at<model.cooldown*1000)return null;
   put(workspace,'cooldown',{key,at:Date.now()},last?.id);
  }
 }
 if(!match)return null;
 return {eventId,modelSessionId:live.id,modelId:model.id,modelAction:match.action,units:match.units,action:'model',name:model.name,user:input.user,amount:input.amount,message:input.message,speech:'',isTest:input.isTest,priority:50,duration:3};
}
/** Called inside the exclusive job-claim transaction. Tests animate without changing real model counters. */
export function applyModelJob(workspace:string,jobId:string){
 const row=db.prepare('SELECT data FROM jobs WHERE workspace=? AND id=?').get(workspace,jobId);if(!row)return;
 const data=JSON.parse(row.data);if(data.action!=='model'||data.isTest)return;
 const live=get(workspace,'live',data.modelSessionId);
 if(!live||live.status!=='preview'||!live.model)throw Object.assign(new Error('A sessão deste modelo foi encerrada.'),{status:409});
 const action:ModelAction={id:jobId,action:data.modelAction,units:data.units,user:data.user,isTest:false,at:Date.now()};
 put(workspace,'live',{modelState:evolveModel(live.modelState||emptyModelState(),action,live.model.goal)},live.id);
}
export function stopModelJobs(workspace:string,sessionId:string){
 db.prepare("UPDATE jobs SET state='cancelled',updated=? WHERE workspace=? AND type='interaction' AND json_extract(data,'$.modelSessionId')=? AND state IN ('queued','running','paused','awaiting_approval')").run(Date.now(),workspace,sessionId);
}
