import {useEffect,useId,useState} from 'react';
import {ResponsiveContainer,AreaChart,Area,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';
import {money} from '../api';
import type {Obj,RevenueSeries} from '../types';

export default function RevenueChart({events,days=1,series}:{events:Obj[];demo?:boolean;days?:number;series?:RevenueSeries}){
 const id=useId().replace(/[^a-zA-Z0-9]/g,''),fill='revenue-fill-'+id,glow='revenue-glow-'+id;
 const [reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReducedMotion(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 const now=Date.now(),start=now-days*86400000,buckets=days===1?8:7,span=(now-start)/buckets;
 const points=series?.points||Array.from({length:buckets+1},(_,i)=>{
  const at=start+i*span;
  return {at,amount:events.filter(e=>e.created>=start&&e.created<=at&&e.kind==='donation'&&e.data.confirmed&&!e.is_test).reduce((sum,e)=>sum+Number(e.data.amount),0)};
 });
 const format=new Intl.DateTimeFormat('pt-BR',days===1?{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}:{day:'2-digit',month:'2-digit',timeZone:'America/Fortaleza'});
 const data=points.map(p=>({label:format.format(p.at),value:p.amount/100})),maximum=Math.max(1,...data.map(p=>p.value));
 return <div className="chart neon-revenue-chart" role="img" aria-label={'Gráfico neon da receita confirmada · '+(days===1?'últimas 24 horas':days+' dias')} data-total={series?.total??points.at(-1)?.amount??0}>
  <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:18,right:16,bottom:8,left:0}}>
   <defs>
    <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b42cff" stopOpacity={.65}/><stop offset="65%" stopColor="#9127ee" stopOpacity={.2}/><stop offset="100%" stopColor="#9127ee" stopOpacity={.02}/></linearGradient>
    <filter id={glow} filterUnits="userSpaceOnUse" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
   </defs>
   <CartesianGrid stroke="#694588" strokeOpacity={.32} vertical strokeDasharray="3 5"/>
   <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:'#a896bb',fontSize:10}} minTickGap={25} tickMargin={10}/>
   <YAxis domain={[0,maximum*1.15]} axisLine={false} tickLine={false} tick={{fill:'#a896bb',fontSize:10}} width={70} tickFormatter={v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:maximum<10?2:0}).format(v)}/>
   <Tooltip contentStyle={{background:'#1b1029',border:'1px solid #9854c2',borderRadius:9,fontSize:11,boxShadow:'0 0 24px #a335ed24'}} formatter={(v:any)=>[money(Number(v)*100),'Receita acumulada']} labelStyle={{color:'#d7b8ed'}} cursor={{stroke:'#c27bff',strokeDasharray:'3 4'}}/>
   <Area type="monotone" dataKey="value" stroke="#d184ff" strokeWidth={2.5} strokeLinecap="round" fill={'url(#'+fill+')'} style={{filter:'url(#'+glow+')'}} activeDot={{r:5,stroke:'#f7d9ff',strokeWidth:2,fill:'#b02cf5'}} isAnimationActive={!reducedMotion} animationDuration={850}/>
  </AreaChart></ResponsiveContainer>
 </div>;
}
