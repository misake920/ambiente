import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { db, postgres, dataDir, list, get, put, remove, settings, jobs, log, transaction } from './db.ts';
import { passwordHash, checkPassword, hash, encrypt, decrypt, publicAccount } from './security.ts';
import { initialWorkspace } from './seed.ts';
import { enqueue, ingest, recoverJobs, claimInteraction } from './engine.ts';
import { capabilities, youtubeStart, youtubeCallback, revoke } from './connectors.ts';
import {beginLink,finishLink,validatePlatformLink} from './oauth-links.ts';
import { origin, isProduction } from './config.ts';
import {serverless,cloudMediaLimit} from './runtime.ts';
import {cloudStorageConfigured,signedDownload,deleteCloudFile} from './cloud-storage.ts';
import {registerCloudUploads} from './cloud-uploads.ts';
import {probeVideo,probeImage} from './media-validation.ts';
import {registerCloudSetup} from './cloud-setup.ts';

declare global { namespace Express { interface Request { auth: { user: string | null; workspace: string; demo: boolean; role: string; name: string; email: string | null }; } } }
export const app=express();
app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy: {directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],mediaSrc:["'self'",'blob:'],connectSrc:["'self'"],frameAncestors:["'self'"]}},referrerPolicy:{policy:'no-referrer'}}));
app.use(express.json({limit:'128kb'}));
app.use('/api',(req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
  const requestOrigin=req.get('origin');
  const fetchSite=req.get('sec-fetch-site');
  const allowedOrigins=[origin,...(!isProduction?['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001']:[])];
  if((requestOrigin && !allowedOrigins.includes(requestOrigin)) || fetchSite==='cross-site') return res.status(403).json({error:'Origem da solicitação não autorizada.'});
 }
 next();
});
const authLimiter=rateLimit({windowMs:15*60000,limit:40,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde alguns minutos.'}});
app.use('/api/auth',authLimiter);
app.get('/api/health',(_req,res)=>res.json({status:'ok',version:'0.1.0',publicOrigin:origin,database:!!db.prepare('SELECT 1').get(),databaseDriver:postgres?'postgresql':'sqlite',cloudSetup:serverless?!!db.prepare("SELECT value FROM runtime_secrets WHERE key='setup-complete'").get():undefined}));
function fail(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
function cookie(req:Request,name:string) { const value=req.headers.cookie?.split(';').find(c=>c.trim().startsWith(name+'='));return value?.trim().slice(name.length+1); }
function session(res:Response,user:string|null,workspace:string) {
 const token=randomBytes(32).toString('base64url');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),user,workspace,Date.now()+7*86400000);
 res.cookie('dark_session',token,{httpOnly:true,sameSite:'lax',secure:isProduction,maxAge:7*86400000,path:'/'});
}
export const requireAuth=(req:Request,res:Response,next:NextFunction)=>{
 const token=cookie(req,'dark_session');
 const row=token ? db.prepare('SELECT s.*,w.demo,w.name as workspaceName,u.name,u.email,m.role FROM sessions s JOIN workspaces w ON w.id=s.workspace LEFT JOIN users u ON u.id=s.user LEFT JOIN members m ON m.workspace=s.workspace AND m.user=s.user WHERE s.token=? AND s.expires>?').get(hash(token),Date.now()) as any : null;
 if(!row || (!row.demo&&!row.role)) return res.status(401).json({error:'Entre na sua conta para continuar.'});
 req.auth={user:row.user,workspace:row.workspace,demo:!!row.demo,role:row.demo?'owner':row.role,name:row.name||'Dark Studio',email:row.email||null}; next();
};
const role=(...roles:string[])=>(req:Request,res:Response,next:NextFunction)=>roles.includes(req.auth.role)?next():res.status(403).json({error:'Seu perfil não permite esta ação.'});
const mutate=role('owner','operator');
const owner=role('owner');
registerCloudUploads(app,requireAuth,mutate);
registerCloudSetup(app);
const totp=(secret:string,email:string)=>new OTPAuth.TOTP({issuer:'00 do Dark',label:email,algorithm:'SHA1',digits:6,period:30,secret});
const credentials=z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(10).max(128),name:z.string().trim().min(2).max(60).optional(),code:z.string().max(10).optional()});
app.post('/api/auth/demo',(req,res)=>{
 if(process.env.DEMO_ENABLED==='false') return res.status(403).json({error:'Demonstração desativada.'});
 const token=cookie(req,'dark_session');
 if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
 const id=randomUUID();
 transaction(()=>{db.prepare('INSERT INTO workspaces VALUES(?,?,1,?)').run(id,'Dark Studio',Date.now());initialWorkspace(id,true);session(res,null,id);});
 res.json({ok:true});
});
app.post('/api/auth/register',(req,res)=>{
 if(process.env.REGISTRATION_ENABLED==='false') fail('Novos cadastros estão desativados.',403);
 const data=credentials.parse(req.body);if(!data.name) fail('Informe seu nome.');
 const id=randomUUID(),workspace=randomUUID();
 if(db.prepare('SELECT id FROM users WHERE email=?').get(data.email)) fail('Não foi possível criar esta conta. Tente entrar ou recuperar o acesso.',409);
 transaction(()=>{db.prepare('INSERT INTO users VALUES(?,?,?,?,NULL,NULL,?)').run(id,data.email,data.name!,passwordHash(data.password),Date.now());db.prepare('INSERT INTO workspaces VALUES(?,?,0,?)').run(workspace,'Meu Studio',Date.now());db.prepare('INSERT INTO members VALUES(?,?,?)').run(workspace,id,'owner');initialWorkspace(workspace);session(res,id,workspace);});
 res.status(201).json({ok:true});
});
app.post('/api/auth/login',(req,res)=>{
 const data=credentials.parse(req.body),user=db.prepare('SELECT * FROM users WHERE email=?').get(data.email) as any;
 if(!user||!checkPassword(data.password,user.password)) fail('E-mail ou senha incorretos.',401);
 if(user.totp&&(!data.code||totp(decrypt(user.totp),user.email).validate({token:data.code,window:1})===null)) return res.status(401).json({error:'Informe o código do seu autenticador.',requires2fa:true});
 const member=db.prepare("SELECT * FROM members WHERE user=? ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END,workspace LIMIT 1").get(user.id) as any;
 session(res,user.id,member.workspace);res.json({ok:true});
});
app.post('/api/auth/forgot',async(req,res)=>{
 const email=z.email().parse(req.body.email).toLowerCase();
 if(!process.env.SMTP_HOST||!process.env.SMTP_FROM) fail('O envio de recuperação ainda não foi configurado pelo administrador.',409);
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(email) as any;
 if(user) {
  const token=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO one_time VALUES(?,?,NULL,?,?,?)').run(hash(token),user.id,'reset','{}',Date.now()+1800000);
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined});
  await transport.sendMail({from:process.env.SMTP_FROM,to:email,subject:'Redefinir sua senha — 00 do Dark',text:`Abra o link para redefinir sua senha (válido por 30 minutos): ${origin}/?reset=${token}`});
 }
 res.json({ok:true,message:'Se o e-mail estiver cadastrado, você receberá as instruções.'});
});
app.post('/api/auth/reset',(req,res)=>{
 const data=z.object({token:z.string().min(20),password:z.string().min(10).max(128)}).parse(req.body);
 const row=db.prepare("SELECT * FROM one_time WHERE token=? AND kind='reset' AND expires>?").get(hash(data.token),Date.now()) as any;
 if(!row) fail('Link inválido ou expirado.');
 transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(data.password),row.user);db.prepare('DELETE FROM sessions WHERE user=?').run(row.user);db.prepare('DELETE FROM one_time WHERE token=?').run(hash(data.token));});
 res.json({ok:true});
});
app.post('/api/auth/logout',requireAuth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(hash(cookie(req,'dark_session')||''));res.clearCookie('dark_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',requireAuth,(req,res)=>{
 const memberships=req.auth.user?db.prepare('SELECT w.id,w.name,m.role FROM members m JOIN workspaces w ON w.id=m.workspace WHERE m.user=?').all(req.auth.user):[{id:req.auth.workspace,name:'Dark Studio',role:'owner'}];
 const user=req.auth.user?db.prepare('SELECT totp FROM users WHERE id=?').get(req.auth.user) as any:null;
 res.json({...req.auth,workspaces:memberships,has2fa:!!user?.totp,capabilities:capabilities(),smtp:!!process.env.SMTP_HOST});
});
app.post('/api/workspace/switch',requireAuth,(req,res)=>{if(!req.auth.user) fail('Crie uma conta para usar equipes.');const id=z.string().uuid().parse(req.body.id);if(!db.prepare('SELECT 1 FROM members WHERE workspace=? AND user=?').get(id,req.auth.user!)) fail('Workspace não encontrado.',404);session(res,req.auth.user,id);res.json({ok:true});});
app.post('/api/auth/2fa/setup',requireAuth,async(req,res)=>{
 if(!req.auth.user) fail('Crie uma conta para ativar a autenticação em dois fatores.');
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.user!) as any;
 if(!checkPassword(z.string().parse(req.body.password),user.password)) fail('Senha incorreta.',401);
 const secret=new OTPAuth.Secret({size:20}).base32;
 db.prepare('UPDATE users SET pending_totp=? WHERE id=?').run(encrypt(secret),user.id);
 res.json({secret,qr:await QRCode.toDataURL(totp(secret,user.email).toString())});
});
app.post('/api/auth/2fa/confirm',requireAuth,(req,res)=>{
 if(!req.auth.user) fail('Crie uma conta primeiro.');const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.user!) as any;
 if(!u.pending_totp||totp(decrypt(u.pending_totp),u.email).validate({token:z.string().parse(req.body.code),window:1})===null) fail('Código inválido.');
 db.prepare('UPDATE users SET totp=pending_totp,pending_totp=NULL WHERE id=?').run(u.id);res.json({ok:true});
});
app.post('/api/auth/2fa/disable',requireAuth,(req,res)=>{
 const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.user||'') as any;
 if(!u||!checkPassword(z.string().parse(req.body.password),u.password)||!u.totp||totp(decrypt(u.totp),u.email).validate({token:z.string().parse(req.body.code),window:1})===null) fail('Senha ou código inválidos.');
 db.prepare('UPDATE users SET totp=NULL WHERE id=?').run(u.id);res.json({ok:true});
});
app.get('/api/state',requireAuth,(req,res)=>{
 if(serverless){recoverJobs();claimInteraction(req.auth.workspace);}
 const w=req.auth.workspace,config=settings(w),allEvents=(db.prepare('SELECT * FROM events WHERE workspace=? ORDER BY created DESC LIMIT 500').all(w) as any[]).map(e=>({...e,data:JSON.parse(e.data)}));
 const financialTotals=db.prepare("SELECT COALESCE(SUM(json_extract(data,'$.amount')),0) as revenue,COUNT(*) as donations FROM events WHERE workspace=? AND kind='donation' AND json_extract(data,'$.confirmed')=1 AND (?=1 OR is_test=0)").get(w,+req.auth.demo) as any;
 const members=db.prepare('SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user WHERE m.workspace=?').all(w);
 res.json({demoMetrics:req.auth.demo?list(w,'demo-metrics')[0]:undefined,runtime:{polling:serverless,uploads:cloudStorageConfigured()?'signed':'local',maxUploadBytes:cloudStorageConfigured()?cloudMediaLimit:512*1024*1024},settings:config,accounts:list(w,'account').map(publicAccount),integrations:list(w,'integration').map(publicAccount),rules:list(w,'rule'),publications:list(w,'publication'),media:list(w,'media'),artworks:list(w,'artwork'),templates:list(w,'template'),lives:list(w,'live'),quiz:list(w,'quiz')[0]||null,scores:list(w,'score'),events:allEvents,jobs:jobs(w),audit:db.prepare('SELECT * FROM audit WHERE workspace=? ORDER BY created DESC LIMIT 50').all(w),members,
  stats:{revenue:financialTotals.revenue,donations:financialTotals.donations,interactions:jobs(w).filter(j=>j.type==='interaction'&&j.state==='completed').length,blocked:allEvents.filter(e=>e.data.status==='blocked').length},capabilities:capabilities()});
});
const ruleSchema=z.object({name:z.string().trim().min(1).max(80),trigger:z.enum(['donation','chat','follow']),minAmount:z.number().min(0).max(100000),action:z.enum(['speak','sound','alert','animation','scene','quiz']),speech:z.string().max(500),voice:z.string().max(100).default('pt-BR'),cooldown:z.number().min(0).max(3600),duration:z.number().min(3).max(15).default(6),enabled:z.boolean(),priority:z.number().int().min(0).max(100),command:z.string().max(50).default(''),stack:z.boolean().default(false),scene:z.enum(['Principal','Quiz','Intervalo']).default('Quiz'),platform:z.enum(['all','livepix','youtube','tiktok','kwai']).default('all'),startTime:z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^$/).default(''),endTime:z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^$/).default('')});
app.post('/api/rules',requireAuth,mutate,(req,res)=>{const r=put(req.auth.workspace,'rule',ruleSchema.parse(req.body));log(req.auth.workspace,'Automação criada: '+r.name);res.status(201).json(r);});
app.put('/api/rules/:id',requireAuth,mutate,(req,res)=>{if(!get(req.auth.workspace,'rule',String(req.params.id))) fail('Automação não encontrada.',404);res.json(put(req.auth.workspace,'rule',ruleSchema.parse(req.body),String(req.params.id)));});
app.delete('/api/rules/:id',requireAuth,mutate,(req,res)=>{remove(req.auth.workspace,'rule',String(req.params.id));res.json({ok:true});});
app.post('/api/events/test',requireAuth,mutate,rateLimit({windowMs:60000,limit:60,message:{error:'Limite de eventos de teste atingido. Aguarde um minuto.'}}),(req,res)=>{
 const v=z.object({kind:z.enum(['donation','chat','follow']),user:z.string().min(1).max(60),message:z.string().max(1000),amount:z.number().int().min(0).max(10000000),confirmed:z.boolean().default(true),ruleId:z.string().uuid().optional()}).parse(req.body);
 const result=ingest(req.auth.workspace,{...v,provider:'simulator',externalId:randomUUID(),isTest:true});res.json(result);
});
app.post('/api/jobs/:id/:action',requireAuth,(req,res)=>{
 const action=z.enum(['approve','cancel','pause','resume','repeat','complete-manual']).parse(req.params.action),id=String(req.params.id);
 const row=db.prepare('SELECT * FROM jobs WHERE id=? AND workspace=?').get(id,req.auth.workspace) as any;if(!row) fail('Tarefa não encontrada.',404);
 if(req.auth.role==='moderator'&&!['approve','cancel','pause'].includes(action)) fail('Ação não permitida ao moderador.',403);
 const data=JSON.parse(row.data);let state=row.state;
 if(action==='approve'&&state==='awaiting_approval') state='queued';
 else if(action==='cancel'&&['queued','running','paused','awaiting_approval','awaiting_manual','needs_review'].includes(state)) state='cancelled';
 else if(action==='pause'&&state==='queued') state='paused';
 else if(action==='resume'&&state==='paused') state='queued';
 else if(action==='repeat'&&row.type==='interaction'&&['completed','expired','cancelled'].includes(state)) { enqueue(req.auth.workspace,'interaction',{...data,isTest:true},Date.now());log(req.auth.workspace,'Repetição manual de interação (teste).');return res.json({ok:true}); }
 else if(action==='complete-manual'&&row.type==='publication'&&['awaiting_manual','needs_review'].includes(state)) { const url=z.url().parse(req.body.url);if(new URL(url).protocol!=='https:') fail('Use um link HTTPS.');data.manualUrl=url;state='manually_confirmed'; }
 else fail('Esta ação não é válida para o estado atual.');
 db.prepare('UPDATE jobs SET state=?,data=?,updated=? WHERE id=? AND workspace=?').run(state,JSON.stringify(data),Date.now(),id,req.auth.workspace);log(req.auth.workspace,`Tarefa ${action}: ${data.name||'publicação'}.`);res.json({ok:true});
});
const settingsSchema=z.object({goal:z.number().int().min(100).max(100000000),goalName:z.string().min(1).max(80),blockedWords:z.array(z.string().max(60)).max(200),blockLinks:z.boolean(),maxLength:z.number().int().min(20).max(500),manualApproval:z.boolean(),paused:z.boolean(),emergency:z.boolean(),scene:z.enum(['Principal','Quiz','Intervalo']),timezone:z.string().refine(s=>{try{new Intl.DateTimeFormat('pt-BR',{timeZone:s});return true;}catch{return false;}},'Fuso inválido'),retentionDays:z.number().int().min(7).max(365),character:z.enum(['darkbot','nova','pulse','custom']).default('darkbot'),characterArtworkId:z.string().uuid().nullable().default(null),overlayColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a251ff'),overlayPosition:z.enum(['top-left','top-right','bottom-left']).default('top-left'),rankingVisible:z.boolean().default(false),countdownAt:z.iso.datetime().nullable().default(null)});
app.patch('/api/settings',requireAuth,mutate,(req,res)=>{const w=req.auth.workspace,current=settings(w);const values=settingsSchema.parse({...current,...req.body});if(values.characterArtworkId&&!get(w,'artwork',values.characterArtworkId)) fail('Imagem de personagem não encontrada.');const result=put(w,'settings',values,current.id);if(values.emergency) db.prepare("UPDATE jobs SET state='cancelled', updated=? WHERE workspace=? AND type='interaction' AND state IN ('queued','running','paused','awaiting_approval')").run(Date.now(),w);log(w,'Configurações atualizadas.');res.json(result);});
app.post('/api/overlay/rotate',requireAuth,mutate,(req,res)=>{const w=req.auth.workspace;for(const response of overlayStreams.get(settings(w).overlayToken)||[]) response.end();res.json(put(w,'settings',{overlayToken:randomBytes(40).toString('hex')},settings(w).id));});
const ruleForToken=(token:string)=>{
 const row=db.prepare("SELECT workspace,data FROM objects WHERE kind='settings' AND json_extract(data,'$.overlayToken')=?").get(token) as any;
 if(!row) fail('Link do overlay inválido ou revogado.',404);return {workspace:row.workspace,config:JSON.parse(row.data)};
};
app.get('/api/overlay/:token/state',(req,res)=>{const {workspace,config}=ruleForToken(String(req.params.token));if(serverless){recoverJobs();claimInteraction(workspace);}const current=jobs(workspace).find(j=>j.type==='interaction'&&j.state==='running');const w=db.prepare('SELECT demo FROM workspaces WHERE id=?').get(workspace) as any;
 const events=(db.prepare("SELECT data FROM events WHERE workspace=? AND kind='donation' AND json_extract(data,'$.confirmed')=1 AND (?=1 OR is_test=0)").all(workspace,w.demo) as any[]).map(e=>JSON.parse(e.data));
 const ranking:Record<string,number>={};for(const e of events)ranking[e.user]=(ranking[e.user]||0)+e.amount;
 res.json({polling:serverless,scene:config.scene,emergency:config.emergency,goal:config.goal,goalName:config.goalName,revenue:events.reduce((s,e)=>s+e.amount,0),character:config.character,characterArtworkId:config.characterArtworkId,overlayColor:config.overlayColor,overlayPosition:config.overlayPosition,countdownAt:config.countdownAt,ranking:config.rankingVisible?Object.entries(ranking).sort((a,b)=>b[1]-a[1]).slice(0,5):[],current,quiz:list(workspace,'quiz')[0]||null});});
function claim(workspace:string,req:Request,res:Response) {
 const v=z.object({id:z.string().uuid(),consumer:z.string().uuid()}).parse(req.body);
 const result=db.prepare("UPDATE jobs SET claimed_by=? WHERE id=? AND workspace=? AND state='running' AND type='interaction' AND claimed_by IS NULL").run(v.consumer,v.id,workspace);
 if(!result.changes) fail('Ação já assumida por outro consumidor.',409);res.json({ok:true});
}
function ack(workspace:string,req:Request,res:Response) {
 const v=z.object({id:z.string().uuid(),consumer:z.string().uuid()}).parse(req.body);
 db.prepare("UPDATE jobs SET state='completed',updated=? WHERE id=? AND workspace=? AND state='running' AND type='interaction' AND claimed_by=?").run(Date.now(),v.id,workspace,v.consumer);res.json({ok:true});
}
app.post('/api/overlay/:token/claim',(req,res)=>{const {workspace}=ruleForToken(String(req.params.token));claim(workspace,req,res);});
app.post('/api/overlay/:token/ack',(req,res)=>{const {workspace}=ruleForToken(String(req.params.token));ack(workspace,req,res);});
app.post('/api/player/claim',requireAuth,(req,res)=>claim(req.auth.workspace,req,res));
app.post('/api/player/ack',requireAuth,(req,res)=>ack(req.auth.workspace,req,res));

const streams=new Map<string,Set<Response>>();
const overlayStreams=new Map<string,Set<Response>>();
export function broadcast(workspace:string,event='update',data:any={}) {for(const response of streams.get(workspace)||[]) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
function stream(workspace:string,req:Request,res:Response,token?:string) {res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('event: ready\ndata: {}\n\n');const set=streams.get(workspace)||new Set<Response>();set.add(res);streams.set(workspace,set);if(token){const group=overlayStreams.get(token)||new Set<Response>();group.add(res);overlayStreams.set(token,group);}const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(timer);set.delete(res);if(token){const group=overlayStreams.get(token);group?.delete(res);if(!group?.size)overlayStreams.delete(token);}if(!set.size) streams.delete(workspace);});}
app.get('/api/stream',requireAuth,(req,res)=>serverless?res.status(409).json({error:'Use as atualizações periódicas deste ambiente.'}):stream(req.auth.workspace,req,res));
app.get('/api/overlay/:token/stream',(req,res)=>{if(serverless)return res.status(409).json({error:'Use as atualizações periódicas deste ambiente.'});const {workspace}=ruleForToken(String(req.params.token));stream(workspace,req,res,String(req.params.token));});
export function hasConsumer(workspace:string) {return !!streams.get(workspace)?.size;}
const upload=multer({dest:path.join(dataDir,'media'),limits:{fileSize:512*1024*1024,files:1},fileFilter:(_req,file,cb)=>{if(['video/mp4','video/webm','video/quicktime'].includes(file.mimetype)) cb(null,true);else cb(Object.assign(new Error('Envie um vídeo MP4, MOV ou WebM.'),{status:400}));}});
app.post('/api/media',requireAuth,mutate,(_req,_res,next)=>{if(serverless)fail('Use o envio direto ao armazenamento privado nesta versão.',409);next();},upload.single('video'),async(req,res)=>{
 if(!req.file) fail('Selecione um vídeo.');
 const file=req.file!;
 try {
  const details=await probeVideo(file.path);
  const media=put(req.auth.workspace,'media',{name:file.originalname.slice(0,160),filename:file.filename,size:file.size,...details,created:Date.now()});log(req.auth.workspace,'Vídeo adicionado à biblioteca.');res.status(201).json(media);
 } catch(e:any) {unlinkSync(file.path);if(e.status)throw e;if(e.code==='ENOENT')fail('A verificação de vídeo precisa do ffprobe instalado no servidor.',503);fail('O arquivo não contém um vídeo válido e não foi armazenado.',400);}
});
app.get('/api/media/:id/file',requireAuth,async(req,res)=>{const file=get(req.auth.workspace,'media',String(req.params.id));if(!file) fail('Vídeo não encontrado.',404);if(file!.storage==='supabase')return res.redirect(await signedDownload(file!.objectKey));res.type(file!.mime).sendFile(path.resolve(dataDir,'media',file!.filename));});
app.delete('/api/media/:id',requireAuth,mutate,async(req,res)=>{const w=req.auth.workspace,id=String(req.params.id),media=get(w,'media',id);if(!media) fail('Vídeo não encontrado.',404);if(list(w,'publication').some(p=>p.mediaId===id&&!['cancelled','draft'].includes(p.status))) fail('Este vídeo está em uma publicação. Cancele-a antes de excluir.',409);if(media!.storage==='supabase')await deleteCloudFile(media!.objectKey);const file=path.join(dataDir,'media',media!.filename);if(existsSync(file)) unlinkSync(file);remove(w,'media',id);res.json({ok:true});});
const artworkUpload=multer({dest:path.join(dataDir,'media'),limits:{fileSize:10*1024*1024,files:1},fileFilter:(_req,file,cb)=>['image/png','image/jpeg','image/webp'].includes(file.mimetype)?cb(null,true):cb(Object.assign(new Error('Use uma imagem PNG, JPEG ou WebP.'),{status:400}))});
app.post('/api/artworks',requireAuth,mutate,(_req,_res,next)=>{if(serverless)fail('Use o envio direto ao armazenamento privado nesta versão.',409);next();},artworkUpload.single('image'),async(req,res)=>{
 if(!req.file)fail('Selecione uma imagem.');const file=req.file!;
 try{const details=await probeImage(file.path);
 res.status(201).json(put(req.auth.workspace,'artwork',{name:file.originalname.slice(0,120),filename:file.filename,size:file.size,...details}));
 }catch(e:any){unlinkSync(file.path);if(e.status)throw e;fail('Não foi possível validar esta imagem.',400);}
});
app.get('/api/artworks/:id/file',requireAuth,async(req,res)=>{const file=get(req.auth.workspace,'artwork',String(req.params.id));if(!file)fail('Imagem não encontrada.',404);if(file!.storage==='supabase')return res.redirect(await signedDownload(file!.objectKey));res.type(file!.mime).sendFile(path.resolve(dataDir,'media',file!.filename));});
app.get('/api/overlay/:token/artworks/:id',async(req,res)=>{const {workspace}=ruleForToken(String(req.params.token));const file=get(workspace,'artwork',String(req.params.id));if(!file)fail('Imagem não encontrada.',404);if(file!.storage==='supabase')return res.redirect(await signedDownload(file!.objectKey));res.type(file!.mime).sendFile(path.resolve(dataDir,'media',file!.filename));});
const templateSchema=z.object({name:z.string().min(1).max(80),description:z.string().max(5000),hashtags:z.array(z.string().regex(/^[\p{L}\p{N}_]+$/u).max(60)).max(30)});
app.post('/api/templates',requireAuth,mutate,(req,res)=>res.status(201).json(put(req.auth.workspace,'template',templateSchema.parse(req.body))));
app.delete('/api/templates/:id',requireAuth,mutate,(req,res)=>{remove(req.auth.workspace,'template',String(req.params.id));res.json({ok:true});});
const publicationSchema=z.object({title:z.string().trim().min(1).max(100),description:z.string().max(5000),hashtags:z.array(z.string().regex(/^[\p{L}\p{N}_]+$/u).max(60)).max(30),accountIds:z.array(z.string().uuid()).min(1).max(20),scheduleAt:z.iso.datetime(),timezone:z.string().max(60),mediaId:z.string().uuid().nullable(),status:z.enum(['draft','scheduled']),visibility:z.enum(['private','unlisted','public']).default('private'),coverId:z.string().uuid().nullable().default(null),overrides:z.record(z.string().uuid(),z.object({title:z.string().min(1).max(100),description:z.string().max(5000)})).default({})});
function savePublication(req:Request,id?:string) {
 const w=req.auth.workspace,data=publicationSchema.parse(req.body);
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:data.timezone});}catch{fail('Fuso horário inválido.');}
 if(data.status==='scheduled'&&new Date(data.scheduleAt).getTime()<Date.now()-60000) fail('Escolha um horário futuro.');
 for(const a of data.accountIds) if(!get(w,'account',a)) fail('Conta de destino inválida.');
 if(data.coverId){const cover=get(w,'artwork',data.coverId);if(!cover)fail('Capa não encontrada.');if(data.accountIds.some(id=>get(w,'account',id)?.platform==='youtube')&&(!['image/png','image/jpeg'].includes(cover!.mime)||cover!.size>2*1024*1024))fail('Para YouTube, use capa JPEG ou PNG de até 2 MB (limite deste estúdio).');}
 for(const id of Object.keys(data.overrides)) if(!data.accountIds.includes(id))fail('Personalização de conta inválida.');
 if(data.mediaId&&!get(w,'media',data.mediaId)) fail('Vídeo não encontrado.');
 if(!req.auth.demo&&data.status==='scheduled'&&!data.mediaId) fail('Envie um vídeo antes de agendar.');
 if(id&&!get(w,'publication',id)) fail('Publicação não encontrada.',404);
 if(id&&jobs(w).some(j=>j.type==='publication'&&j.data.publicationId===id&&['running','completed','needs_review','manually_confirmed'].includes(j.state))) fail('Esta publicação já foi enviada ou precisa de revisão. Duplique para criar uma nova.',409);
 return transaction(()=>{
  const p=put(w,'publication',{...data,isDemo:req.auth.demo},id);
  if(id) db.prepare("DELETE FROM jobs WHERE workspace=? AND type='publication' AND json_extract(data,'$.publicationId')=?").run(w,id);
  if(data.status==='scheduled') for(const accountId of data.accountIds) enqueue(w,'publication',{publicationId:p.id,accountId,isTest:req.auth.demo},new Date(data.scheduleAt).getTime());
  log(w,data.status==='draft'?'Rascunho salvo.':'Publicação agendada: '+data.title);return p;
 });
}
app.post('/api/publications',requireAuth,mutate,(req,res)=>res.status(201).json(savePublication(req)));
app.put('/api/publications/:id',requireAuth,mutate,(req,res)=>res.json(savePublication(req,String(req.params.id))));
app.delete('/api/publications/:id',requireAuth,mutate,(req,res)=>{const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'publication',id)) fail('Publicação não encontrada.',404);if(jobs(w).some(j=>j.data.publicationId===id&&j.state==='running')) fail('Um envio está em andamento. Aguarde.',409);put(w,'publication',{status:'cancelled'},id);db.prepare("UPDATE jobs SET state='cancelled',updated=? WHERE workspace=? AND type='publication' AND json_extract(data,'$.publicationId')=? AND state NOT IN ('completed','manually_confirmed')").run(Date.now(),w,id);res.json({ok:true});});
app.post('/api/accounts/assisted',requireAuth,mutate,(req,res)=>{const data=z.object({platform:z.enum(['youtube','tiktok','kwai']),name:z.string().min(2).max(60),handle:z.string().min(2).max(80),liveUrl:z.string().max(2048).default('')}).parse(req.body);data.liveUrl=validatePlatformLink(data.platform,data.liveUrl);res.status(201).json(put(req.auth.workspace,'account',{...data,status:'assisted',permissions:['Lembretes'],isDemo:req.auth.demo,connectedAt:Date.now()}));});
app.patch('/api/accounts/:id/live-link',requireAuth,mutate,(req,res)=>{const w=req.auth.workspace,a=get(w,'account',String(req.params.id));if(!a)fail('Conta não encontrada.',404);const value=z.string().max(2048).parse(req.body.liveUrl);res.json(publicAccount(put(w,'account',{liveUrl:validatePlatformLink(a!.platform,value)},a!.id)));});
for(const provider of ['tiktok','livepix'] as const){
 app.get(`/api/connect/${provider}`,requireAuth,mutate,(req,res)=>{if(req.auth.demo)fail('Crie uma conta para autorizar plataformas reais.',409);res.json({url:beginLink(provider,req.auth.workspace,req.auth.user)});});
 app.get(`/api/connect/${provider}/callback`,requireAuth,mutate,async(req,res)=>{if(req.query.error)return res.redirect(origin+'/?page=contas&oauth=denied');await finishLink(provider,req.auth.workspace,req.auth.user,z.string().min(1).max(512).parse(req.query.state),z.string().min(1).max(2048).parse(req.query.code));res.redirect(origin+'/?page=contas&oauth=success');});
}
app.delete('/api/integrations/:id',requireAuth,owner,(req,res)=>{const w=req.auth.workspace,id=String(req.params.id);if(!get(w,'integration',id))fail('Integração não encontrada.',404);remove(w,'integration',id);res.json({ok:true});});
app.get('/api/connect/youtube',requireAuth,mutate,(req,res)=>{if(req.auth.demo) fail('Crie uma conta para autorizar plataformas reais.',409);res.json({url:youtubeStart(req.auth.workspace,req.auth.user)});});
app.get('/api/connect/youtube/callback',requireAuth,async(req,res)=>{if(req.query.error) return res.redirect(origin+'/?page=contas&oauth=denied');await youtubeCallback(req.auth.workspace,req.auth.user,z.string().parse(req.query.state),z.string().parse(req.query.code));res.redirect(origin+'/?page=contas&oauth=success');});
app.delete('/api/accounts/:id',requireAuth,owner,async(req,res)=>{const w=req.auth.workspace,id=String(req.params.id),a=get(w,'account',id);if(!a) fail('Conta não encontrada.',404);await revoke(w,a);remove(w,'account',id);res.json({ok:true});});
app.patch('/api/accounts/:id/chat',requireAuth,mutate,(req,res)=>{const w=req.auth.workspace,id=String(req.params.id),a=get(w,'account',id);if(!a||a.platform!=='youtube'||a.isDemo||!a.tokens) fail('Conecte uma conta YouTube real para ler o chat.',409);res.json(publicAccount(put(w,'account',{chatEnabled:z.boolean().parse(req.body.enabled)},id)));});
app.post('/api/lives',requireAuth,mutate,(req,res)=>{const data=z.object({title:z.string().min(1).max(100)}).parse(req.body);if(list(req.auth.workspace,'live').some(l=>l.status==='preview')) fail('Já existe uma sessão de prévia ativa.',409);res.status(201).json(put(req.auth.workspace,'live',{...data,status:'preview',startedAt:Date.now(),isDemo:req.auth.demo}));});
app.patch('/api/lives/:id',requireAuth,mutate,(req,res)=>{const id=String(req.params.id);if(!get(req.auth.workspace,'live',id)) fail('Sessão não encontrada.',404);res.json(put(req.auth.workspace,'live',{status:z.enum(['preview','ended']).parse(req.body.status)},id));});
app.post('/api/quiz',requireAuth,mutate,(req,res)=>{const data=z.object({question:z.string().min(3).max(140),options:z.array(z.string().min(1).max(60)).length(3),correct:z.number().int().min(0).max(2)}).parse(req.body);const old=list(req.auth.workspace,'quiz')[0];res.json(put(req.auth.workspace,'quiz',{...data,round:randomUUID(),active:true,votes:[0,0,0]},old?.id));});
app.post('/api/quiz/vote',requireAuth,(req,res)=>{const quiz=list(req.auth.workspace,'quiz')[0];if(!quiz?.active) fail('Nenhum quiz ativo.');const option=z.number().int().min(0).max(2).parse(req.body.option);const voter=req.auth.user||req.auth.workspace;const key=`${quiz.round}:${voter}`;if(list(req.auth.workspace,'vote').some(v=>v.key===key)) fail('Você já respondeu a este quiz.');transaction(()=>{put(req.auth.workspace,'vote',{key});quiz.votes[option]++;put(req.auth.workspace,'quiz',quiz,quiz.id);});res.json({correct:option===quiz.correct});});
app.post('/api/team/invite',requireAuth,owner,(req,res)=>{if(req.auth.demo) fail('Crie uma conta para convidar sua equipe.');const v=z.object({email:z.email(),role:z.enum(['operator','moderator'])}).parse(req.body);const token=randomBytes(24).toString('hex');db.prepare('INSERT INTO one_time VALUES(?,?,?,?,?,?)').run(hash(token),req.auth.user,req.auth.workspace,'invite',JSON.stringify(v),Date.now()+7*86400000);res.json({url:origin+'/?invite='+token});});
app.post('/api/team/accept',requireAuth,(req,res)=>{const token=z.string().parse(req.body.token);const r=db.prepare("SELECT * FROM one_time WHERE token=? AND kind='invite' AND expires>?").get(hash(token),Date.now()) as any;if(!r) fail('Convite inválido ou expirado.');const data=JSON.parse(r.data);if(!req.auth.email||req.auth.email.toLowerCase()!==data.email.toLowerCase()) fail('Entre com o e-mail convidado.',403);transaction(()=>{db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)').run(r.workspace,req.auth.user!,data.role);db.prepare('DELETE FROM one_time WHERE token=?').run(hash(token));});res.json({ok:true});});
app.delete('/api/team/:id',requireAuth,owner,(req,res)=>{if(req.params.id===req.auth.user) fail('Você não pode remover a si mesmo.');db.prepare('DELETE FROM members WHERE workspace=? AND user=?').run(req.auth.workspace,String(req.params.id));db.prepare('DELETE FROM sessions WHERE workspace=? AND user=?').run(req.auth.workspace,String(req.params.id));res.json({ok:true});});
app.get('/api/reports/export',requireAuth,(req,res)=>{const rows=(db.prepare('SELECT kind,provider,data,is_test,created FROM events WHERE workspace=? ORDER BY created DESC').all(req.auth.workspace) as any[]).map(e=>{const d=JSON.parse(e.data);return [new Date(e.created).toISOString(),e.kind,e.provider,(d.amount||0)/100,d.status,e.is_test?'teste':'real'];});res.type('text/csv').attachment('00-do-dark-eventos.csv').send('\uFEFF'+[['Data','Tipo','Origem','Valor BRL','Status','Ambiente'],...rows].map(r=>r.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(';')).join('\r\n'));});
app.use('/api',(req,res)=>res.status(404).json({error:'Recurso não encontrado.'}));
if(!serverless&&existsSync(path.resolve('dist'))) {app.use(express.static(path.resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));}
app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{if(error instanceof z.ZodError) return res.status(400).json({error:'Confira os campos informados.',details:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)});if(error instanceof multer.MulterError) return res.status(400).json({error:error.code==='LIMIT_FILE_SIZE'?'O vídeo deve ter no máximo 512 MB.':'Erro ao receber o arquivo.'});const status=error.status||500;if(status===500) console.error(JSON.stringify({level:'error',code:error.code||'INTERNAL',name:error.name,time:new Date().toISOString()}));res.status(status).json({error:status===500?'Não foi possível concluir a operação. Tente novamente.':error.message});});
