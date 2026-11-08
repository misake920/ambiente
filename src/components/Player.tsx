import {useEffect,useRef} from 'react';
import type {Obj} from '../types';
import {post} from '../api';
export function usePlayer(job:Obj|null,audio:boolean,token:string|null,onActive:(v:Obj|null)=>void){
 const consumer=useRef(crypto.randomUUID()),seen=useRef(new Set<string>()),enabled=useRef(audio),sound=useRef<AudioContext|null>(null);enabled.current=audio;
 const stopSound=()=>{const value=sound.current;sound.current=null;if(value&&value.state!=='closed')void value.close().catch(()=>{});};
 useEffect(()=>{
  if(!job||seen.current.has(job.id))return;seen.current.add(job.id);
  let cancelled=false,finished=false,timer:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setTimeout>|undefined;
  const base=token?'/overlay/'+token:'/player';
  const finish=(error?:string)=>{if(cancelled||finished)return;finished=true;if(timer)clearTimeout(timer);if(watchdog)clearTimeout(watchdog);window.speechSynthesis?.cancel();stopSound();onActive(null);void post(base+'/ack',{id:job.id,consumer:consumer.current,error}).catch(()=>{});};
  void post(base+'/claim',{id:job.id,consumer:consumer.current}).then(()=>{
   if(cancelled)return;onActive(job);const began=Date.now(),duration=Math.max(3000,job.data.duration*1000);
   const afterMinimum=(error?:string)=>{timer=setTimeout(()=>finish(error),Math.max(0,duration-(Date.now()-began)));};
   if(job.data.action==='speak'&&enabled.current){
    if(!('speechSynthesis'in window)){afterMinimum('Síntese de voz indisponível neste navegador.');return;}
    const utterance=new SpeechSynthesisUtterance(job.data.speech);utterance.lang='pt-BR';const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');if(voice)utterance.voice=voice;
    utterance.onend=()=>afterMinimum();utterance.onerror=()=>afterMinimum('Não foi possível reproduzir a voz. Confira o áudio e as vozes instaladas no navegador/OBS.');
    watchdog=setTimeout(()=>finish('A leitura não foi concluída pelo navegador.'),90000);window.speechSynthesis.speak(utterance);return;
   }
   if(job.data.action==='sound'&&enabled.current){
    try{const context=new AudioContext();sound.current=context;void context.resume();[523.25,659.25,783.99].forEach((frequency,i)=>{const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.12,context.currentTime+i*.12+.01);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+i*.12+.35);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(context.currentTime+i*.12);oscillator.stop(context.currentTime+i*.12+.4);});}catch{afterMinimum('O navegador não liberou a reprodução de áudio.');return;}
   }
   afterMinimum();
  }).catch(()=>{});
  return()=>{cancelled=true;if(timer)clearTimeout(timer);if(watchdog)clearTimeout(watchdog);window.speechSynthesis?.cancel();stopSound();onActive(null);};
 },[job?.id,token]);
 useEffect(()=>{if(!audio){stopSound();window.speechSynthesis?.cancel();}},[audio]);
}
