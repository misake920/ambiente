export const sceneKinds=['bot','rocket','arena','tower','garden','orbit'] as const;
export type SceneKind=typeof sceneKinds[number];
export const sceneActions={
 bot:{jump:'Pular',dance:'Dançar',spin:'Girar'},rocket:{boost:'Dar impulso',launch:'Decolar',spin:'Girar'},
 arena:{purple:'Ponto roxo',green:'Ponto verde',celebrate:'Comemorar'},tower:{build:'Construir blocos',spin:'Girar',celebrate:'Acender torre'},
 garden:{plant:'Plantar flores',water:'Regar',bloom:'Florescer'},orbit:{star:'Criar estrelas',spin:'Girar órbita',nova:'Supernova'},
} as const;
export type ModelTier={minCents:number;label:string;action:string;units:number};
export type ModelCommand={command:string;action:string;units:number};
export type LiveModel={id:string;name:string;description:string;scene:SceneKind;color:string;accent:string;orientation:'portrait'|'landscape';goal:number;cooldown:number;tiers:ModelTier[];commands:ModelCommand[];builtin?:boolean};
export type ModelAction={action:string;units:number;user:string;isTest:boolean;id:string;at:number};
export type ModelState={interactions:number;points:number;objects:number;purple:number;green:number;launches:number;lastAction:ModelAction|null};
export const emptyModelState=():ModelState=>({interactions:0,points:0,objects:0,purple:0,green:0,launches:0,lastAction:null});
export function evolveModel(state:ModelState,action:ModelAction,goal:number):ModelState{
 const next={...state,interactions:state.interactions+1,points:state.points+action.units,lastAction:action};
 if(['build','plant','star'].includes(action.action))next.objects+=action.units;
 if(action.action==='purple')next.purple+=action.units;
 if(action.action==='green')next.green+=action.units;
 if(action.action==='launch')next.launches++;
 else if(action.action==='boost')next.launches+=Math.floor(next.points/goal)-Math.floor(state.points/goal);
 return next;
}
const model=(id:string,name:string,description:string,scene:SceneKind,color:string,accent:string,actions:string[],commands:string[]):LiveModel=>({
 id,name,description,scene,color,accent,orientation:'portrait',goal:100,cooldown:10,builtin:true,
 tiers:[{minCents:1,label:'Um Pix, uma reação',action:actions[0],units:1},{minCents:500,label:'Interação especial',action:actions[1],units:5},{minCents:2000,label:'Momento épico',action:actions[2],units:20}],
 commands:commands.map((command,i)=>({command,action:scene==='arena'&&i===1?'green':actions[i],units:1})),
});
export const builtinModels:LiveModel[]=[
 model('dark-bot','Dark Bot ao vivo','Um mascote 3D que pula, dança e gira com a sua comunidade.','bot','#a83fff','#f16ed4',['jump','dance','spin'],['!pular','!dancar','!girar']),
 model('community-rocket','Foguete da comunidade','Transforme cada apoio em combustível para a próxima decolagem.','rocket','#8756ff','#46daff',['boost','boost','launch'],['!impulso','!turbo','!decolar']),
 model('neon-arena','Batalha neon','Roxo ou verde? O chat e os Pix movimentam a disputa entre equipes.','arena','#ae4dff','#5af0a4',['purple','purple','celebrate'],['!roxo','!verde','!festa']),
 model('pix-tower','Torre do Pix','Construa uma cidade de blocos iluminados, um apoio de cada vez.','tower','#b45bff','#ffbf68',['build','build','celebrate'],['!construir','!bloco','!festa']),
 model('community-garden','Jardim da comunidade','Plante, regue e faça florescer um pequeno mundo em 3D.','garden','#c46eff','#64e5b0',['plant','water','bloom'],['!plantar','!regar','!florir']),
 model('gift-orbit','Órbita dos presentes','Uma galáxia que ganha estrelas e supernovas a cada interação.','orbit','#9f52ff','#74d9ff',['star','spin','nova'],['!estrela','!orbita','!supernova']),
];
export const sceneNames:Record<SceneKind,string>={bot:'Personagem 3D',rocket:'Foguete 3D',arena:'Batalha 3D',tower:'Construção 3D',garden:'Jardim 3D',orbit:'Galáxia 3D'};
export function getModelActions(scene:SceneKind):Record<string,string>{return sceneActions[scene];}
