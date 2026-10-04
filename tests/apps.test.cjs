'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const Apps = require('../site/js/apps.js');

function calculate(sequence) {
    const model = new Apps.CalculatorModel();
    for (const key of sequence) model.key(key);
    return model;
}
function pngHeader(width = 1024, height = 768) {
    const bytes = new Uint8Array(24);
    bytes.set([137,80,78,71,13,10,26,10], 0);
    bytes.set([73,72,68,82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width); view.setUint32(20, height);
    return bytes;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

for (const [sequence, expected] of [
    ['2+3*4=', '20'], ['8/2*3=', '12'], ['2+3===', '11'], ['8-2==', '4'],
    ['2++3=', '5'], ['2+*3=', '6'], ['2+=', '4'], ['0.1+0.2=', '0.3'],
    ['1/3=', '0.333333333333'], ['12.3.4', '12.34'], ['0006', '6'], ['.5+.2=', '0.7'],
    ['200+10%=', '220'], ['200-10%=', '180'], ['200*10%=', '20'], ['200/10%=', '2000'],
    ['10%', '0.1'], ['8/0=', 'Error'], ['0/0=', 'Error'], ['8/0=2', '2'], ['2+3=7', '7']
]) {
    test('Calculator sequential operation ' + sequence, () => assert.equal(calculate(sequence).display, expected));
}

test('Calculator sign starts a signed right operand, supports negative decimals, and clears', () => {
    const model = calculate('2+'); model.sign(); model.input('3'); model.equals();
    assert.equal(model.display, '-1');
    model.clear(); model.sign(); model.input('.'); model.input('5'); assert.equal(model.display, '-0.5');
    model.sign(); assert.equal(model.display, '0.5');
    model.clear(); assert.equal(model.display, '0'); assert.equal(model.pending, null);
});
test('Calculator backspace and keyboard control keys are consistent', () => {
    const model = calculate('123'); model.key('Backspace'); assert.equal(model.display, '12');
    model.key('Enter'); model.key('Backspace'); assert.equal(model.display, '0');
    model.key('9'); model.key('F9'); assert.equal(model.display, '-9');
    model.key('Escape'); assert.equal(model.display, '0');
    assert.equal(model.key('Tab'), false);
    model.key('9'); model.key('Delete'); assert.equal(model.display, '0');
});
test('Calculator limits entry digits and formats overflows as Error', () => {
    const model = calculate('12345678901234567890'); assert.equal(model.display, '123456789012345');
    model.result(Infinity); assert.equal(model.display, 'Error');
    model.input('8'); assert.equal(model.display, '8');
    model.result(-0); assert.equal(model.display, '0');
});
test('Calculator validated snapshots preserve pending/repeated operations', () => {
    const original = calculate('2+3=');
    const copy = new Apps.CalculatorModel(JSON.parse(JSON.stringify(original.snapshot())));
    assert.equal(copy.equals(), '8');
    const pending = new Apps.CalculatorModel(calculate('9*').snapshot()); pending.input('3'); assert.equal(pending.equals(), '27');
    for (const invalid of [null, {}, {display:'<script>'}, {display:'Infinity'}, {...original.snapshot(), repeatOperand:Infinity}, {...original.snapshot(), pending:'evil'}]) {
        assert.equal(new Apps.CalculatorModel(invalid).display, '0');
    }
});

test('Safari normalizes HTTP(S), domains, ports and protocol-relative addresses', () => {
    for (const [input, expected] of [
        ['example.com', 'https://example.com/'], [' https://example.com/a?b=c#d ', 'https://example.com/a?b=c#d'],
        ['HTTP://EXAMPLE.COM', 'http://example.com/'], ['//example.com/a', 'https://example.com/a'],
        ['localhost:3000/path', 'https://localhost:3000/path']
    ]) assert.equal(Apps.normalizeAddress(input), expected);
});
test('Safari rejects unsupported schemes, credentials, control characters and invalid hosts', () => {
    for (const input of ['', 'javascript:alert(1)', 'data:text/html,a', 'ftp://example.com', 'file:///tmp/a',
        'https://user:password@example.com', 'https://x\n.example', 'http://', 'http://bad host', 'https://example.com\\evil']) {
        assert.throws(() => Apps.normalizeAddress(input), /valid|HTTP|password/);
    }
});
test('Safari history is bounded, branches after back and does not invent iframe history', () => {
    const history = new Apps.SafariHistory();
    assert.equal(history.current(), 'https://vectorindex.cloud/');
    assert.equal(history.canBack(), false);
    history.navigate('a.example'); history.navigate('b.example');
    assert.equal(history.back(), 'https://a.example/'); assert.equal(history.canForward(), true);
    history.navigate('c.example'); assert.equal(history.canForward(), false);
    history.navigate('c.example'); assert.equal(history.entries.length, 3);
    const entries = history.entries.slice();
    assert.throws(() => history.navigate('javascript:alert(1)')); assert.deepEqual(history.entries, entries);
    for (let i = 0; i < 130; i++) history.navigate('https://example.com/' + i);
    assert.equal(history.entries.length, 100); assert.equal(history.index, 99);
});

test('Drawing history caps memory and invalidates redo on a new branch', () => {
    const history = new Apps.DrawingHistory(3);
    history.reset('blank'); history.push('one'); history.push('two');
    assert.equal(history.undo(), 'one'); assert.equal(history.redo(), 'two');
    history.push('three'); assert.deepEqual(history.entries, ['one','two','three']);
    history.undo(); history.push('four'); assert.equal(history.canRedo(), false);
    history.reset('import'); assert.equal(history.canUndo(), false); assert.equal(history.canRedo(), false);
});
test('Pointer coordinates account for resized canvas letterboxing and outside release', () => {
    const rect = {left:10, top:20, width:500, height:200};
    assert.equal(Apps.canvasPoint(rect, 100, 100, 20, 100, false), null);
    assert.deepEqual(Apps.canvasPoint(rect, 100, 100, 260, 120, false), {x:50,y:50});
    assert.deepEqual(Apps.canvasPoint(rect, 100, 100, 1000, -20, true), {x:100,y:0});
    assert.equal(Apps.canvasPoint({left:0,top:0,width:0,height:0},100,100,0,0,true), null);
});
test('PNG validation checks signature, dimensions and image size before decoding', () => {
    assert.deepEqual(Apps.validatePNGHeader(pngHeader(400,300)), {width:400,height:300});
    assert.throws(() => Apps.validatePNGHeader(new Uint8Array(24)), /valid PNG/);
    assert.throws(() => Apps.validatePNGHeader(pngHeader(0,30)), /too large/);
    assert.throws(() => Apps.validatePNGHeader(pngHeader(5000,5000)), /too large/);
});
test('Draft store rejects unavailable IndexedDB explicitly', async () => {
    await assert.rejects(new Apps.DraftStore(null).load(), /IndexedDB/);
});

function fixture() {
    const dom = new JSDOM('<div id="container"></div><input id="elsewhere">', {url:'https://desktop.example/'});
    const window = dom.window;
    const reports = [];
    const confirmations = [];
    const services = {report:(...args)=>reports.push(args), confirm:async (...args)=>{confirmations.push(args);return true;}};
    return {dom,window,container:window.document.getElementById('container'),services,reports,confirmations};
}
function mockSketch(fix, store) {
    const {window} = fix;
    const contexts = new WeakMap();
    window.HTMLCanvasElement.prototype.getContext = function () {
        if (!contexts.has(this)) contexts.set(this, {pixel:0, save(){},restore(){},fillRect(){this.pixel=0;},beginPath(){},moveTo(){},lineTo(){},arc(){},
            fill(){this.pixel+=1;},stroke(){this.pixel+=1;},drawImage(image){this.pixel=image.pixel || 99;},
            getImageData(){return {pixel:this.pixel};},putImageData(image){this.pixel=image.pixel;}});
        return contexts.get(this);
    };
    window.HTMLCanvasElement.prototype.toBlob = function (callback) {
        const result = new window.Blob([pngHeader()], {type:'image/png'}); result.pixel = this.getContext().pixel;
        callback(result);
    };
    const urls = new Map(); let nextURL = 1;
    window.URL.createObjectURL = value => {const url = 'blob:mock-' + nextURL++; urls.set(url,value);return url;};
    window.URL.revokeObjectURL = url => urls.delete(url);
    window.Image = class {
        set src(url) { this.naturalWidth=1024; this.naturalHeight=768; this.pixel=urls.get(url).pixel; queueMicrotask(()=>this.onload()); }
    };
    window.HTMLAnchorElement.prototype.click = function () { fix.download = {href:this.href,name:this.download}; };
    const saved = [];
    fix.saved = saved;
    const draftStore = store || {load:async()=>null,save:async(png,width,height)=>saved.push({png,width,height}),close(){}};
    fix.controller = Apps.createController('sketch',fix.container,{}, {draftStore},fix.services);
    fix.canvas = fix.container.querySelector('canvas');
    fix.canvas.getBoundingClientRect = () => ({left:0,top:0,width:512,height:384});
    fix.ctx = fix.canvas.getContext();
    fix.pointer = (type, x=100, y=100, target=fix.canvas) => {
        const event = new window.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});
        Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);
    };
    return fix;
}

test('Calculator controller renders accessible keys, scopes keyboard input and restores state', async () => {
    const fix = fixture();
    const controller = Apps.createController('calculator',fix.container,{}, {},fix.services);
    const panel = fix.container.querySelector('.mac-calculator');
    for (const key of '2+3*4=') panel.dispatchEvent(new fix.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    assert.equal(fix.container.querySelector('output').textContent,'20');
    fix.window.document.getElementById('elsewhere').dispatchEvent(new fix.window.KeyboardEvent('keydown',{key:'9',bubbles:true}));
    assert.equal(fix.container.querySelector('output').textContent,'20');
    const state = controller.snapshot(); controller.dispose();
    const reopened = Apps.createController('calc',fix.container,{},state,fix.services);
    assert.equal(fix.container.querySelector('output').textContent,'20');
    assert.equal(await reopened.commands.copyResult.run(),false);
    assert.match(fix.reports.at(-1)[0],/Clipboard/);
    reopened.dispose(); fix.dom.window.close();
});
test('Calculator clipboard errors are reported and disposed commands cannot execute', async () => {
    const fix = fixture();
    let copied;
    Object.defineProperty(fix.window.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
    const controller = Apps.createController('calculator',fix.container,{}, {},fix.services);
    await controller.commands.copyResult.run(); assert.equal(copied,'0');
    controller.dispose(); copied=null; assert.equal(controller.commands.copyResult.run(),false); assert.equal(copied,null);
    fix.dom.window.close();
});
test('Safari UI navigation shares commands and keeps an explicit unverifiable embed notice', () => {
    const fix = fixture(), controller = Apps.createController('safari',fix.container,{}, {url:'https://ignored.example'},fix.services);
    const input=fix.container.querySelector('input'), frame=fix.container.querySelector('iframe');
    assert.equal(frame.src,'https://vectorindex.cloud/'); assert.equal(controller.commands.back.enabled(),false);
    input.value='example.com'; fix.container.querySelector('form').dispatchEvent(new fix.window.Event('submit',{cancelable:true,bubbles:true}));
    assert.equal(frame.src,'https://example.com/'); assert.equal(controller.commands.back.enabled(),true);
    controller.commands.back.run(); assert.equal(frame.src,'https://vectorindex.cloud/');
    controller.commands.forward.run(); assert.equal(frame.src,'https://example.com/');
    input.value='javascript:alert(1)'; fix.container.querySelector('form').dispatchEvent(new fix.window.Event('submit',{cancelable:true}));
    assert.equal(frame.src,'https://example.com/'); assert.match(fix.reports.at(-1)[0],/HTTP/);
    frame.dispatchEvent(new fix.window.Event('load')); assert.match(fix.container.querySelector('.safari-status').textContent,/cannot confirm/);
    assert.match(fix.container.querySelector('.safari-limitations').textContent,/not links followed inside/);
    assert.match(fix.container.querySelector('.safari-external').rel,/noopener/);
    controller.commands.home.run(); assert.equal(frame.src,'https://vectorindex.cloud/');
    controller.dispose(); fix.dom.window.close();
});
test('Sketch releases strokes outside canvas, supports undo/redo/clear and saves fixed dimensions', async () => {
    const fix = mockSketch(fixture()); await fix.controller.ready;
    const initial = fix.ctx.pixel;
    fix.pointer('pointerdown'); fix.pointer('pointermove',800,500,fix.window); fix.pointer('pointerup',800,500,fix.window);
    assert.ok(fix.ctx.pixel>initial); assert.equal(fix.controller.commands.undo.enabled(),true);
    const drawn=fix.ctx.pixel;
    fix.controller.commands.undo.run(); assert.equal(fix.ctx.pixel,initial);
    fix.controller.commands.redo.run(); assert.equal(fix.ctx.pixel,drawn);
    fix.controller.commands.clear.run(); assert.equal(fix.ctx.pixel,0);
    fix.controller.commands.undo.run(); assert.equal(fix.ctx.pixel,drawn);
    assert.equal(await fix.controller.beforeClose(),true);
    assert.equal(fix.saved.at(-1).width,1024);assert.equal(fix.saved.at(-1).height,768);
    assert.equal(fix.canvas.width,1024);assert.equal(fix.canvas.height,768);
    const before = fix.ctx.pixel; fix.pointer('pointermove',10,10,fix.window); assert.equal(fix.ctx.pixel,before,'released pointer cannot keep painting');
    fix.controller.dispose(); fix.dom.window.close();
});
test('Sketch lost capture and window blur finish exactly one stroke each', async () => {
    const fix = mockSketch(fixture()); await fix.controller.ready;
    fix.pointer('pointerdown'); fix.pointer('lostpointercapture'); fix.pointer('pointerup',100,100,fix.window);
    await fix.controller.beforeClose(); assert.equal(fix.saved.length,1);
    fix.pointer('pointerdown'); fix.window.dispatchEvent(new fix.window.Event('blur'));
    await fix.controller.beforeClose(); assert.equal(fix.saved.length,2);
    fix.controller.dispose();fix.dom.window.close();
});
test('Sketch asks before New Drawing replaces content and honors cancellation', async () => {
    const fix = mockSketch(fixture()); await fix.controller.ready;
    fix.pointer('pointerdown'); fix.pointer('pointerup');const before=fix.ctx.pixel;
    fix.services.confirm=async()=>false;
    assert.equal(await fix.controller.commands.newDrawing.run(),false); assert.equal(fix.ctx.pixel,before);
    fix.services.confirm=async()=>true;
    assert.equal(await fix.controller.commands.newDrawing.run(),true); assert.equal(fix.ctx.pixel,0);assert.equal(fix.controller.commands.undo.enabled(),false);
    await fix.controller.beforeClose();fix.controller.dispose();fix.dom.window.close();
});
test('Sketch import validates PNG, confirms replacement and round-trips the draft', async () => {
    const fix = mockSketch(fixture()); await fix.controller.ready;
    fix.pointer('pointerdown');fix.pointer('pointerup');
    const input=fix.container.querySelector('.sketch-import-input');
    const file=new fix.window.File([pngHeader(300,200)],'picture.png',{type:'image/png'});
    Object.defineProperty(input,'files',{configurable:true,value:[file]});
    input.dispatchEvent(new fix.window.Event('change'));await tick();await fix.controller.beforeClose();
    assert.equal(fix.confirmations.length,1);assert.equal(fix.ctx.pixel,99);assert.equal(fix.controller.commands.undo.enabled(),false);
    await fix.controller.commands.exportPNG.run();assert.equal(fix.download.name,'Sketch.png');
    const png=fix.saved.at(-1).png;fix.controller.dispose();fix.dom.window.close();
    const reopen=mockSketch(fixture(),{load:async()=>({version:1,png}),save:async()=>{},close(){}});await reopen.controller.ready;
    assert.equal(reopen.ctx.pixel,99); assert.match(reopen.container.querySelector('.sketch-status').textContent,/restored/);
    reopen.controller.dispose();reopen.dom.window.close();
});
test('Sketch failed autosave preserves the canvas and requires a close decision', async () => {
    const fix=mockSketch(fixture(),{load:async()=>null,save:async()=>{throw new Error('Quota exceeded');},close(){}});await fix.controller.ready;
    fix.pointer('pointerdown');fix.pointer('pointerup');const pixels=fix.ctx.pixel;
    fix.services.confirm=async()=>false;
    assert.equal(await fix.controller.beforeClose(),false);assert.equal(fix.ctx.pixel,pixels);assert.match(fix.reports.at(-1)[0],/could not save/);
    await fix.controller.commands.exportPNG.run();assert.equal(await fix.controller.beforeClose(),true);
    fix.controller.dispose();fix.dom.window.close();
});
test('Sketch serializes draft writes so delayed older saves cannot win', async () => {
    const writes=[];let release;
    const fix=mockSketch(fixture(),{load:async()=>null,save:async png=>{if(!writes.length){writes.push('waiting');await new Promise(resolve=>release=resolve);}writes.push(png.pixel);},close(){}});await fix.controller.ready;
    fix.pointer('pointerdown');fix.pointer('pointerup');await tick();
    fix.pointer('pointerdown',200,200);fix.pointer('pointerup',200,200);
    const final=fix.ctx.pixel;assert.deepEqual(writes,['waiting']);release();await fix.controller.beforeClose();assert.equal(writes.at(-1),final);
    fix.controller.dispose();fix.dom.window.close();
});


test('Calculator backspace never leaves partial exponent notation', () => {
    const model = new Apps.CalculatorModel(); model.result(1e30); model.sign();
    model.backspace(); assert.equal(model.display,'0'); model.input('3'); assert.equal(model.display,'3');
});
test('Sketch close waits for an in-flight replacement decision', async () => {
    const fix=mockSketch(fixture());await fix.controller.ready;
    fix.pointer('pointerdown');fix.pointer('pointerup');
    let decide;fix.services.confirm=()=>new Promise(resolve=>decide=resolve);
    const replacement=fix.controller.commands.newDrawing.run();
    let closed=false;const closing=fix.controller.beforeClose().then(result=>{closed=true;return result;});
    await tick();assert.equal(closed,false);assert.equal(fix.controller.commands.clear.enabled(),false);
    decide(false);await replacement;assert.equal(await closing,true);assert.ok(fix.ctx.pixel>0);
    fix.controller.dispose();fix.dom.window.close();
});
test('Sketch read/decode failure cannot discard canvas content during import', async () => {
    const fix=mockSketch(fixture());await fix.controller.ready;
    fix.pointer('pointerdown');fix.pointer('pointerup');const pixels=fix.ctx.pixel;
    const input=fix.container.querySelector('.sketch-import-input');
    Object.defineProperty(input,'files',{value:[new fix.window.File(['invalid'],'broken.png',{type:'image/png'})]});
    input.dispatchEvent(new fix.window.Event('change'));await tick();await fix.controller.beforeClose();
    assert.equal(fix.ctx.pixel,pixels);assert.equal(fix.confirmations.length,0);assert.match(fix.reports.at(-1)[0],/valid PNG/);
    fix.controller.dispose();fix.dom.window.close();
});
