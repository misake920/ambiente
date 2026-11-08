import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Export only a newly generated demo, never an existing workspace or database.
const directory=mkdtempSync(path.join(tmpdir(),'dark-preview-'));
process.env.DATA_DIR=directory;process.env.NODE_ENV='test';process.env.DEMO_ENABLED='true';process.env.POSTGRES_URL='';process.env.VERCEL='0';process.env.DARK_SERVERLESS='0';
for(const key of ['YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET','TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET','LIVEPIX_CLIENT_ID','LIVEPIX_CLIENT_SECRET','SMTP_HOST','SMTP_PASSWORD','ENCRYPTION_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY','VITE_PUBLIC_SUPABASE_URL','VITE_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'])process.env[key]='';
const {app}=await import('../server/app.ts');
const {db}=await import('../server/db.ts');
const server=app.listen(0,'127.0.0.1');
try{
 await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Não foi possível gerar os dados de demonstração.');
 const origin='http://127.0.0.1:'+address.port;
 const auth=await fetch(origin+'/api/auth/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!auth.ok)throw new Error('Demonstração não criada.');
 const cookie=auth.headers.getSetCookie().map(v=>v.split(';')[0]).join(';');
 const read=async(route:string)=>{const r=await fetch(origin+'/api/'+route,{headers:{Cookie:cookie}});if(!r.ok)throw new Error('Não foi possível exportar a demonstração.');return r.json();};
 const me=await read('me'),state=await read('state');
 if(!me.demo||me.user!==null||state.media.length||state.artworks.length)throw new Error('Somente demonstração vazia pode ser exportada.');
 state.settings.overlayToken='visual-preview-unavailable';
 me.smtp=false;
 execFileSync('node',['node_modules/vite/bin/vite.js','build','--outDir','dist-preview'],{env:{...process.env,VITE_VISUAL_PREVIEW:'true'},stdio:'inherit'});
 writeFileSync('dist-preview/visual-preview.json',JSON.stringify({visualPreview:true,me,state}));
 const index=readFileSync('dist-preview/index.html','utf8');
 writeFileSync('dist-preview/index.html',index.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>'));
 writeFileSync('dist-preview/vercel.json',JSON.stringify({version:2,framework:null,headers:[{source:'/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'}]},{source:'/visual-preview.json',headers:[{key:'Cache-Control',value:'no-store'}]}],rewrites:[{source:'/:path*',destination:'/index.html'}]},null,2)+'\n');
 console.log('Prévia visual gerada em dist-preview; nenhuma API real está habilitada.');
}finally{
 await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(directory,{recursive:true,force:true});
}
