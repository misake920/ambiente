import type {Express,RequestHandler} from 'express';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {db,get,list,put,remove} from './db.ts';
import {hash} from './security.ts';
import {ingest} from './engine.ts';
import {origin} from './config.ts';
export function publicBridges(workspace:string){return list(workspace,'chat-bridge').map(({id,name,platform,lastSeenAt,createdAt})=>({id,name,platform,lastSeenAt,createdAt}));}
export function registerChatBridges(app:Express,auth:RequestHandler,mutate:RequestHandler){
 const limit=rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Limite de mensagens do conector. Aguarde um minuto.'}});
 const reveal=(record:any,token:string)=>({id:record.id,name:record.name,platform:record.platform,url:origin+'/api/chat-bridges/'+record.id+'/events',token});
 app.post('/api/chat-bridges',auth,mutate,(req,res)=>{
  const w=req.auth.workspace,value=z.object({name:z.string().trim().min(2).max(60),platform:z.enum(['tiktok','kwai'])}).parse(req.body);
  if(list(w,'chat-bridge').length>=20)throw Object.assign(new Error('Limite de 20 conectores de chat por workspace.'),{status:409});
  const token=randomBytes(32).toString('hex'),record=put(w,'chat-bridge',{...value,secretHash:hash(token),lastSeenAt:null,createdAt:Date.now()});res.status(201).json(reveal(record,token));
 });
 app.post('/api/chat-bridges/:id/rotate',auth,mutate,(req,res)=>{
  const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'chat-bridge',id))throw Object.assign(new Error('Conector não encontrado.'),{status:404});
  const token=randomBytes(32).toString('hex'),record=put(w,'chat-bridge',{secretHash:hash(token),lastSeenAt:null},id);res.json(reveal(record,token));
 });
 app.delete('/api/chat-bridges/:id',auth,mutate,(req,res)=>{const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'chat-bridge',id))throw Object.assign(new Error('Conector não encontrado.'),{status:404});remove(w,'chat-bridge',id);res.json({ok:true});});
 app.post('/api/chat-bridges/:id/events',limit,(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),token=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)throw Object.assign(new Error('Chave do conector inválida.'),{status:401});
  // Authenticate before parsing events. This channel accepts chat only, never financial values.
  const row=chatBridgeRow(id),record=row&&JSON.parse(row.data);
  if(!record||!timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(record.secretHash,'hex')))throw Object.assign(new Error('Chave do conector inválida.'),{status:401});
  const body=z.object({externalId:z.string().trim().min(1).max(150),user:z.string().trim().min(1).max(60),message:z.string().trim().min(1).max(500),isTest:z.boolean().default(false)}).strict().parse(req.body);
  const result=ingest(row.workspace,{externalId:id+':'+body.externalId,provider:record.platform,kind:'chat',user:body.user,message:body.message,amount:0,confirmed:true,isTest:body.isTest},()=>{
   const current=get(row.workspace,'chat-bridge',id);if(!current||current.secretHash!==record.secretHash)throw Object.assign(new Error('Conector revogado.'),{status:401});
   put(row.workspace,'chat-bridge',{lastSeenAt:Date.now()},id);
  });res.status(202).json({ok:true,...result});
 });
}
function chatBridgeRow(id:string){return db.prepare("SELECT workspace,data FROM objects WHERE id=? AND kind='chat-bridge'").get(id);}
