import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { configuredChat } from '../chat.mjs';
import { createServer } from 'node:http';

test('personality is validated, isolated, and passed to chat; stream persists and replays done', async t => {
 const calls=[];
 const {request,register}=await fixture(t,{chat:{reply:async o=>{calls.push(o);return '好';},stream:async o=>{calls.push(o);o.onDelta('你');o.onDelta('好');return '你好';}}});
 const a=await register('alice'), b=await register('bobby');
 assert.deepEqual((await request('/api/personality',{cookie:a.cookie})).data,{preset:'friendly',custom:''});
 assert.equal((await request('/api/personality',{cookie:a.cookie,method:'PUT',body:{preset:'calm',custom:'叫我小明'}})).status,200);
 assert.equal((await request('/api/personality',{cookie:a.cookie,method:'PUT',body:{preset:'evil',custom:''}})).status,400);
 assert.deepEqual((await request('/api/personality',{cookie:b.cookie})).data,{preset:'friendly',custom:''});
 const body={requestId:'stream-test-001',text:'hi'};
 const result=await request('/api/messages/stream',{cookie:a.cookie,method:'POST',body});
 assert.match(result.data,/event: delta\ndata: {"text":"你"}/);
 assert.match(result.data,/event: done/);
 assert.deepEqual({...calls[0].personality},{preset:'calm',custom:'叫我小明'});
 assert.match((await request('/api/messages/stream',{cookie:a.cookie,method:'POST',body})).data,/event: done/);
 assert.equal(calls.length,1);
 assert.equal((await request('/api/messages',{cookie:a.cookie})).data.messages.at(-1).text,'你好');
});

test('provider decodes split UTF8 SSE incrementally and requires completion', async t=>{
 let payload; const server=createServer(async(req,res)=>{
 let raw=''; for await(const c of req)raw+=c;payload=JSON.parse(raw);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const bytes=Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\n\n');
 for(const byte of bytes){res.write(Buffer.from([byte]));await new Promise(r=>setImmediate(r));}res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const chat=configuredChat({LLM_API_KEY:'test',LLM_BASE_URL:`http://127.0.0.1:${server.address().port}`});
 const chunks=[];assert.equal(await chat.stream({text:'hi',personality:{preset:'calm',custom:'秘密偏好'},onDelta:s=>chunks.push(s)}),'你好');
 assert.deepEqual(chunks,['你好']);assert.equal(payload.stream,true);assert.match(JSON.stringify(payload.messages),/秘密偏好/);
});

test('stream errors never persist partial assistants and deletion cancels generation', async t=>{
 let release,started;const gate=new Promise(r=>started=r);
 const {request,register}=await fixture(t,{chat:{stream:async({onDelta})=>{onDelta('片段');started();return new Promise(r=>release=r);}}});
 const a=await register('alice');
 const pending=request('/api/messages/stream',{cookie:a.cookie,method:'POST',body:{requestId:'delete-stream-001',text:'hi'}});
 await gate;
 assert.equal((await request('/api/messages',{cookie:a.cookie,method:'POST',body:{requestId:'locked-stream-001',text:'hi'}})).status,409);
 await request('/api/history',{cookie:a.cookie,method:'DELETE'});release('片段结束');
 assert.match((await pending).data,/event: error/);
 assert.equal((await request('/api/messages',{cookie:a.cookie})).data.messages.length,0);
});

test('client disconnect aborts provider and marks pending request failed', async t=>{
 let aborted;const gate=new Promise(r=>aborted=r);
 const {base,request,register}=await fixture(t,{chat:{stream:async({signal,onDelta})=>{
 onDelta('开始');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true}));
 }}});
 const a=await register('alice');
 const response=await fetch(base+'/api/messages/stream',{method:'POST',headers:{Cookie:a.cookie,'X-Pet-Request':'1','Content-Type':'application/json'},body:JSON.stringify({requestId:'disconnect-001',text:'hi'})});
 const reader=response.body.getReader();await reader.read();await reader.cancel();await gate;
 for(let i=0;i<20;i++){
 const data=(await request('/api/messages',{cookie:a.cookie})).data;
 if(data.requests[0].state==='failed'){assert.equal(data.messages.filter(m=>m.role==='assistant').length,0);return;}
 await new Promise(r=>setTimeout(r,10));
 }assert.fail('request remained pending');
});

test('failed stream emits a safe error and keeps only the user message', async t=>{
 const {request,register}=await fixture(t,{chat:{stream:async({onDelta})=>{onDelta('partial');throw Error('secret-key');}}});
 const a=await register('alice');
 const response=await request('/api/messages/stream',{cookie:a.cookie,method:'POST',body:{requestId:'failure-stream-001',text:'hi'}});
 assert.match(response.data,/event: error/);assert.doesNotMatch(response.data,/secret-key|event: done/);
 const data=(await request('/api/messages',{cookie:a.cookie})).data;
 assert.equal(data.messages.length,1);assert.equal(data.requests[0].state,'failed');
});
