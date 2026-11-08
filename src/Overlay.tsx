import { useEffect, useMemo, useState } from 'react';
import { Volume2, VolumeX, Radio, Coffee, Heart, Sparkles } from 'lucide-react';
import Countdown from './components/Countdown';
import { api, money } from './api';
import type { Obj } from './types';
import { usePlayer } from './components/Player';
import ModelStage from './live-models/ModelStage';
import type {ModelAction} from '../shared/live-models';
export default function Overlay({token}:{token:string}) {
 const [state,setState]=useState<any>(null),[job,setJob]=useState<Obj|null>(null),[action,setAction]=useState<Obj|null>(null),[audio,setAudio]=useState(new URLSearchParams(location.search).get('audio')==='1'),[error,setError]=useState(''),[modelReadyFor,setModelReadyFor]=useState<string|null>(null);
 useEffect(()=>{
  document.body.classList.add('overlay-body');document.documentElement.classList.add('overlay-document');let disposed=false,pending=false;
  const load=async()=>{if(pending)return;pending=true;try{const s=await api('/overlay/'+token+'/state');if(!disposed){setError('');setState(s);setJob(s.current||null);}}catch(e:any){if(!disposed)setError(e.message);}finally{pending=false;}};
  void load();const timer=setInterval(()=>void load(),2500);
  return()=>{disposed=true;clearInterval(timer);document.body.classList.remove('overlay-body');document.documentElement.classList.remove('overlay-document');};
 },[token]);

 usePlayer(state?.emergency?null:job,audio,token,setAction,!!state?.liveModel&&state.scene==='Principal'&&modelReadyFor===state.liveModel.id);
 const reaction=useMemo<ModelAction|null>(()=>action?.data.action==='model'?{id:action.id,action:action.data.modelAction,units:action.data.units,user:action.data.user,isTest:!!action.data.isTest,at:Date.now()}:null,[action?.id]);
 useEffect(()=>{if(state?.emergency){setAction(null);window.speechSynthesis?.cancel();}},[state?.emergency]);
 if(error)return <div className="overlay-error"><Radio size={30}/><h2>Overlay indisponível</h2><p>{error}</p></div>;
 if(!state)return null;
 return <div className={'obs-overlay '+(action?'is-reacting':'')}>{new URLSearchParams(location.search).get('controls')==='1'&&<button className="overlay-audio" onClick={()=>setAudio(v=>!v)}>{audio?<Volume2 size={17}/>:<VolumeX size={17}/>}Áudio {audio?'ativado':'desativado'}</button>}{!state.emergency&&<>{state.liveModel&&state.scene==='Principal'&&<ModelStage key={state.liveModel.id} model={state.liveModel.model} state={state.liveModel.modelState} reaction={reaction} output onReady={ok=>setModelReadyFor(ok?state.liveModel.id:null)}/>}<Countdown at={state.countdownAt}/>{state.scene==='Intervalo'?<div className="obs-interval"><Coffee size={60}/><h1>Já voltamos.</h1><p>Seu universo continua aqui.</p></div>:state.characterVisible&&<div className="obs-bot"><img src={state.character==='custom'&&state.characterArtworkId?`/api/overlay/${token}/artworks/${state.characterArtworkId}`:'/assets/darkbot-reference.png'} style={{filter:`hue-rotate(${state.character==='nova'?'-40deg':state.character==='pulse'?'25deg':'0deg'})`,objectFit:state.character==='custom'?'contain':'cover'}} alt="Personagem do overlay"/><span className="obs-caption">{action?.data.speech||'00 do Dark'}</span></div>}{state.scene==='Quiz'&&state.quiz&&<div className="obs-quiz"><Sparkles size={30}/><h2>{state.quiz.question}</h2>{state.quiz.options.map((o:string,i:number)=><div key={i}><b>!{i+1}</b>{o}<span>{state.quiz.votes[i]} votos</span></div>)}</div>}{state.goalEnabled&&<div className="obs-goal"><strong>{state.goalName}</strong><div className="progress"><i style={{width:Math.min(100,state.revenue/state.goal*100)+'%',background:state.overlayColor}}/></div><span>{money(state.revenue)} / {money(state.goal)}</span></div>}{state.ranking?.length>0&&<div className="obs-ranking"><strong>QUEM FAZ ACONTECER</strong>{state.ranking.map(([name,value]:[string,number],i:number)=><div key={name}><b>{i+1}</b>{name}<span>{money(value)}</span></div>)}</div>}{action?.data.action==='animation'&&<div className="celebration-particles">{Array.from({length:20},(_,i)=><i key={i} style={{left:i*5+'%',animationDelay:(i%5)*.13+'s'}}/>)}</div>}{action&&<div className={'obs-alert alert-position-'+(state.overlayPosition||'top-left')} style={{borderColor:state.overlayColor}}><Heart size={38} fill="currentColor"/><div><strong>{action.data.user}{action.data.amount?' enviou '+money(action.data.amount):' participou'}</strong><p>{action.data.message}</p>{action.data.isTest&&<small>EVENTO DE TESTE</small>}</div></div>}</>}</div>
}
