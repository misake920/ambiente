import { randomBytes, createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { db, get, put, log, dataDir } from './db.ts';
import { decrypt, encrypt, hash } from './security.ts';
import { origin } from './config.ts';
import { ingest } from './engine.ts';
import {linkConfigured,revokeTikTok} from './oauth-links.ts';
import {materialize} from './cloud-storage.ts';
import {serverless} from './runtime.ts';

export const capabilities = () => [
 { id:'youtube', name:'YouTube', oauth:!!process.env.YOUTUBE_CLIENT_ID && !!process.env.YOUTUBE_CLIENT_SECRET, publishing:true, chat:true, transmission:false, description:'OAuth oficial, upload de vídeos e leitura do chat de uma live ativa. Requer projeto Google e consentimento aprovado.', docs:'https://developers.google.com/youtube/v3' },
 { id:'tiktok', name:'TikTok', oauth:linkConfigured('tiktok'), linking:true, publishing:false, chat:false, transmission:false, description:'Vinculação oficial por link com Login Kit. Autoriza a identidade da conta; chat e transmissão LIVE exigem acesso próprio e não são liberados por esse login. Publicação direta exige aprovação separada.', docs:'https://developers.tiktok.com/doc/login-kit-web' },
 { id:'kwai', name:'Kwai', oauth:false, publishing:false, chat:false, transmission:false, description:'Fluxo assistido disponível. Acesso parceiro e documentação aplicável precisam ser confirmados antes de habilitar automação.', docs:'https://www.kwai.com/' },
 { id:'livepix', name:'LivePix', oauth:linkConfigured('livepix'), linking:true, publishing:false, chat:false, transmission:false, payments:false, description:'Vinculação de identidade por OAuth oficial disponível quando o aplicativo é configurado. Recebimento real de pagamentos ainda não está habilitado.', docs:'https://docs.livepix.gg/api' },
];
export function youtubeStart(workspace: string, user: string | null) {
 if (!capabilities()[0].oauth) throw Object.assign(new Error('Configure YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no servidor para conectar sua conta.'),{status:409});
 const state = randomBytes(32).toString('hex'), verifier=randomBytes(48).toString('base64url');
 db.prepare('INSERT INTO one_time VALUES(?,?,?,?,?,?)').run(hash(state),user,workspace,'oauth',JSON.stringify({verifier}),Date.now()+600000);
 const params = new URLSearchParams({client_id:process.env.YOUTUBE_CLIENT_ID!,redirect_uri:origin+'/api/connect/youtube/callback',response_type:'code',scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',state,access_type:'offline',prompt:'consent',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 return 'https://accounts.google.com/o/oauth2/v2/auth?'+params;
}
async function checked(url: string, init: RequestInit = {}) {
 const r=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});
 if (!r.ok) { const e:any=new Error(r.status===401 ? 'Autorização expirada. Reconecte a conta.' : `A plataforma respondeu HTTP ${r.status}.`);e.status=r.status===401?409:502;e.remoteStatus=r.status;throw e; }
 return r;
}
export async function youtubeCallback(workspace:string,user:string|null,state:string,code:string) {
 const record=db.prepare("SELECT * FROM one_time WHERE token=? AND workspace=? AND kind='oauth' AND expires>?").get(hash(state),workspace,Date.now()) as any;
 if(!record || record.user!==user) throw Object.assign(new Error('Autorização inválida ou expirada.'),{status:400});
 db.prepare('DELETE FROM one_time WHERE token=?').run(hash(state));
 const tokens=await (await checked('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:process.env.YOUTUBE_CLIENT_ID!,client_secret:process.env.YOUTUBE_CLIENT_SECRET!,code,code_verifier:JSON.parse(record.data).verifier,grant_type:'authorization_code',redirect_uri:origin+'/api/connect/youtube/callback'})})).json();
 const result=await (await checked('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:`Bearer ${tokens.access_token}`}})).json();
 if(!result.items?.length) throw new Error('Nenhum canal do YouTube encontrado.');
 const {list}=await import('./db.ts');
 for(const item of result.items) {
  const previous=list(workspace,'account').find(a=>a.platform==='youtube'&&a.externalId===item.id&&!a.isDemo);
  put(workspace,'account',{platform:'youtube',externalId:item.id,name:item.snippet.title,handle:item.snippet.customUrl||item.id,status:'connected',permissions:['Leitura','Publicações'],isDemo:false,tokens:encrypt(JSON.stringify({...tokens,expires_at:Date.now()+tokens.expires_in*1000})),connectedAt:Date.now()},previous?.id);
 }
 log(workspace,'Conta YouTube autorizada por OAuth.');
}
export async function youtubeToken(workspace:string, account:any) {
 const tokens=JSON.parse(decrypt(account.tokens));
 if(tokens.expires_at>Date.now()+60000) return tokens.access_token as string;
 try {
  const refreshed=await (await checked('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:process.env.YOUTUBE_CLIENT_ID!,client_secret:process.env.YOUTUBE_CLIENT_SECRET!,refresh_token:tokens.refresh_token||'',grant_type:'refresh_token'})})).json();
  put(workspace,'account',{tokens:encrypt(JSON.stringify({...tokens,...refreshed,expires_at:Date.now()+refreshed.expires_in*1000})),status:'connected'},account.id);
  return refreshed.access_token as string;
 } catch(e) { put(workspace,'account',{status:'expired'},account.id);throw e; }
}
export async function revoke(workspace:string,account:any) {
 if(account.platform==='tiktok')await revokeTikTok(account);
 if(account.tokens && account.platform==='youtube') { const token=JSON.parse(decrypt(account.tokens));await checked('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token:token.refresh_token||token.access_token})}); }
}
export async function publishYouTube(workspace:string,account:any,publication:any,jobId:string) {
 const media=get(workspace,'media',publication.mediaId);
 if(!media) throw new Error('Vídeo não encontrado.');
 const token=await youtubeToken(workspace,account);
 const local=await materialize(media),file=local.filename;
 try{
 const init=await checked('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Length':String(statSync(file).size),'X-Upload-Content-Type':media.mime},body:JSON.stringify({snippet:{title:publication.title,description:publication.description+'\n'+publication.hashtags.map((t:string)=>'#'+t).join(' '),tags:publication.hashtags,categoryId:'22'},status:{privacyStatus:publication.visibility||'private',selfDeclaredMadeForKids:false}})});
 const location=init.headers.get('location');
 if(!location || !['www.googleapis.com','youtube.googleapis.com'].includes(new URL(location).hostname)) throw new Error('Sessão de upload não recebida.');
 const job=db.prepare('SELECT data FROM jobs WHERE id=? AND workspace=?').get(jobId,workspace) as any;
 db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(job.data),uploadSession:encrypt(location)}),jobId);
 // No automatic retry after bytes are sent: uncertain outcomes must be reconciled manually.
 const uploaded=await fetch(location,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':media.mime,'Content-Length':String(statSync(file).size)},body:createReadStream(file) as any,duplex:'half',signal:AbortSignal.timeout(serverless?180000:600000)} as any);
 if(!uploaded.ok) throw new Error(`Upload respondeu HTTP ${uploaded.status}. Verifique o YouTube Studio antes de repetir.`);
 const video=await uploaded.json(); if(!video.id) throw new Error('YouTube não confirmou o identificador do vídeo.');
 const remote={remoteId:video.id,url:`https://www.youtube.com/watch?v=${video.id}`};
 db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(job.data),...remote}),jobId);
 let coverWarning:string|undefined;
 if(publication.coverId){const artwork=get(workspace,'artwork',publication.coverId);if(artwork){let cover;try{cover=await materialize(artwork);const r=await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+encodeURIComponent(video.id),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':artwork.mime},body:createReadStream(cover.filename) as any,duplex:'half',signal:AbortSignal.timeout(serverless?10000:30000)} as any);if(!r.ok)coverWarning=`Vídeo enviado, mas a capa respondeu HTTP ${r.status}. Verifique elegibilidade da conta para miniaturas personalizadas.`;}catch{coverWarning='Vídeo enviado. Não foi possível confirmar a capa personalizada.';}finally{await cover?.cleanup();}}}
 return {...remote,coverWarning};
 }finally{await local.cleanup();}
}
export async function pollYouTube(workspace:string,account:any) {
 const token=await youtubeToken(workspace,account);
 let chatId=account.liveChatId;
 if(!chatId) {
  const b=await (await checked('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all',{headers:{Authorization:`Bearer ${token}`}})).json();
  chatId=b.items?.find((i:any)=>i.snippet?.liveChatId)?.snippet.liveChatId;
  if(!chatId) return {next:60000};
 }
 const params=new URLSearchParams({liveChatId:chatId,part:'snippet,authorDetails',maxResults:'200'});if(account.chatPage) params.set('pageToken',account.chatPage);
 const response=await (await checked('https://www.googleapis.com/youtube/v3/liveChat/messages?'+params,{headers:{Authorization:`Bearer ${token}`}})).json();
 for(const message of response.items||[]) ingest(workspace,{externalId:message.id,provider:'youtube',kind:'chat',user:message.authorDetails?.displayName||'Participante',message:message.snippet?.displayMessage||'',amount:0,confirmed:true,isTest:false});
 put(workspace,'account',{liveChatId:chatId,chatPage:response.nextPageToken},account.id);
 return {next:Math.max(10000,response.pollingIntervalMillis||10000)};
}
