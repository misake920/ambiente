import {prepareVercel,validateBackendURL} from './vercel-config.ts';
import {deployDirectory,getProject} from './vercel-upload.ts';
async function main(){
 await prepareVercel();
 const project=getProject(),backend=validateBackendURL(process.env.BACKEND_URL);
 const health=await (await fetch(backend.origin+'/api/health',{signal:AbortSignal.timeout(15000)})).json();
 if(!health.publicOrigin||!project.domains.includes(new URL(health.publicOrigin).hostname))throw new Error('Configure APP_ORIGIN do backend para o domínio do projeto Vercel antes de publicar.');
 await deployDirectory('dist','application');
 const origin=new URL(health.publicOrigin).origin;
 const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(20000)}),result=await response.json();
 if(!response.ok||result.status!=='ok'||result.database!==true)throw new Error('Deploy criado, mas o proxy da API não passou na verificação.');
 console.log('Vercel READY e API validada: '+origin);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
