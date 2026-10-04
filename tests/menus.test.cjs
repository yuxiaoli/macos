'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('<div id="menubar"><div class="menu-left"></div><div class="menu-right"></div></div><textarea>hello world</textarea>',{runScripts:'outside-only',url:'https://desktop.test/'});const w=dom.window;w.jQuery=require('jquery')(w);w.eval(fs.readFileSync('site/js/file-store.js','utf8'));const store=new w.MacFileStore(w.localStorage);const calls=[];let record=null;const wm={get activeWindow(){return record;},settings:{appearance:'dark',clock24:true},apps:[{id:'finder',name:'Finder'},{id:'textedit',name:'TextEdit'}],subscribe(){},listWindows(){return record?[record]:[];},openApp(id,opt){calls.push(['open',id,opt]);},updateSettings(p){Object.assign(this.settings,p);},requestClose(id){calls.push(['close',id]);},focusWindow(){},closeApp(){},restart(){},showDesktop(){calls.push(['desktop']);},overview(){calls.push(['overview']);}};const ws={desktop:{commands:{newFolder:{run(){calls.push(['folder']);},enabled:()=>true},rename:{run(){calls.push(['rename']);},enabled:()=>false}}},report(message){calls.push(['report',message]);},dialog(title,text){calls.push(['help',title,text]);},openPath(path){calls.push(['path',Array.from(path)]);}};w.eval(fs.readFileSync('site/js/menus.js','utf8'));const menus=new w.MacMenus(wm,ws,store);return {dom,w,wm,ws,store,menus,calls,setRecord(r){record=r;},close(){w.clearInterval(menus.clockTimer);dom.window.close();}};}
test('all menu entries and real disabled states exist',()=>{const x=setup();try{for(const name of x.menus.names){x.menus.openMenu(name,x.menus.buttons[x.menus.names.indexOf(name)]);assert.ok(x.menus.panel.querySelector('button'),name);x.menus.close();}x.menus.openMenu('File',x.menus.buttons[2]);assert.equal(x.menus.panel.querySelector('[data-command=rename]').disabled,true);assert.equal(x.menus.panel.querySelector('[data-command=newFolder]').disabled,false);x.menus.panel.querySelector('[data-command=rename]').click();assert.equal(x.calls.length,0);}finally{x.close();}});
test('menu pointerdown preserves editor target and selection, Escape restores it',()=>{const x=setup();try{const el=x.w.document.querySelector('textarea');const r={id:'a',appId:'textedit',name:'TextEdit',controller:{commands:{}}};x.setRecord(r);el.focus();el.setSelectionRange(1,5);const button=x.menus.buttons[3];button.dispatchEvent(new x.w.Event('pointerdown'));button.focus();button.click();assert.equal(x.menus.context.element,el);assert.equal(x.menus.context.start,1);x.w.document.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(x.w.document.activeElement,el);assert.equal(el.selectionStart,1);assert.equal(el.selectionEnd,5);}finally{x.close();}});
test('Cut leaves content intact if clipboard permission fails',async()=>{const x=setup();try{const el=x.w.document.querySelector('textarea');el.focus();el.setSelectionRange(0,5);Object.defineProperty(x.w.navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Permission denied');}}});await x.menus.edit('cut',x.menus.capture());assert.equal(el.value,'hello world');assert.match(x.calls[0][1],/Clipboard action failed/);}finally{x.close();}});
test('Cut only removes after successful copy and detects intervening edits',async()=>{const x=setup();try{const el=x.w.document.querySelector('textarea');el.focus();el.setSelectionRange(0,5);let resolve;Object.defineProperty(x.w.navigator,'clipboard',{value:{writeText:()=>new Promise(r=>resolve=r)}});const p=x.menus.edit('cut',x.menus.capture());el.value='new content';resolve();await p;assert.equal(el.value,'new content');assert.match(x.calls[0][1],/nothing was removed/);}finally{x.close();}});
test('menu keyboard skips disabled entries and supports submenu back navigation',()=>{const x=setup();try{x.menus.openMenu('File',x.menus.buttons[2]);const enabled=[...x.menus.panel.querySelectorAll('button:enabled')];x.w.document.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(x.w.document.activeElement,enabled[1]);x.menus.close();x.menus.openMenu('View',x.menus.buttons[4]);const appearance=x.menus.panel.querySelector('[data-command=appearance]');appearance.focus();appearance.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.ok(x.w.document.querySelector('.submenu'));x.w.document.activeElement.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(x.w.document.querySelector('.submenu'),null);assert.equal(x.w.document.activeElement,appearance);}finally{x.close();}});
test('Spotlight searches all folders and follows file changes',()=>{const x=setup();try{x.store.create(['Documents'],'Deep','folder');x.store.create(['Documents','Deep'],'needle.txt','text','hello');x.menus.spotlight();const input=x.menus.panel.querySelector('input');input.value='needle';input.dispatchEvent(new x.w.Event('input'));assert.match(x.menus.panel.textContent,/Documents\/Deep\/needle.txt/);x.store.rename(['Documents','Deep','needle.txt'],'renamed.txt');assert.match(x.menus.panel.textContent,/No matches/);}finally{x.close();}});
test('status panels report browser limitations and calendar changes months',()=>{const x=setup();try{const battery=x.w.document.querySelector('[data-status=battery]');x.menus.openStatus('battery',battery);assert.match(x.menus.panel.textContent,/unavailable/);const clock=x.w.document.querySelector('[data-status=clock]');x.menus.openStatus('clock',clock);const prior=x.menus.month.getMonth();[...x.menus.panel.querySelectorAll('button')].find(b=>b.textContent==='Next month').click();assert.equal(x.menus.month.getMonth(),(prior+1)%12);assert.equal(x.menus.panel.querySelectorAll('.calendar-grid b').length,7);}finally{x.close();}});

test('menu presentation keeps labels, shortcut hints, checks and groups accessible',()=>{
 const x=setup();
 try {
  x.menus.openMenu('File',x.menus.buttons[2]);
  const newFolder=x.menus.panel.querySelector('[data-command=newFolder]');
  assert.equal(newFolder.getAttribute('aria-label'),'New Folder');
  assert.equal(newFolder.querySelector('.menu-command-label').textContent,'New Folder');
  assert.equal(newFolder.querySelector('.menu-command-key').textContent,'⇧⌘N');
  assert.equal(newFolder.querySelector('.menu-command-key').getAttribute('aria-hidden'),'true');
  assert.ok(x.menus.panel.querySelector('[role=separator]'));
  x.menus.close();
  x.menus.openMenu('View',x.menus.buttons[4]);
  x.menus.panel.querySelector('[data-command=appearance]').click();
  const dark=x.menus.submenu.querySelector('[data-command=appearance-dark]');
  assert.equal(dark.getAttribute('role'),'menuitemcheckbox');
  assert.equal(dark.getAttribute('aria-checked'),'true');
  assert.equal(dark.textContent,'Dark');
 } finally {x.close();}
});

test('side submenu stays inside the viewport and closes with its parent',()=>{
 const x=setup();
 try {
  x.menus.openMenu('View',x.menus.buttons[4]);
  const appearance=x.menus.panel.querySelector('[data-command=appearance]');
  x.menus.panel.getBoundingClientRect=()=>({left:780,right:996,top:30,bottom:180});
  appearance.getBoundingClientRect=()=>({left:785,right:991,top:80,bottom:103});
  Object.defineProperty(x.w.HTMLElement.prototype,'offsetWidth',{configurable:true,get(){return this.classList.contains('submenu')?160:0;}});
  Object.defineProperty(x.w.HTMLElement.prototype,'offsetHeight',{configurable:true,get(){return this.classList.contains('submenu')?80:0;}});
  appearance.click();
  const submenu=x.menus.submenu;
  assert.equal(submenu.parentElement,x.w.document.body);
  assert.equal(submenu.style.left,'622px');
  assert.equal(submenu.style.top,'75px');
  assert.equal(appearance.getAttribute('aria-expanded'),'true');
  submenu.dispatchEvent(new x.w.Event('pointerdown',{bubbles:true}));
  assert.equal(x.menus.submenu,submenu);
  submenu.querySelector('[data-command=appearance-light]').click();
  assert.equal(x.wm.settings.appearance,'light');
  assert.equal(x.menus.panel,null);
  assert.equal(x.menus.submenu,null);
  assert.equal(submenu.isConnected,false);
  assert.equal(appearance.getAttribute('aria-expanded'),'false');
  x.menus.openMenu('View',x.menus.buttons[4]);
  x.menus.panel.querySelector('[data-command=appearance]').click();
  x.w.document.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(x.w.document.querySelector('.submenu'),null);
  assert.equal(x.menus.panel,null);
 } finally {x.close();}
});
