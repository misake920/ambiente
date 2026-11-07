import {visualPreview} from './deployment-mode';
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
 if(visualPreview)return (await import('./visual-preview')).previewAPI<T>(path,options);
 const response=await fetch('/api'+path,{credentials:'include',...options,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});
 const value=await response.json().catch(()=>({error:'O servidor não respondeu como esperado.'}));
 if(!response.ok) throw new Error(value.error||'Não foi possível concluir a operação.');return value;
}
export const post=(path:string,body:any={})=>api(path,{method:'POST',body:JSON.stringify(body)});
export const patch=(path:string,body:any)=>api(path,{method:'PATCH',body:JSON.stringify(body)});
export const put=(path:string,body:any)=>api(path,{method:'PUT',body:JSON.stringify(body)});
export const del=(path:string)=>api(path,{method:'DELETE'});
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const shortDate=(value:string|number)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'America/Fortaleza'}).format(new Date(value));
export const time=(value:string|number)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(value));
export const statusLabels:Record<string,string>={queued:'Na fila',running:'Em execução',completed:'Concluída',cancelled:'Cancelada',paused:'Pausada',awaiting_approval:'Em moderação',awaiting_manual:'Envio assistido',needs_review:'Revisão necessária',failed:'Falhou',expired:'Expirada',scheduled:'Agendada',draft:'Rascunho',manually_confirmed:'Confirmada manualmente',connected:'Conectada',expired_account:'Reconexão necessária',assisted:'Modo assistido'};
