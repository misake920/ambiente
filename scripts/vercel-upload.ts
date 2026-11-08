import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
export type Project={projectId:string;orgId:string;projectName:string;domains:string[]};
export function getProject():Project{return JSON.parse(readFileSync('.vercel/project.json','utf8'));}
export async function deployDirectory(directory:string,mode:'visual-preview'|'application'|'backend-setup',settings?:Record<string,unknown>){
 if(!process.env.VERCEL_TOKEN)throw new Error('Conecte a conta Vercel no ambiente seguro.');
 const project=getProject(),query=project.orgId.startsWith('team_')?'?teamId='+encodeURIComponent(project.orgId):'';
 const request=async(route:string,init:RequestInit={})=>{
  const r=await fetch('https://api.vercel.com'+route+query,{...init,headers:{Authorization:'Bearer '+process.env.VERCEL_TOKEN,...init.headers},signal:AbortSignal.timeout(60000)});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(`Vercel HTTP ${r.status}: ${d.error?.code||'operação não confirmada'}`);}return r;
 };
 const files:{file:string;sha:string;size:number}[]=[];
 async function upload(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const filename=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Links simbólicos não são incluídos no deploy.');
  if(entry.isDirectory()){await upload(filename);continue;}
  const bytes=readFileSync(filename),sha=createHash('sha1').update(bytes).digest('hex');
  await request('/v2/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'x-now-digest':sha,'x-now-size':String(bytes.length)},body:bytes});
  files.push({file:path.relative(directory,filename).split(path.sep).join('/'),sha,size:bytes.length});
 }}
 await upload(directory);console.log(`${files.length} arquivos enviados à Vercel.`);
 const deployment=await (await request('/v13/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:project.projectName,project:project.projectId,target:'production',files,meta:{darkDeploymentMode:mode},projectSettings:settings||{framework:null,buildCommand:null,installCommand:null,outputDirectory:null}})})).json();
 if(!deployment.id||!deployment.url)throw new Error('A Vercel não confirmou o identificador do deploy.');
 const saved={id:deployment.id,url:deployment.url,mode};writeFileSync('.vercel/deployment.json',JSON.stringify(saved,null,2));
 console.log(`Deploy ${deployment.id} enviado; aguardando READY...`);
 for(let i=0;i<120;i++){
  const current=await (await request('/v13/deployments/'+encodeURIComponent(deployment.id))).json();
  if(current.readyState==='READY')return {...saved,project};
  if(['ERROR','CANCELED'].includes(current.readyState))throw new Error('Deploy não concluído: '+current.readyState);
  if(i%6===0)console.log('Estado Vercel: '+current.readyState);
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error('A Vercel ainda não confirmou READY; consulte .vercel/deployment.json.');
}
