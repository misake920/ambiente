import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
export const cloudBundle='.vercel/cloud-bundle';
export const cloudSettings={framework:null,buildCommand:'',installCommand:'npm ci --omit=dev --no-audit --no-fund',outputDirectory:'dist'};
export function packageCloud(preview:boolean){
 const directory=preview?'dist-preview':'dist';
 if(!existsSync(directory+'/index.html'))throw new Error('Execute o build da interface antes de empacotar.');
 rmSync(cloudBundle,{recursive:true,force:true});mkdirSync(cloudBundle,{recursive:true});
 execFileSync('node',['node_modules/typescript/bin/tsc','-p','tsconfig.serverless.json'],{stdio:'inherit'});
 cpSync('server/postgres-worker.js',cloudBundle+'/server/postgres-worker.js');
 cpSync(directory,cloudBundle+'/dist',{recursive:true});
 const pkg=JSON.parse(readFileSync('package.json','utf8'));pkg.scripts={};pkg.engines.node='24.x';
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'));lock.packages[''].engines.node='24.x';
 writeFileSync(cloudBundle+'/package.json',JSON.stringify(pkg,null,2));writeFileSync(cloudBundle+'/package-lock.json',JSON.stringify(lock,null,2));
 writeFileSync(cloudBundle+'/vercel.json',JSON.stringify({version:2,framework:null,regions:['iad1'],functions:{'api/index.js':{maxDuration:300,includeFiles:'{server/postgres-worker.js,node_modules/ffprobe-static/bin/linux/x64/ffprobe}',excludeFiles:'node_modules/ffprobe-static/bin/{darwin,win32,linux/ia32,linux/arm64}/**'}},headers:[{source:'/api/:path*',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'CDN-Cache-Control',value:'no-store'},{key:'Vercel-CDN-Cache-Control',value:'no-store'}]},{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'}]}],rewrites:[{source:'/api/:path*',destination:'/api'},{source:'/:path*',destination:'/index.html'}]},null,2));
 console.log('Interface e API compiladas para Node 24. Banco e segredos não foram incluídos no pacote.');return cloudBundle;
}
