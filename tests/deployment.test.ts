import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackendURL,vercelConfig} from '../scripts/vercel-config.ts';
test('deployment rejects missing, local and credential-bearing backend origins',()=>{
 for(const input of [undefined,'http://api.example.com','https://localhost','https://10.0.0.1','https://172.16.0.1','https://[::1]','https://user:password@api.example.com','https://api.example.com/path','https://api.example.com/?token=secret'])assert.throws(()=>validateBackendURL(input));
});
test('Vercel routes keep authenticated API traffic out of shared caches',()=>{
 const config=vercelConfig('https://api.example.com');
 assert.equal(config.rewrites[0].source,'/api/:path*');assert.equal(config.rewrites[0].destination,'https://api.example.com/api/:path*');assert.equal(config.rewrites.at(-1)?.destination,'/index.html');
 const headers=config.headers.find(h=>h.source==='/api/:path*')!.headers;
 assert(headers.some(h=>h.key==='Vercel-CDN-Cache-Control'&&h.value==='no-store'));
});
