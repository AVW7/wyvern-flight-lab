import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),folder=resolve(root,'assets/harvest-candidates/2026-10-07/runtime-authored-normals-096');
const paths={'/':resolve(root,'tools/blender/corrective_gpu_probe.html'),'/model/base':resolve(root,'public/models/wyvern-v2-rig.glb'),'/model/candidate':resolve(folder,'wyvern-v2-position-only-exp14-candidate.glb')};
const server=createServer((request,response)=>{
 if(request.url==='/report'&&request.method==='POST'){let body='';request.on('data',chunk=>{body+=chunk;if(body.length>1000000)request.destroy();});request.on('end',()=>{try{const report=JSON.parse(body);writeFileSync(resolve(folder,'gpu-performance-report.json'),JSON.stringify(report,null,2));response.end('saved');console.log('GPU report saved');}catch{response.writeHead(400).end();}});return;}
 const url=new URL(request.url,'http://localhost');let path=paths[url.pathname];
 if(url.pathname.startsWith('/three/')){const candidate=resolve(root,'node_modules/three',url.pathname.slice(7));if(candidate.startsWith(resolve(root,'node_modules/three')+'/'))path=candidate;}
 if(!path){response.writeHead(404).end();return;}
 try{const data=readFileSync(path);response.setHeader('Content-Type',extname(path)==='.html'?'text/html':extname(path)==='.js'?'text/javascript':'application/octet-stream');response.end(data);}catch{response.writeHead(404).end();}
});
server.listen(3760,'127.0.0.1',()=>console.log('GPU probe ready on localhost:3760'));
