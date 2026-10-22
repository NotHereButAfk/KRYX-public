export function installRoomChat(game) {
  const host = document.createElement('section'); host.id='room-chat'; host.setAttribute('aria-label','Room chat');
  const log = document.createElement('div'); log.className='chat-lines'; log.setAttribute('role','log'); log.setAttribute('aria-live','polite');
  const open = document.createElement('button'); open.type='button'; open.textContent='ENTER to chat';
  const input = document.createElement('input'); input.maxLength=200; input.placeholder='Message this room…'; input.setAttribute('aria-label','Chat message'); input.hidden=true;
  host.append(log,open,input); document.getElementById('app').append(host);
  let client=null, lastSend=-Infinity, lastMessage=null;
  const clearInput=()=>{game.input.keys.clear();game.input.justPressed.clear();game.input._virtualKeys?.clear();game.input.mouseDown=false;game.input.rightMouseDown=false;game.input.mouseDX=game.input.mouseDY=0;};
  const close=()=>{game._chatOpen=false; input.hidden=true;open.hidden=false;input.blur();clearInput();};
  const begin=()=>{if(!client?.connected)return;clearInput();game._chatOpen=true;input.hidden=false;open.hidden=true;input.focus();};
  open.addEventListener('click',begin);
  // Capture before gameplay keys, so typing never fires abilities or moves the player.
  window.addEventListener('keydown',e=>{
    if(game._chatOpen){e.stopImmediatePropagation();if(e.code==='Escape'){e.preventDefault();close();}else if(e.code==='Enter'){e.preventDefault();const text=input.value.trim();if(text && performance.now()-lastSend>=2000 && client?.sendChat(text)){lastSend=performance.now();input.value='';close();}else if(!text)close();}return;}
    if(e.code==='Enter' && !e.repeat && !e.target.closest?.('input,textarea,[contenteditable="true"]') && !host.hidden){e.preventDefault();e.stopImmediatePropagation();begin();}
  },true);
  for(const event of ['mousedown','wheel'])window.addEventListener(event,e=>{if(game._chatOpen || host.contains(e.target))e.stopImmediatePropagation();},true);
  setInterval(()=>{
    const next=game._authNet?.client;
    if(client!==next){client=next;lastMessage=null;log.replaceChildren();close();}
    const loading=['connect-screen','map-loading','post-match-ads'].some(id=>{const e=document.getElementById(id);return e&&!e.classList.contains('hidden');});
    host.hidden=loading||!client?.connected;
    if(host.hidden&&game._chatOpen)close();
    const messages=client?.chatMessages||[];
    if(messages.at(-1)!==lastMessage){lastMessage=messages.at(-1);log.replaceChildren();for(const m of messages.slice(-5)){const line=document.createElement('div');line.textContent='[room] '+m.name+': '+m.text;log.append(line);}log.scrollTop=log.scrollHeight;}
  },200);
}
