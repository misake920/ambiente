import {lazy,Suspense} from 'react';
import {Box,MessageSquare,Radio} from 'lucide-react';
import {emptyModelState,evolveModel,type LiveModel,type ModelState,type ModelAction} from '../../shared/live-models';
import {money} from '../api';
const Scene3D=lazy(()=>import('./Scene3D'));
export default function ModelStage({model,state=emptyModelState(),reaction,thumbnail=false,preview=false,output=false,onReady}:{model:LiveModel;state?:ModelState;reaction?:ModelAction|null;thumbnail?:boolean;preview?:boolean;output?:boolean;onReady?:(ok:boolean)=>void}){
 const shown=!preview&&reaction?.isTest?evolveModel(state,reaction,model.goal):state;
 const goal=Math.max(1,model.goal),fuel=Math.min(100,(shown.points%goal)/goal*100);
 const caption=model.scene==='rocket'?`${shown.launches} decolagens`:model.scene==='arena'?`Roxo ${shown.purple} × ${shown.green} Verde`:model.scene==='tower'?`${shown.objects} blocos adicionados`:model.scene==='garden'?`${shown.objects} flores plantadas`:model.scene==='orbit'?`${shown.objects} estrelas criadas`:`${shown.interactions} interações`;
 return <div className={'model-stage scene-'+model.scene+(thumbnail?' model-thumbnail':'')+(output?' model-output':'')} style={{'--model-color':model.color,'--model-accent':model.accent} as React.CSSProperties}>
  <Suspense fallback={<div className="model-loading"><Box size={24}/>Carregando cenário 3D…</div>}><Scene3D model={model} state={shown} reaction={reaction} animate={!thumbnail} onReady={onReady}/></Suspense>
  {!thumbnail&&<><div className="model-hud-top"><span><i/>{preview?'PRÉVIA INTERATIVA':'00 DO DARK · INTERATIVO'}</span><strong>{model.name}</strong><small>{preview?'SIMULAÇÃO · '+caption:reaction?.isTest?'TESTE · '+caption:caption}</small></div>
  {model.scene==='arena'&&<div className="model-team-scores"><span>ROXO <b>{shown.purple}</b></span><span>VERDE <b>{shown.green}</b></span></div>}
  {reaction&&<div className="model-reaction" key={reaction.id}><Radio size={15}/><strong>{reaction.user}</strong><span>{reaction.isTest?'TESTE':'INTERAGIU'}</span></div>}
  <div className="model-hud-bottom">{model.scene==='rocket'&&<div className="model-fuel"><span>Combustível da comunidade <b>{Math.round(fuel)}%</b></span><div><i style={{width:fuel+'%'}}/></div></div>}
   <div className="model-command-hints"><MessageSquare size={13}/>{model.commands.map(c=><span key={c.command}>{c.command}</span>)}</div>
   <div className="model-pix-hints">{model.tiers.map(t=><span key={t.minCents}><b>{money(t.minCents)}+</b> {t.label}</span>)}</div>
  </div></>}
 </div>;
}
