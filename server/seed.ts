import {put,settings} from './db.ts';
/** Only editable configuration is created. Activity always comes from events. */
export function initialWorkspace(id:string,demo=false){
 const config=settings(id);
 put(id,'rule',{name:'Alerta de doação',trigger:'donation',minAmount:10,action:'speak',speech:'Obrigado pela doação, {usuario}. {mensagem}',voice:'pt-BR',cooldown:30,duration:6,enabled:true,priority:20,command:'',stack:false});
 put(id,'rule',{name:'Leitura de chat',trigger:'chat',minAmount:0,action:'speak',speech:'{usuario}: {mensagem}',voice:'pt-BR',cooldown:10,duration:6,enabled:true,priority:1,command:'!fala',stack:false});
 if(demo)put(id,'settings',{paused:true},config.id);
}
