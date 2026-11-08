import {list,put} from './db.ts';
import {encrypt,decrypt} from './security.ts';
export type OAuthProvider='youtube'|'tiktok'|'livepix';
const names={youtube:['YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET'],tiktok:['TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET'],livepix:['LIVEPIX_CLIENT_ID','LIVEPIX_CLIENT_SECRET']} as const;
export function oauthConfig(provider:OAuthProvider,workspace?:string){
 const own=workspace?list(workspace,'connector-config').find(c=>c.provider===provider):undefined;
 return own?{clientId:own.clientId,clientSecret:decrypt(own.secret)}:{clientId:process.env[names[provider][0]]||'',clientSecret:process.env[names[provider][1]]||''};
}
export function hasOAuth(provider:OAuthProvider,workspace?:string){const c=oauthConfig(provider,workspace);return !!c.clientId&&!!c.clientSecret;}
export function saveOAuth(provider:OAuthProvider,workspace:string,clientId:string,secret:string){
 const current=list(workspace,'connector-config').find(c=>c.provider===provider);
 put(workspace,'connector-config',{provider,clientId,secret:encrypt(secret)},current?.id);
}
