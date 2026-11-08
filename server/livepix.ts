import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {db,list,put,log} from './db.ts';
import {encrypt,decrypt,hash} from './security.ts';
import {ingest} from './engine.ts';
import {origin} from './config.ts';
import {oauthConfig} from './connector-config.ts';
const scope='account:read messages:read payments:read webhooks';
async function remote(url:string,init:RequestInit={}){
 const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Object.assign(new Error(r.status===401?'Autorização LivePix expirada. Reconecte a integração.':r.status===403?'A aplicação LivePix não autorizou os escopos de leitura necessários.':'LivePix indisponível (HTTP '+r.status+').'),{remoteStatus:r.status,status:502});
 if(r.status===204)return {};
 return r.json();
}
const tokenSchema=z.object({access_token:z.string().min(1),expires_in:z.number().positive().max(31536000),refresh_token:z.string().optional(),scope:z.string().optional()}).passthrough();
async function clientToken(clientId:string,clientSecret:string){
 const request=(permissions:string)=>remote('https://oauth.livepix.gg/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:permissions})});
 try{return tokenSchema.parse(await request(scope));}catch(error:any){
  if(![400,403].includes(error.remoteStatus))throw error;
  // Notification permission is optional; read permissions remain mandatory.
  return tokenSchema.parse(await request('account:read messages:read payments:read'));
 }
}
const headers=(token:string)=>({Authorization:'Bearer '+token});
export async function connectLivePix(workspace:string,clientId:string,clientSecret:string){
 const tokens=await clientToken(clientId,clientSecret);
 const profile=await remote('https://api.livepix.gg/v2/account',{headers:headers(tokens.access_token)});
 const account=z.object({id:z.string().min(1).max(128),displayName:z.string().min(1).max(100),username:z.string().min(1).max(100)}).parse(profile.data);
 // Confirm access to the financial API before claiming that payments are enabled.
 const [probe,messageProbe]=await Promise.all([remote('https://api.livepix.gg/v2/payments?limit=1&page=1&currency=BRL',{headers:headers(tokens.access_token)}),remote('https://api.livepix.gg/v2/messages?limit=1&page=1&currency=BRL',{headers:headers(tokens.access_token)})]);
 if(!Array.isArray(probe.data)||!Array.isArray(messageProbe.data))throw new Error('A LivePix não retornou uma lista de pagamentos válida.');
 const previous=list(workspace,'integration').find(a=>a.platform==='livepix'&&a.externalId===account.id);
 const saved=put(workspace,'integration',{platform:'livepix',externalId:account.id,name:account.displayName,handle:'@'+account.username,status:'connected',paymentsEnabled:true,authorization:'client_credentials',permissions:['Leitura de pagamentos','Leitura de mensagens'],credentials:encrypt(JSON.stringify({clientId,clientSecret})),tokens:encrypt(JSON.stringify({...tokens,expires_at:Date.now()+tokens.expires_in*1000})),connectedAt:previous?.connectedAt||Date.now(),lastError:null,lastSyncAt:null},previous?.id);
 await configureWebhook(workspace,saved,tokens.access_token);
 log(workspace,'LivePix conectada. O acesso à consulta de pagamentos foi verificado.');return list(workspace,'integration').find(a=>a.id===saved.id)!;
}
async function configureWebhook(workspace:string,integration:any,token:string){
 if(!origin.startsWith('https://'))return;
 try{
  if(integration.webhookId)await remote('https://api.livepix.gg/v2/webhooks/'+encodeURIComponent(integration.webhookId),{method:'DELETE',headers:headers(token)});
  const secret=randomBytes(32).toString('hex');
  const response=await remote('https://api.livepix.gg/v2/webhooks',{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({url:origin+'/api/hooks/livepix/'+secret})});
  if(!response.data?.id)throw new Error('Webhook não confirmado.');
  put(workspace,'integration',{webhookHash:hash(secret),webhookId:response.data.id,delivery:'webhook'},integration.id);
 }catch{put(workspace,'integration',{delivery:'polling',webhookHash:null,webhookId:null},integration.id);}
}
async function accessToken(workspace:string,integration:any){
 const token=JSON.parse(decrypt(integration.tokens));if(token.expires_at>Date.now()+60000)return token.access_token;
 let next;
 if(integration.credentials){const c=JSON.parse(decrypt(integration.credentials));next=await clientToken(c.clientId,c.clientSecret);}
 else{next=tokenSchema.parse(await remote('https://oauth.livepix.gg/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refresh_token||'',client_id:oauthConfig('livepix',workspace).clientId,client_secret:oauthConfig('livepix',workspace).clientSecret})}));}
 put(workspace,'integration',{tokens:encrypt(JSON.stringify({...token,...next,expires_at:Date.now()+next.expires_in*1000})),status:'connected'},integration.id);return next.access_token;
}
async function pages(path:string,token:string){
 const rows:any[]=[];
 for(let page=1;page<=5;page++){
  const data=await remote('https://api.livepix.gg/v2/'+path+'?currency=BRL&limit=100&page='+page,{headers:headers(token)});
  if(!Array.isArray(data.data))throw new Error('Resposta LivePix inválida.');
  rows.push(...data.data);
  if(data.data.length<100)break;
 }
 return rows;
}
const payment=z.object({id:z.string().min(1).max(128),amount:z.number().int().positive().max(100000000),currency:z.literal('BRL'),createdAt:z.string().refine(v=>Number.isFinite(Date.parse(v))),proof:z.string().optional(),reference:z.string().optional()});
export async function pollLivePix(workspace:string,integration:any){
 const token=await accessToken(workspace,integration),after=integration.connectedAt;
 const [payments,messages]=await Promise.all([pages('payments',token),pages('messages',token)]);
 const byProof=new Map<string,any>();
 for(const message of messages)for(const key of [message.proof,message.reference])if(typeof key==='string'&&key)byProof.set(key,message);
 let received=0;
 for(const raw of payments.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))){
  const parsed=payment.safeParse(raw);if(!parsed.success)continue;const p=parsed.data;if(Date.parse(p.createdAt)<after)continue;
  const message=byProof.get(p.proof||'')||byProof.get(p.reference||'');
  const fee=message?.coverFees===true&&Number.isSafeInteger(message.fee)&&message.fee>=0&&message.fee<p.amount?message.fee:0;
  const result=ingest(workspace,{externalId:integration.externalId+':'+p.id,provider:'livepix',kind:'donation',user:typeof message?.username==='string'?message.username.slice(0,60):'Apoiador anônimo',message:typeof message?.message==='string'?message.message.slice(0,1000):'',amount:p.amount-fee,confirmed:true,isTest:false,receivedAt:Date.parse(p.createdAt),blockedReason:message?.flagged?'Mensagem sinalizada pela moderação LivePix.':undefined});
  if(!result.duplicate)received++;
 }
 put(workspace,'integration',{lastSyncAt:Date.now(),lastError:null,status:'connected'},integration.id);
 return {received,next:10000};
}
export async function disconnectLivePix(workspace:string,integration:any){
 let remoteWebhookRemoved=true;
 if(integration.webhookId)try{const token=await accessToken(workspace,integration);await remote('https://api.livepix.gg/v2/webhooks/'+encodeURIComponent(integration.webhookId),{method:'DELETE',headers:headers(token)});}catch{remoteWebhookRemoved=false;}
 db.prepare('DELETE FROM objects WHERE workspace=? AND kind=? AND id=?').run(workspace,'integration',integration.id);
 return {remoteWebhookRemoved};
}
