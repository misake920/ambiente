import type {Express,RequestHandler} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db,get,put,remove,transaction,log,acquireLease,releaseLease} from './db.ts';
import {cloudStorageConfigured,signedUpload,materialize,deleteCloudFile} from './cloud-storage.ts';
import {cloudMediaLimit,cloudStorageBudget} from './runtime.ts';
import {probeVideo,probeImage} from './media-validation.ts';
const metadata=z.object({kind:z.enum(['media','artwork']),name:z.string().min(1).max(160),mime:z.enum(['video/mp4','video/webm','video/quicktime','image/png','image/jpeg','image/webp']),size:z.number().int().positive().max(cloudMediaLimit)});
export function registerCloudUploads(app:Express,requireAuth:RequestHandler,mutate:RequestHandler){
 app.post('/api/uploads/prepare',requireAuth,mutate,async(req,res)=>{
  if(!cloudStorageConfigured())throw Object.assign(new Error('Armazenamento persistente ainda não configurado.'),{status:503});
  const value=metadata.parse(req.body);
  if((value.kind==='media')!==value.mime.startsWith('video/')||value.kind==='artwork'&&value.size>10*1024*1024)throw Object.assign(new Error('Tipo ou tamanho de arquivo inválido.'),{status:400});
  const id=randomUUID(),objectKey=req.auth.workspace+'/'+id;
  transaction(()=>{
   const used=db.prepare("SELECT COALESCE(SUM(CAST(json_extract(data,'$.size') AS BIGINT)),0) AS used FROM objects WHERE kind IN ('media','artwork','upload')").get().used;
   if(used+value.size>cloudStorageBudget)throw Object.assign(new Error('O armazenamento gratuito está próximo do limite. Exclua arquivos para continuar.'),{status:409});
   put(req.auth.workspace,'upload',{...value,objectKey,expires:Date.now()+3*3600000},id);
  });
  try{res.status(201).json({id,...await signedUpload(objectKey)});}catch(error){remove(req.auth.workspace,'upload',id);throw error;}
 });
 app.post('/api/uploads/complete',requireAuth,mutate,async(req,res)=>{
  const id=z.string().uuid().parse(req.body.id),w=req.auth.workspace,pending=get(w,'upload',id);
  if(!pending||pending.expires<Date.now())throw Object.assign(new Error('Envio não encontrado ou expirado.'),{status:404});
  const lease=acquireLease('upload:'+id,180000);if(!lease)throw Object.assign(new Error('Este envio já está sendo verificado.'),{status:409});
  let file;
  try{
   file=await materialize({...pending,storage:'supabase'});
   const details=pending.kind==='media'?await probeVideo(file.filename):await probeImage(file.filename);
   const result=transaction(()=>{
    if(!get(w,'upload',id))throw Object.assign(new Error('Este envio já foi finalizado.'),{status:409});
    remove(w,'upload',id);
    const value=put(w,pending.kind,{name:pending.name,filename:id,storage:'supabase',objectKey:pending.objectKey,size:pending.size,...details,created:Date.now()},id);return value;
   });
   log(w,'Arquivo validado e salvo no armazenamento privado.');res.status(201).json(result);
  }catch(error:any){
   // Do not delete a file already finalized by another concurrent request.
   if(get(w,'upload',id)){await deleteCloudFile(pending.objectKey).catch(()=>{});remove(w,'upload',id);}
   if(error.status)throw error;throw Object.assign(new Error('O arquivo não pôde ser validado e não foi adicionado à biblioteca.'),{status:400});
  }finally{await file?.cleanup();releaseLease('upload:'+id,lease);}
 });
 app.delete('/api/uploads/:id',requireAuth,mutate,async(req,res)=>{
  const id=String(req.params.id),pending=get(req.auth.workspace,'upload',id);
  if(pending){await deleteCloudFile(pending.objectKey).catch(()=>{});remove(req.auth.workspace,'upload',id);}res.json({ok:true});
 });
}
