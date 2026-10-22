import assert from 'node:assert/strict';
import {relayChat} from '../server/chat.mjs';
import {AuthClient} from '../src/net/AuthClient.js';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const received=[];const room={players:new Map([[1,{name:'Real Name',send:p=>received.push(p)}],[2,{name:'Other',send:p=>received.push(p)}],[3,{isBot:true,send:()=>assert.fail('bot recipient')}]])};const conn={id:1};
assert.equal(relayChat(room,{id:null},{text:'no'},0),false);
assert.equal(relayChat(room,conn,{text:'\n\u202ehello',name:'Spoof'},0),true);
assert.equal(received[0].name,'Real Name');assert.equal(received[0].text,'hello');assert.equal(received.length,2);
assert.equal(relayChat(room,conn,{text:'spam'},100),false);assert.equal(relayChat(room,conn,{text:'x'.repeat(1001)},2000),false);
assert.equal(relayChat(room,conn,{text:'x'.repeat(250)},2000),true);assert.equal(received.at(-1).text.length,200);
const client=new AuthClient('unused');for(let i=0;i<60;i++)client._recv(JSON.stringify({t:'chat',name:'A',text:String(i)}));assert.equal(client.chatMessages.length,50);
const browser=await chromium.launch();try{const p=await browser.newPage();await p.setContent('<div id="app"></div>');await p.addScriptTag({content:readFileSync('src/ui/RoomChat.js','utf8').replace('export function','function')+`\nwindow.sent=[];window.game={input:{keys:new Set(),justPressed:new Set()},_authNet:{client:{connected:true,chatMessages:[{name:'<img>',text:'<script>bad</script>'}],sendChat:t=>{sent.push(t);return true;}}}};installRoomChat(game);window.leaks=0;window.addEventListener('keydown',()=>leaks++);`});await p.waitForTimeout(250);assert.equal(await p.locator('#room-chat script,#room-chat img').count(),0);await p.keyboard.press('Enter');await p.keyboard.type('wasdQ');assert.equal(await p.evaluate(()=>leaks),0);await p.keyboard.press('Enter');assert.deepEqual(await p.evaluate(()=>sent),['wasdQ']);assert.equal(await p.evaluate(()=>game._chatOpen),false);await p.keyboard.press('Enter');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>game._chatOpen),false);console.log('Room chat passed: identity, membership, rate limit, text bounds, safe rendering and typing input isolation.');}finally{await browser.close();}
