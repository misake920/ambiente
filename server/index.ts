import './config.ts';
import { app } from './app.ts';
import { startWorker } from './worker.ts';
import {db} from './db.ts';
import {maintenance} from './maintenance.ts';
const port=Number(process.env.PORT||3001);
const server=app.listen(port,'0.0.0.0',()=>console.log(`00 do Dark API • porta ${port}`));
const stop=startWorker();
const cleanup=setInterval(()=>void maintenance().catch(()=>console.error('{"level":"error","code":"MAINTENANCE"}')),3600000);
function shutdown(){stop();clearInterval(cleanup);server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
