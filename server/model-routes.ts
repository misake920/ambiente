import type {Express,RequestHandler} from 'express';
import {z} from 'zod';
import {get,list,put,remove,log,transaction,settings} from './db.ts';
import {sceneKinds,getModelActions,emptyModelState} from '../shared/live-models.ts';
import {findModel,modelCatalog} from './model-runtime.ts';
const modelSchema=z.object({name:z.string().trim().min(2).max(70),description:z.string().trim().min(5).max(220),scene:z.enum(sceneKinds),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),orientation:z.enum(['portrait','landscape']),goal:z.number().int().min(10).max(1000000),cooldown:z.number().int().min(3).max(300),tiers:z.array(z.object({minCents:z.number().int().min(1).max(10000000),label:z.string().trim().min(1).max(60),action:z.string().max(30),units:z.number().int().min(1).max(100)})).min(1).max(8),commands:z.array(z.object({command:z.string().regex(/^![a-zA-Z0-9_]{1,25}$/),action:z.string().max(30),units:z.number().int().min(1).max(10)})).min(1).max(8)}).superRefine((m,ctx)=>{
 const actions=getModelActions(m.scene);
 if([...m.tiers,...m.commands].some(t=>!Object.hasOwn(actions,t.action)))ctx.addIssue({code:'custom',message:'Ação incompatível com o cenário.'});
 if(new Set(m.commands.map(c=>c.command.toLowerCase())).size!==m.commands.length)ctx.addIssue({code:'custom',message:'Use comandos diferentes.'});
 if(new Set(m.tiers.map(t=>t.minCents)).size!==m.tiers.length)ctx.addIssue({code:'custom',message:'Use valores diferentes para cada faixa de Pix.'});
});
export function registerModelRoutes(app:Express,auth:RequestHandler,mutate:RequestHandler){
 app.get('/api/live-models',auth,(req,res)=>res.json({models:modelCatalog(req.auth.workspace)}));
 app.post('/api/live-models',auth,mutate,(req,res)=>{
  const w=req.auth.workspace;if(list(w,'live-model').length>=100)throw Object.assign(new Error('Limite de 100 modelos personalizados por workspace.'),{status:409});
  res.status(201).json(put(w,'live-model',{...modelSchema.parse(req.body),builtin:false}));
 });
 app.put('/api/live-models/:id',auth,mutate,(req,res)=>{
  const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'live-model',id))throw Object.assign(new Error('Modelo não encontrado. Duplique os modelos iniciais para editar.'),{status:404});
  res.json(put(w,'live-model',{...modelSchema.parse(req.body),builtin:false},id));
 });
 app.delete('/api/live-models/:id',auth,mutate,(req,res)=>{
  const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'live-model',id))throw Object.assign(new Error('Modelo não encontrado.'),{status:404});
  remove(w,'live-model',id);res.json({ok:true});
 });
 app.post('/api/live-models/:id/start',auth,mutate,(req,res)=>{
  const w=req.auth.workspace,model=findModel(w,String(req.params.id));if(!model)throw Object.assign(new Error('Modelo não encontrado.'),{status:404});
  const {title}=z.object({title:z.string().trim().min(1).max(100).optional()}).parse(req.body);
  const live=transaction(()=>{
   if(list(w,'live').some(l=>l.status==='preview'))throw Object.assign(new Error('Encerre a sessão atual antes de iniciar outro modelo.'),{status:409});
   put(w,'settings',{scene:'Principal'},settings(w).id);
   return put(w,'live',{title:title||model.name,status:'preview',startedAt:Date.now(),isDemo:req.auth.demo,model,modelState:emptyModelState()});
  });
  log(w,'Sessão iniciada com modelo: '+model.name);res.status(201).json(live);
 });
}
