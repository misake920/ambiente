import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {db,list,put,transaction,log} from './db.ts';
import {encrypt,decrypt,hash} from './security.ts';
import {origin} from './config.ts';

export const linkProviders={
 tiktok:{key:'TIKTOK_CLIENT_KEY',secret:'TIKTOK_CLIENT_SECRET',authorize:'https://www.tiktok.com/v2/auth/authorize/',token:'https://open.tiktokapis.com/v2/oauth/token/',scope:'user.info.basic',profile:'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url'},
 livepix:{key:'LIVEPIX_CLIENT_ID',secret:'LIVEPIX_CLIENT_SECRET',authorize:'https://oauth.livepix.gg/oauth2/auth',token:'https://oauth.livepix.gg/oauth2/token',scope:'account:read offline',profile:'https://api.livepix.gg/v2/account'},
} as const;
export type LinkProvider=keyof typeof linkProviders;
export const linkConfigured=(provider:LinkProvider)=>!!process.env[linkProviders[provider].key]&&!!process.env[linkProviders[provider].secret];
export function beginLink(provider:LinkProvider,workspace:string,user:string|null){
 if(!user)throw Object.assign(new Error('Entre em uma conta própria para vincular plataformas.'),{status:409});
 if(!linkConfigured(provider))throw Object.assign(new Error(`Configure ${linkProviders[provider].key} e ${linkProviders[provider].secret} no servidor para gerar o link oficial.`),{status:409});
 const state=randomBytes(32).toString('hex'),p=linkProviders[provider];
 db.prepare('INSERT INTO one_time VALUES(?,?,?,?,?,?)').run(hash(state),user,workspace,'oauth-'+provider,'{}',Date.now()+600000);
 const url=new URL(p.authorize);url.searchParams.set(provider==='tiktok'?'client_key':'client_id',process.env[p.key]!);
 for(const [key,value] of Object.entries({response_type:'code',redirect_uri:origin+`/api/connect/${provider}/callback`,scope:p.scope,state}))url.searchParams.set(key,value);
 return url.href;
}
function consumeState(provider:LinkProvider,workspace:string,user:string|null,state:string){
 return transaction(()=>{
  const record=db.prepare('SELECT * FROM one_time WHERE token=? AND workspace=? AND kind=? AND expires>?').get(hash(state),workspace,'oauth-'+provider,Date.now()) as any;
  if(!record||record.user!==user)throw Object.assign(new Error('Vinculação inválida, expirada ou já utilizada.'),{status:400});
  db.prepare('DELETE FROM one_time WHERE token=? AND workspace=? AND kind=?').run(hash(state),workspace,'oauth-'+provider);
 });
}
async function remoteJSON(url:string,options:RequestInit={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 const body=r.status===204?{}:await r.json().catch(()=>null);
 if(!r.ok||!body||typeof body.error==='string'||body.error?.code&&body.error.code!=='ok')throw Object.assign(new Error('A plataforma não confirmou a vinculação. Confira a aprovação do aplicativo e autorize novamente.'),{status:502});
 return body;
}
const tokensSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),expires_in:z.number().positive().max(31536000),scope:z.string().optional(),open_id:z.string().optional()}).passthrough();
export async function finishLink(provider:LinkProvider,workspace:string,user:string|null,state:string,code:string){
 consumeState(provider,workspace,user,state);
 const p=linkProviders[provider];
 const tokens=tokensSchema.parse(await remoteJSON(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({[provider==='tiktok'?'client_key':'client_id']:process.env[p.key]!,client_secret:process.env[p.secret]!,grant_type:'authorization_code',code,redirect_uri:origin+`/api/connect/${provider}/callback`})}));
 const profile=await remoteJSON(p.profile,{headers:{Authorization:'Bearer '+tokens.access_token}});
 const data=provider==='tiktok'?profile.data?.user:profile.data;
 const id=z.string().min(1).parse(provider==='tiktok'?data?.open_id:data?.id);
 const name=z.string().min(1).max(100).parse(provider==='tiktok'?data?.display_name:data?.displayName);
 if(provider==='tiktok'&&tokens.open_id&&tokens.open_id!==id)throw Object.assign(new Error('A identidade autorizada não corresponde ao token recebido.'),{status:502});
 const kind=provider==='livepix'?'integration':'account';
 const previous=list(workspace,kind).find(a=>a.platform===provider&&a.externalId===id&&!a.isDemo);
 const account=put(workspace,kind,{platform:provider,externalId:id,name,handle:provider==='livepix'?'@'+data.username:'Perfil autorizado',status:'connected',permissions:['Identidade'],authorization:'oauth',chatEnabled:false,isDemo:false,tokens:encrypt(JSON.stringify({...tokens,expires_at:Date.now()+tokens.expires_in*1000})),connectedAt:Date.now()},previous?.id);
 log(workspace,`Identidade ${provider==='tiktok'?'TikTok':'LivePix'} vinculada por OAuth. Acesso LIVE/pagamentos não é presumido.`);
 return account;
}
export async function revokeTikTok(account:any){
 if(account.platform!=='tiktok'||!account.tokens)return;
 const tokens=JSON.parse(decrypt(account.tokens));
 await remoteJSON('https://open.tiktokapis.com/v2/oauth/revoke/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY||'',client_secret:process.env.TIKTOK_CLIENT_SECRET||'',token:tokens.access_token})});
}
export function validatePlatformLink(platform:string,value:string){
 if(!value)return '';
 const url=new URL(value);const host=url.hostname.toLowerCase();
 const root=platform==='youtube'?'youtube.com':platform==='tiktok'?'tiktok.com':platform==='kwai'?'kwai.com':null;
 if(!root||url.protocol!=='https:'||url.username||url.password||url.port||!(host===root||host.endsWith('.'+root)||platform==='youtube'&&host==='youtu.be'))throw Object.assign(new Error('Informe um link HTTPS da própria plataforma, sem senha ou porta.'),{status:400});
 return url.href;
}
