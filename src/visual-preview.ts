import type {Me,State} from './types';
type Snapshot={me:Me;state:State;visualPreview:true};
let snapshot:Promise<Snapshot>|undefined;
const unavailable='Prévia visual: esta ação depende do backend, que ainda não foi hospedado. Nenhum dado foi enviado ou salvo.';
export async function previewAPI<T=unknown>(path:string,options:RequestInit={}):Promise<T>{
 const method=(options.method||'GET').toUpperCase();
 if(method==='POST'&&path==='/auth/demo')return {ok:true} as T;
 if(method!=='GET'||!['/me','/state'].includes(path))throw new Error(unavailable);
 snapshot??=fetch('/visual-preview.json',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('A prévia visual não pôde ser carregada.');const value=await r.json();if(value.visualPreview!==true)throw new Error('Arquivo de prévia inválido.');return value;});
 const data=await snapshot;
 return structuredClone(path==='/me'?data.me:data.state) as T;
}
