import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {serverless} from './runtime.ts';
const binary=()=>process.env.FFPROBE_BIN||(serverless?path.join(process.cwd(),'node_modules/ffprobe-static/bin/linux/x64/ffprobe'):'ffprobe');
export async function probeVideo(filename:string){
 const {stdout}=await promisify(execFile)(binary(),['-v','error','-show_format','-show_streams','-of','json',filename],{timeout:20000,maxBuffer:1048576});
 const probe=JSON.parse(stdout),video=probe.streams?.find((s:any)=>s.codec_type==='video'),duration=Number(probe.format?.duration);
 if(!video||!Number.isFinite(duration)||duration<=0||!/(mp4|mov|webm|matroska)/.test(probe.format?.format_name||''))throw Object.assign(new Error('O arquivo não contém um vídeo válido.'),{status:400});
 return {mime:/(webm|matroska)/.test(probe.format.format_name)?'video/webm':'video/mp4',duration,width:video.width,height:video.height};
}
export async function probeImage(filename:string){
 const {stdout}=await promisify(execFile)(binary(),['-v','error','-show_streams','-of','json',filename],{timeout:10000,maxBuffer:1048576});const stream=JSON.parse(stdout).streams?.[0];
 if(!stream||!['png','mjpeg','webp'].includes(stream.codec_name)||stream.width*stream.height>16000000)throw Object.assign(new Error('Imagem inválida ou maior que 16 megapixels.'),{status:400});
 return {mime:stream.codec_name==='png'?'image/png':stream.codec_name==='webp'?'image/webp':'image/jpeg',width:stream.width,height:stream.height};
}
