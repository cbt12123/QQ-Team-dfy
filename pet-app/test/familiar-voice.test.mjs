import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {configuredChat} from '../chat.mjs';

test('familiar voice streams only spoken content before JSON is complete and leaves factual tasks unchanged', async t=>{
 let ended=false, payload;
 const content=JSON.stringify({opening:'嗯。',personal_voice:'我接着听，不着急。',continuation:''});
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;payload=JSON.parse(body);
  if(!payload.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:payload.response_format?content:'普通回答'}}]}));return;}
  res.setHeader('Content-Type','text/event-stream');
  const prefix='{"opening":"嗯';
  res.write('data: '+JSON.stringify({choices:[{delta:{content:prefix}}]})+'\n\n');
  setTimeout(()=>{ended=true;res.end('data: '+JSON.stringify({choices:[{delta:{content:content.slice(prefix.length)}}]})+'\n\ndata: [DONE]\n\n');},80);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const chat=configuredChat({LLM_API_KEY:'fixture',LLM_BASE_URL:`http://127.0.0.1:${server.address().port}`});
 const personality={preset:'calm',custom:'知性年长女性朋友。不站队。\n六、语气样\n不要照抄旧样句\n七、一致性\n保持分寸。'};
 let early=false;const chunks=[];
 const reply=await chat.stream({text:'我有点烦，想说说话',personality,onDelta:piece=>{if(!ended)early=true;chunks.push(piece);}});
 assert.equal(reply,'嗯。\n\n我接着听，不着急。');assert.equal(chunks.join(''),reply);assert.ok(early);
 assert.deepEqual(payload.response_format,{type:'json_object'});assert.doesNotMatch(payload.messages[0].content,/不要照抄旧样句/);assert.match(payload.messages[0].content,/七、一致性/);
 assert.equal(await chat.reply({text:'都烦',personality}),reply);
 assert.equal(await chat.reply({text:'解释一下光合作用',personality}),'普通回答');assert.equal(payload.response_format,undefined);
 for (const text of ['我很开心，法国首都是哪里？','终于放假了，明天上海天气怎么样？','好烦，解释一下这个算法','我累了，2+2等于多少？']) { assert.equal(await chat.reply({text,personality}),'普通回答');assert.equal(payload.response_format,undefined); }
 for (const text of ['没什么正事，就是想找你说两句','我今天终于搞定了','我怎么总觉得自己做什么都做不好']) { assert.equal(await chat.reply({text,personality}),reply);assert.deepEqual(payload.response_format,{type:'json_object'}); }
 assert.equal(await chat.reply({text:'我烦',personality:{custom:'使用诗歌说话',preset:'calm'}}),'普通回答');assert.equal(payload.response_format,undefined);
});
