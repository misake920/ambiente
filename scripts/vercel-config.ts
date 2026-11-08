import {existsSync,writeFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';
export function validateBackendURL(value:string|undefined):URL {
 if(!value)throw new Error('BACKEND_URL não configurado para o modo de API externa. Para Vercel + Supabase, use npm run deploy:supabase. Consulte docs/deployment.md.');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('BACKEND_URL deve ser uma origem HTTPS pública, sem senha, caminho ou parâmetros.');
 const host=url.hostname.toLowerCase();
 if(isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host.endsWith('.local')||host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='0.0.0.0'||host.startsWith('10.')||host.startsWith('192.168.')||host.startsWith('169.254.')||host==='[::1]')throw new Error('Use uma hospedagem pública persistente, não localhost ou IP privado.');
 return url;
}
export function vercelConfig(value:string) {
 const origin=validateBackendURL(value).origin;
 return {$schema:'https://openapi.vercel.sh/vercel.json',version:2,framework:null,headers:[
  {source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'CDN-Cache-Control',value:'no-store'},{key:'Vercel-CDN-Cache-Control',value:'no-store'}]},
  {source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Frame-Options',value:'SAMEORIGIN'}]},
 ],rewrites:[{source:'/api/:path*',destination:origin+'/api/:path*'},{source:'/media/:path*',destination:origin+'/media/:path*'},{source:'/:path*',destination:'/index.html'}]};
}
export async function prepareVercel(){
 if(existsSync('.env'))process.loadEnvFile('.env');
 const url=validateBackendURL(process.env.BACKEND_URL);
 const response=await fetch(url.origin+'/api/health',{signal:AbortSignal.timeout(15000)});
 const health=await response.json();
 if(!response.ok||health.status!=='ok'||health.database!==true)throw new Error('O backend não confirmou a disponibilidade do banco de dados.');
 if(!existsSync('dist/index.html'))throw new Error('Execute npm run build antes de preparar o deploy.');
 const config=vercelConfig(url.origin);writeFileSync('dist/vercel.json',JSON.stringify(config,null,2)+'\n');
 console.log('Build e API verificados. Configuração da Vercel gerada em dist/vercel.json.');return config;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareVercel().catch(e=>{console.error(e.message);process.exitCode=1;});
