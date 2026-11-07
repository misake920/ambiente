import {existsSync,readFileSync} from 'node:fs';
import {deployDirectory} from './vercel-upload.ts';
try{
 if(!existsSync('dist-preview/visual-preview.json'))throw new Error('Execute npm run build:preview antes de publicar a prévia.');
 const snapshot=JSON.parse(readFileSync('dist-preview/visual-preview.json','utf8'));
 if(snapshot.visualPreview!==true||snapshot.me?.demo!==true||snapshot.me?.user!==null)throw new Error('O pacote deve conter apenas dados simulados.');
 const result=await deployDirectory('dist-preview','visual-preview');
 const origin='https://'+result.project.domains[0];
 const r=await fetch(origin+'/visual-preview.json',{signal:AbortSignal.timeout(20000)});
 const fixture=await r.json();if(!r.ok||fixture.visualPreview!==true)throw new Error('Deploy READY, mas o domínio público não confirmou a prévia.');
 console.log('Prévia visual publicada: '+origin);
}catch(e:any){console.error(e.message);process.exitCode=1;}
