import {visualPreview} from './deployment-mode';
let signedUploads=false,maxUploadBytes=512*1024*1024;
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
 if(visualPreview)return (await import('./visual-preview')).previewAPI<T>(path,options);
 if(signedUploads&&options.body instanceof FormData&&['/media','/artworks'].includes(path)){
  const file=options.body.get(path==='/media'?'video':'image');if(!(file instanceof File))throw new Error('Selecione um arquivo.');const limit=path==='/artworks'?10*1024*1024:maxUploadBytes;if(file.size>limit)throw new Error('O arquivo deve ter no máximo '+Math.round(limit/1048576)+' MB.');
  const upload=await api('/uploads/prepare',{method:'POST',body:JSON.stringify({kind:path==='/media'?'media':'artwork',name:file.name,mime:file.type,size:file.size})});
  try{
   const response=await fetch(upload.url,{method:'PUT',headers:{...upload.headers,'Content-Type':file.type},body:file});
   if(!response.ok)throw new Error('O armazenamento não confirmou o envio. Verifique o limite do arquivo e tente novamente.');
   return await api<T>('/uploads/complete',{method:'POST',body:JSON.stringify({id:upload.id})});
  }catch(error){await api('/uploads/'+upload.id,{method:'DELETE'}).catch(()=>{});throw error;}
 }
 const response=await fetch('/api'+path,{credentials:'include',...options,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});
 const value=await response.json().catch(()=>({error:'O servidor não respondeu como esperado.'}));
 if(!response.ok) throw Object.assign(new Error(value.error||'Não foi possível concluir a operação.'),{status:response.status});if(value.runtime){signedUploads=value.runtime.uploads==='signed';maxUploadBytes=value.runtime.maxUploadBytes;}return value;
}
export const post=(path:string,body:any={})=>api(path,{method:'POST',body:JSON.stringify(body)});
export const patch=(path:string,body:any)=>api(path,{method:'PATCH',body:JSON.stringify(body)});
export const put=(path:string,body:any)=>api(path,{method:'PUT',body:JSON.stringify(body)});
export const del=(path:string)=>api(path,{method:'DELETE'});
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const shortDate=(value:string|number)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'America/Fortaleza'}).format(new Date(value));
export const time=(value:string|number)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(value));
export const statusLabels:Record<string,string>={queued:'Na fila',running:'Em execução',completed:'Concluída',cancelled:'Cancelada',paused:'Pausada',awaiting_approval:'Em moderação',awaiting_manual:'Envio assistido',needs_review:'Revisão necessária',failed:'Falhou',expired:'Expirada',scheduled:'Agendada',draft:'Rascunho',manually_confirmed:'Confirmada manualmente',connected:'Conectada',expired_account:'Reconexão necessária',assisted:'Modo assistido'};
