import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {configuredChat} from '../chat.mjs';
test('custom personality is a system role rule replacing default persona in both modes', async t=>{
 const bodies=[];const server=createServer(async(req,res)=>{let raw='';for await(const x of req)raw+=x;const b=JSON.parse(raw);bodies.push(b);if(b.stream){res.setHeader('Content-Type','text/event-stream');res.end('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n');}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'好'}}]}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const chat=configuredChat({LLM_API_KEY:'fixture',LLM_BASE_URL:`http://127.0.0.1:${server.address().port}`});
 const options={text:'你好',history:[{role:'user',content:'我和对象闹矛盾，消息不回'},{role:'assistant',content:'旧建议：别再联系了，她在躲你'}],personality:{preset:'playful',custom:'知性年长女性朋友。不站队，不机械追问。'}};
 await chat.reply(options);await chat.stream({...options,onDelta:()=>{}});
 for(const b of bodies){assert.equal(b.messages.filter(m=>m.role==='assistant').length,0);assert.match(JSON.stringify(b.messages),/旧建议/);const s=b.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');assert.match(s,/当前账号的角色与行为规则/);assert.match(s,/不站队/);assert.doesNotMatch(s,/仅调整语气|以下JSON是偏好资料|开朗、体贴、有点调皮/);assert.match(s,/历史.*不.*指令/);}
 for (const [text, expected] of [['我很泄气，不想再主动了','只用两个短句'],['你的意思是不说话吗','只用两句澄清'],['我应该怎么办，请给一个建议','明确求助']]) {
   await chat.reply({...options,text});const body=bodies.at(-1);assert.match(body.messages[0].content,new RegExp(expected));assert.equal(body.messages.filter(m=>m.role==='system').length,1);
 }
 await chat.reply({...options,text:'你是说地球绕太阳转？',history:[]});assert.doesNotMatch(bodies.at(-1).messages[0].content,/本轮硬性输出要求/);
 await chat.reply({...options,text:'如何实现二分查找？'});assert.doesNotMatch(bodies.at(-1).messages[0].content,/本轮硬性输出要求|本轮用户明确求助/);
 await chat.reply({...options,text:'你是说地球绕太阳转？'});assert.doesNotMatch(bodies.at(-1).messages[0].content,/本轮硬性输出要求/);
 await chat.reply({...options,text:'解释一下光合作用'});assert.doesNotMatch(bodies.at(-1).messages[0].content,/本轮硬性输出要求/);assert.equal(bodies.at(-1).max_tokens,600);
 await chat.reply({...options,text:'我很难过',personality:{custom:'使用诗歌回答',preset:'calm'}});assert.doesNotMatch(bodies.at(-1).messages[0].content,/本轮硬性输出要求/);
 await chat.reply({text:'hi',personality:{preset:'calm',custom:''}});assert.match(bodies.at(-1).messages[0].content,/沉稳温柔/);
});
