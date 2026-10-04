/* Local application controllers. No network dependency is required to use Calculator or Sketch. */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MacApps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var HOME = 'https://vectorindex.cloud';
    var DRAWING_WIDTH = 1024;
    var DRAWING_HEIGHT = 768;
    var MAX_PNG_BYTES = 25 * 1024 * 1024;
    var operators = ['+', '-', '*', '/'];

    function formatNumber(number) {
        if (!Number.isFinite(number)) return 'Error';
        if (Object.is(number, -0) || number === 0) return '0';
        return String(Number(number.toPrecision(12)));
    }

    function calculate(left, operator, right) {
        if (operator === '+') return left + right;
        if (operator === '-') return left - right;
        if (operator === '*') return left * right;
        if (operator === '/') return right === 0 ? NaN : left / right;
        return right;
    }

    function CalculatorModel(saved) {
        this.clear();
        if (saved && typeof saved === 'object') {
            var display = String(saved.display);
            var numberOK = function (n) { return n === null || (typeof n === 'number' && Number.isFinite(n)); };
            var operatorOK = function (op) { return op === null || operators.indexOf(op) !== -1; };
            if ((display === 'Error' || (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(display) && Number.isFinite(Number(display)))) &&
                display.length <= 32 && numberOK(saved.accumulator) && numberOK(saved.repeatOperand) &&
                operatorOK(saved.pending) && operatorOK(saved.repeatOperator) &&
                (saved.pending === null || saved.accumulator !== null) &&
                (saved.repeatOperator === null || saved.repeatOperand !== null)) {
                this.display = display;
                this.accumulator = saved.accumulator;
                this.pending = saved.pending;
                this.repeatOperand = saved.repeatOperand;
                this.repeatOperator = saved.repeatOperator;
                this.waiting = !!saved.waiting;
                this.error = display === 'Error';
            }
        }
    }
    CalculatorModel.prototype.clear = function () {
        this.display = '0';
        this.accumulator = null;
        this.pending = null;
        this.repeatOperator = null;
        this.repeatOperand = null;
        this.waiting = false;
        this.error = false;
        return this.display;
    };
    CalculatorModel.prototype.result = function (value) {
        this.display = formatNumber(value);
        this.error = this.display === 'Error';
        if (this.error) {
            this.accumulator = null;
            this.pending = null;
            this.repeatOperator = null;
            this.repeatOperand = null;
        }
        return this.display;
    };
    CalculatorModel.prototype.input = function (digit) {
        digit = String(digit);
        if (!/^[0-9.]$/.test(digit)) return this.display;
        if (this.error) this.clear();
        if (this.waiting) {
            this.display = '0';
            this.waiting = false;
            if (!this.pending) { this.repeatOperator = null; this.repeatOperand = null; }
        }
        if (digit === '.') {
            if (this.display.indexOf('.') === -1 && !/e/i.test(this.display)) this.display += '.';
        } else if (this.display === '0' || this.display === '-0') {
            this.display = (this.display.charAt(0) === '-' ? '-' : '') + digit;
        } else if (this.display.replace(/[^0-9]/g, '').length < 15 && !/e/i.test(this.display)) this.display += digit;
        return this.display;
    };
    CalculatorModel.prototype.operator = function (operator) {
        if (operators.indexOf(operator) === -1 || this.error) return this.display;
        if (this.pending && !this.waiting) this.result(calculate(this.accumulator, this.pending, Number(this.display)));
        if (this.error) return this.display;
        this.accumulator = Number(this.display);
        this.pending = operator;
        this.waiting = true;
        this.repeatOperator = null;
        this.repeatOperand = null;
        return this.display;
    };
    CalculatorModel.prototype.equals = function () {
        if (this.error) return this.display;
        if (this.pending) {
            var operator = this.pending;
            var operand = Number(this.display);
            this.result(calculate(this.accumulator, operator, operand));
            if (!this.error) {
                this.repeatOperator = operator;
                this.repeatOperand = operand;
                this.pending = null;
                this.accumulator = Number(this.display);
            }
        } else if (this.repeatOperator) this.result(calculate(Number(this.display), this.repeatOperator, this.repeatOperand));
        this.waiting = true;
        return this.display;
    };
    CalculatorModel.prototype.sign = function () {
        if (this.error) return this.display;
        if (this.waiting && this.pending) this.display = '-0';
        else this.display = this.display.charAt(0) === '-' ? this.display.slice(1) : '-' + this.display;
        this.waiting = false;
        if (!this.pending) { this.repeatOperator = null; this.repeatOperand = null; }
        return this.display;
    };
    CalculatorModel.prototype.percent = function () {
        if (this.error) return this.display;
        var value = Number(this.display) / 100;
        if (this.pending === '+' || this.pending === '-') value *= this.accumulator;
        this.result(value);
        this.waiting = false;
        if (!this.pending) { this.repeatOperator = null; this.repeatOperand = null; }
        return this.display;
    };
    CalculatorModel.prototype.backspace = function () {
        if (this.error) return this.clear();
        if (this.waiting || /e/i.test(this.display)) { this.display = '0'; this.waiting = false; }
        else this.display = this.display.slice(0, -1);
        if (!this.display || this.display === '-') this.display = '0';
        if (!this.pending) { this.repeatOperator = null; this.repeatOperand = null; }
        return this.display;
    };
    CalculatorModel.prototype.key = function (key) {
        if (/^[0-9.]$/.test(key)) this.input(key);
        else if (operators.indexOf(key) !== -1) this.operator(key);
        else if (key === '=' || key === 'Enter') this.equals();
        else if (key === 'Escape' || key === 'Delete' || key.toLowerCase() === 'c') this.clear();
        else if (key === 'Backspace') this.backspace();
        else if (key === '%') this.percent();
        else if (key === 'F9') this.sign();
        else return false;
        return true;
    };
    CalculatorModel.prototype.snapshot = function () {
        return { display: this.display, accumulator: this.accumulator, pending: this.pending,
            repeatOperator: this.repeatOperator, repeatOperand: this.repeatOperand, waiting: this.waiting };
    };

    function normalizeAddress(input) {
        var text = String(input == null ? '' : input).trim();
        if (!text || /[\u0000-\u001f\u007f\\]/.test(text)) throw new Error('Enter a valid HTTP or HTTPS address.');
        if (text.slice(0, 2) === '//') text = 'https:' + text;
        else if (!/^https?:\/\//i.test(text)) {
            if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/?#:]+:\d+(?:[/?#]|$)/.test(text)) {
                throw new Error('Only HTTP and HTTPS addresses are allowed.');
            }
            text = 'https://' + text;
        }
        var url;
        try { url = new URL(text); } catch (error) { throw new Error('That address is not a valid HTTP or HTTPS URL.'); }
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error('Only HTTP and HTTPS addresses are allowed.');
        if (url.username || url.password) throw new Error('Addresses containing usernames or passwords are not supported.');
        return url.href;
    }
    function SafariHistory() { this.entries = [normalizeAddress(HOME)]; this.index = 0; }
    SafariHistory.prototype.current = function () { return this.entries[this.index]; };
    SafariHistory.prototype.navigate = function (address) {
        var next = normalizeAddress(address);
        if (next !== this.current()) {
            this.entries = this.entries.slice(0, this.index + 1);
            this.entries.push(next);
            if (this.entries.length > 100) this.entries.shift();
            this.index = this.entries.length - 1;
        }
        return this.current();
    };
    SafariHistory.prototype.canBack = function () { return this.index > 0; };
    SafariHistory.prototype.canForward = function () { return this.index < this.entries.length - 1; };
    SafariHistory.prototype.back = function () { if (this.canBack()) this.index -= 1; return this.current(); };
    SafariHistory.prototype.forward = function () { if (this.canForward()) this.index += 1; return this.current(); };

    function DrawingHistory(limit) { this.limit = Math.max(2, limit || 20); this.entries = []; this.index = -1; }
    DrawingHistory.prototype.push = function (frame) {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(frame);
        if (this.entries.length > this.limit) this.entries.shift();
        this.index = this.entries.length - 1;
    };
    DrawingHistory.prototype.reset = function (frame) { this.entries = [frame]; this.index = 0; };
    DrawingHistory.prototype.canUndo = function () { return this.index > 0; };
    DrawingHistory.prototype.canRedo = function () { return this.index < this.entries.length - 1; };
    DrawingHistory.prototype.undo = function () { if (this.canUndo()) this.index -= 1; return this.entries[this.index]; };
    DrawingHistory.prototype.redo = function () { if (this.canRedo()) this.index += 1; return this.entries[this.index]; };

    // The canvas bitmap never resizes. Account for CSS object-fit letterboxing when mapping pointers.
    function canvasPoint(rect, width, height, clientX, clientY, clamp) {
        var scale = Math.min(rect.width / width, rect.height / height);
        if (!(scale > 0)) return null;
        var x = (clientX - rect.left - (rect.width - width * scale) / 2) / scale;
        var y = (clientY - rect.top - (rect.height - height * scale) / 2) / scale;
        if (!clamp && (x < 0 || y < 0 || x > width || y > height)) return null;
        return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
    }
    function validatePNGHeader(bytes) {
        var signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (!bytes || bytes.length < 24 || signature.some(function (value, index) { return bytes[index] !== value; }) ||
            bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) throw new Error('Choose a valid PNG image.');
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var width = view.getUint32(16), height = view.getUint32(20);
        if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
            throw new Error('This PNG is too large. Import an image with at most 16 million pixels.');
        }
        return { width: width, height: height };
    }

    function DraftStore(indexedDB) { this.indexedDB = indexedDB; this.dbPromise = null; this.db = null; }
    DraftStore.prototype.open = function () {
        var self = this;
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise(function (resolve, reject) {
            if (!self.indexedDB) { reject(new Error('This browser does not provide IndexedDB draft storage.')); return; }
            var request;
            try { request = self.indexedDB.open('macos-web-sketch', 1); } catch (error) { reject(error); return; }
            var rejected = false;
            request.onupgradeneeded = function () {
                if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
            };
            request.onsuccess = function () {
                if (rejected) { request.result.close(); return; }
                self.db = request.result;
                self.db.onversionchange = function () { self.close(); };
                resolve(self.db);
            };
            request.onerror = function () { reject(request.error || new Error('Could not open drawing storage.')); };
            request.onblocked = function () { rejected = true; reject(new Error('Drawing storage is blocked by another tab.')); };
        });
        return this.dbPromise;
    };
    DraftStore.prototype.load = async function () {
        var db = await this.open();
        return new Promise(function (resolve, reject) {
            var tx = db.transaction('drafts', 'readonly'), value = null;
            var request = tx.objectStore('drafts').get('latest');
            request.onsuccess = function () { value = request.result || null; };
            tx.oncomplete = function () { resolve(value); };
            tx.onerror = tx.onabort = function () { reject(tx.error || request.error || new Error('Could not read the drawing draft.')); };
        });
    };
    DraftStore.prototype.save = async function (png, width, height) {
        var db = await this.open();
        return new Promise(function (resolve, reject) {
            var tx = db.transaction('drafts', 'readwrite');
            tx.objectStore('drafts').put({ version: 1, png: png, width: width, height: height, updatedAt: Date.now() }, 'latest');
            tx.oncomplete = function () { resolve(); };
            tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Could not save the drawing draft.')); };
        });
    };
    DraftStore.prototype.close = function () { if (this.db) this.db.close(); this.db = null; this.dbPromise = null; };

    function createController(appId, container, record, options, services) {
        container = container && container.jquery ? container[0] : container;
        if (!container || !container.ownerDocument) throw new Error('An application container is required.');
        options = options || {};
        services = services || {};
        if (appId === 'calculator' || appId === 'calc') return createCalculator(container, options, services);
        if (appId === 'safari') return createSafari(container, services);
        if (appId === 'sketch' || appId === 'paint') return createSketch(container, options, services);
        return null;
    }
    function application(container, services) {
        var document = container.ownerDocument, window = document.defaultView || root;
        var disposed = false, listeners = [];
        function report(message, error) { if (services.report) services.report(message, error); }
        function listen(element, type, callback, options) {
            element.addEventListener(type, callback, options);
            listeners.push(function () { element.removeEventListener(type, callback, options); });
        }
        function command(label, run, enabled) {
            var item = { label: label, enabled: function () { return !disposed && (!enabled || !!enabled()); } };
            item.run = function () {
                if (!item.enabled()) return false;
                try {
                    var result = run.apply(null, arguments);
                    if (result && typeof result.catch === 'function') return result.catch(function (error) { report(error.message || 'The action could not be completed.', error); return false; });
                    return result;
                } catch (error) { report(error.message || 'The action could not be completed.', error); return false; }
            };
            return item;
        }
        function confirm(title, description) {
            if (services.confirm) return Promise.resolve(services.confirm(title, description));
            return Promise.resolve(typeof window.confirm === 'function' ? window.confirm(title + '\n\n' + description) : false);
        }
        return { document: document, window: window, report: report, listen: listen, command: command, confirm: confirm,
            disposed: function () { return disposed; }, dispose: function () { disposed = true; listeners.forEach(function (remove) { remove(); }); listeners = []; } };
    }
    function bindCommands(app, container, commands) {
        app.listen(container, 'click', function (event) {
            var button = event.target.closest('[data-app-command]');
            if (!button || !container.contains(button)) return;
            var command = commands[button.dataset.appCommand];
            if (command) command.run();
        });
    }
    function syncButtons(container, commands) {
        container.querySelectorAll('[data-app-command]').forEach(function (button) {
            var command = commands[button.dataset.appCommand];
            button.disabled = !command || !command.enabled();
        });
    }

    function createCalculator(container, options, services) {
        var app = application(container, services);
        var model = new CalculatorModel(options.calculator || (options.state && options.state.calculator));
        container.innerHTML = '<section class="mac-calculator" tabindex="0" aria-label="Calculator">' +
            '<output class="calculator-display" aria-label="Result" aria-live="polite">0</output>' +
            '<div class="calculator-grid"></div><p class="calculator-help">Keyboard: numbers, + − * /, Enter. F9 changes sign.</p></section>';
        var panel = container.firstElementChild, display = panel.querySelector('output'), grid = panel.querySelector('.calculator-grid');
        var keys = [['AC', 'clear', 'utility'], ['±', 'sign', 'utility'], ['%', 'percent', 'utility'], ['÷', '/', 'operator'],
            ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*', 'operator'], ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-', 'operator'],
            ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'operator'], ['0', '0', 'zero'], ['.', '.'], ['=', '=', 'operator']];
        keys.forEach(function (key) {
            var button = app.document.createElement('button');
            button.type = 'button'; button.textContent = key[0]; button.dataset.calcKey = key[1];
            button.className = 'calculator-key ' + (key[2] || 'number');
            button.setAttribute('aria-label', { clear: 'All clear', sign: 'Change sign', percent: 'Percent', '/': 'Divide', '*': 'Multiply', '-': 'Subtract', '+': 'Add', '=': 'Equals', '.': 'Decimal point' }[key[1]] || key[0]);
            grid.appendChild(button);
        });
        function render() { display.textContent = model.display; display.title = model.error ? 'Cannot calculate this result. Press AC or enter a number.' : model.display; }
        function act(key) {
            if (key === 'clear') model.clear();
            else if (key === 'sign') model.sign();
            else if (key === 'percent') model.percent();
            else model.key(key);
            render();
        }
        app.listen(panel, 'click', function (event) {
            var button = event.target.closest('[data-calc-key]');
            if (button) { act(button.dataset.calcKey); panel.focus({ preventScroll: true }); }
        });
        app.listen(container, 'keydown', function (event) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.target.closest('input,textarea,[contenteditable="true"]')) return;
            if (model.key(event.key)) { event.preventDefault(); event.stopPropagation(); render(); }
        });
        var commands = { copyResult: app.command('Copy Result', async function () {
            if (!app.window.navigator.clipboard || !app.window.navigator.clipboard.writeText) throw new Error('Clipboard access is unavailable. Select the result and copy it manually.');
            await app.window.navigator.clipboard.writeText(model.display);
            app.report('Calculator result copied.');
        }, function () { return !model.error; }) };
        render();
        return { commands: commands, beforeClose: async function () { return true; }, snapshot: function () { return { calculator: model.snapshot() }; }, dispose: app.dispose };
    }

    function createSafari(container, services) {
        var app = application(container, services), history = new SafariHistory(), loadTimer = null;
        container.innerHTML = '<section class="mac-safari" aria-label="Safari">' +
            '<div class="safari-toolbar"><button type="button" data-app-command="back" title="Back" aria-label="Back">←</button>' +
            '<button type="button" data-app-command="forward" title="Forward" aria-label="Forward">→</button>' +
            '<button type="button" data-app-command="home" title="Home">Home</button>' +
            '<button type="button" data-app-command="reload" title="Reload" aria-label="Reload">↻</button>' +
            '<form class="safari-address-form"><input class="safari-address-input" type="text" inputmode="url" spellcheck="false" autocomplete="off" aria-label="Website address">' +
            '<button type="submit" title="Go to address">Go</button></form>' +
            '<a class="safari-external" target="_blank" rel="noopener noreferrer" title="Open the address-bar page in a new browser tab">Open Externally ↗</a></div>' +
            '<p class="safari-status" role="status" aria-live="polite"></p>' +
            '<iframe class="safari-webview" title="Embedded website" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>' +
            '<p class="safari-limitations">Some sites block embedding. If the view is blank, use Open Externally. History and the address bar track navigation made here, not links followed inside a website.</p></section>';
        var input = container.querySelector('input'), frame = container.querySelector('iframe');
        var status = container.querySelector('.safari-status'), external = container.querySelector('.safari-external');
        function load() {
            if (app.disposed()) return false;
            app.window.clearTimeout(loadTimer);
            input.value = history.current(); external.href = history.current();
            status.textContent = 'Requesting an embedded view… Use Open Externally if the site does not appear.';
            frame.setAttribute('aria-busy', 'true');
            frame.src = history.current();
            syncButtons(container, commands);
            loadTimer = app.window.setTimeout(function () {
                if (app.disposed()) return;
                status.textContent = 'The embedded view could not be verified. The website may block embedding; try Open Externally.';
                frame.setAttribute('aria-busy', 'false');
            }, 10000);
            return true;
        }
        function navigate(address) { history.navigate(address); return load(); }
        var commands = {
            back: app.command('Back', function () { history.back(); return load(); }, function () { return history.canBack(); }),
            forward: app.command('Forward', function () { history.forward(); return load(); }, function () { return history.canForward(); }),
            home: app.command('Home', function () { return navigate(HOME); }),
            reload: app.command('Reload', load),
            openLocation: app.command('Open Location…', function () { input.focus(); input.select(); }),
            openExternal: app.command('Open Current Page Externally', function () { external.click(); })
        };
        bindCommands(app, container, commands);
        app.listen(container.querySelector('form'), 'submit', function (event) {
            event.preventDefault();
            try { navigate(input.value); } catch (error) { app.report(error.message, error); input.focus(); input.select(); }
        });
        app.listen(frame, 'load', function () {
            app.window.clearTimeout(loadTimer);
            frame.setAttribute('aria-busy', 'false');
            status.textContent = 'Embedded navigation ended. Browsers cannot confirm whether this page is displayed; use Open Externally if blank.';
        });
        app.listen(frame, 'error', function () {
            app.window.clearTimeout(loadTimer);
            frame.setAttribute('aria-busy', 'false');
            status.textContent = 'This page could not be embedded. Open it externally to continue.';
        });
        load();
        return { commands: commands, beforeClose: async function () { return true; }, snapshot: function () { return { url: HOME }; },
            dispose: function () { app.window.clearTimeout(loadTimer); app.dispose(); frame.removeAttribute('src'); } };
    }

    function createSketch(container, options, services) {
        var app = application(container, services), history = new DrawingHistory(20);
        var draft = options.draftStore || new DraftStore(app.window.indexedDB);
        var initialized = false, busy = false, hasContent = false, activePointer = null, lastPoint = null;
        var revision = 0, savedRevision = 0, exportedRevision = -1, saveQueue = Promise.resolve(), operation = Promise.resolve();
        var storageWarning = false, objectURLs = new Set();
        container.innerHTML = '<section class="mac-sketch" aria-label="Sketch">' +
            '<div class="sketch-toolbar"><label>Color <input type="color" class="sketch-color" value="#18283f" aria-label="Brush color"></label>' +
            '<label>Size <input type="range" class="sketch-size" min="1" max="48" value="5" aria-label="Brush size"></label>' +
            '<button type="button" data-app-command="undo" aria-label="Undo">↶</button><button type="button" data-app-command="redo" aria-label="Redo">↷</button>' +
            '<button type="button" data-app-command="clear">Clear</button><button type="button" data-app-command="importPNG">Import PNG</button>' +
            '<button type="button" data-app-command="exportPNG">Export PNG</button></div>' +
            '<div class="sketch-viewport"><canvas width="1024" height="768" tabindex="0" aria-label="Drawing canvas, 1024 by 768 pixels">Your browser does not support drawing.</canvas></div>' +
            '<p class="sketch-status" role="status" aria-live="polite">Opening the most recent draft…</p>' +
            '<input type="file" class="sketch-import-input" accept="image/png,.png" hidden></section>';
        var canvas = container.querySelector('canvas'), status = container.querySelector('.sketch-status');
        var color = container.querySelector('.sketch-color'), size = container.querySelector('.sketch-size'), fileInput = container.querySelector('.sketch-import-input');
        var ctx;
        try { ctx = canvas.getContext('2d', { willReadFrequently: true }); } catch (error) { ctx = null; }
        function canEdit() { return !!ctx && initialized && !busy && activePointer === null; }
        function update() { syncButtons(container, commands); }
        function white() { ctx.save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT); ctx.restore(); }
        function capture() { return { pixels: ctx.getImageData(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT), hasContent: hasContent }; }
        function blob() {
            return new Promise(function (resolve, reject) {
                try { canvas.toBlob(function (result) { if (result) resolve(result); else reject(new Error('Could not encode the drawing as PNG.')); }, 'image/png'); }
                catch (error) { reject(error); }
            });
        }
        function save() {
            var targetRevision = revision;
            // Capture immediately; queue writes so an older PNG can never overwrite a newer one.
            var captured = blob().then(function (value) { return { value: value }; }, function (error) { return { error: error }; });
            status.textContent = 'Saving drawing draft…';
            saveQueue = saveQueue.then(async function () {
                var snapshot = await captured;
                if (snapshot.error) throw snapshot.error;
                await draft.save(snapshot.value, DRAWING_WIDTH, DRAWING_HEIGHT);
                savedRevision = targetRevision;
                storageWarning = false;
                if (!app.disposed() && revision === targetRevision) status.textContent = 'Draft saved on this browser · 1024 × 768 · Last 20 drawing states available for Undo.';
            }).catch(function (error) {
                if (!app.disposed()) {
                    status.textContent = 'Draft could not be saved. Keep this window open or export a PNG to keep your drawing.';
                    if (!storageWarning) app.report('Sketch could not save its draft. Your canvas is still here; export a PNG to keep a copy.', error);
                }
                storageWarning = true;
            });
            return saveQueue;
        }
        function changed(reset) {
            revision += 1;
            if (reset) history.reset(capture()); else history.push(capture());
            update(); save();
        }
        function restore(frame) { if (!frame) return; ctx.putImageData(frame.pixels, 0, 0); hasContent = frame.hasContent; revision += 1; update(); save(); }
        function trackURL(value) { var url = app.window.URL.createObjectURL(value); objectURLs.add(url); return url; }
        function revokeURL(url) { app.window.URL.revokeObjectURL(url); objectURLs.delete(url); }
        function readBytes(file) {
            var part = file.slice(0, 24);
            if (part.arrayBuffer) return part.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
            return new Promise(function (resolve, reject) {
                var reader = new app.window.FileReader();
                reader.onload = function () { resolve(new Uint8Array(reader.result)); };
                reader.onerror = function () { reject(reader.error || new Error('Could not read the PNG.')); };
                reader.readAsArrayBuffer(part);
            });
        }
        function decode(file) {
            return new Promise(function (resolve, reject) {
                var url = trackURL(file), image = new app.window.Image();
                image.onload = function () { revokeURL(url); resolve(image); };
                image.onerror = function () { revokeURL(url); reject(new Error('This PNG could not be decoded.')); };
                image.src = url;
            });
        }
        function drawImage(image) {
            var width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
            if (!width || !height || width * height > 16000000) throw new Error('This PNG is too large or invalid.');
            var scale = Math.min(DRAWING_WIDTH / width, DRAWING_HEIGHT / height);
            white();
            ctx.drawImage(image, (DRAWING_WIDTH - width * scale) / 2, (DRAWING_HEIGHT - height * scale) / 2, width * scale, height * scale);
            hasContent = true;
        }
        async function importFile(file) {
            if (!file || !canEdit()) return false;
            busy = true; update();
            try {
                if (file.size > MAX_PNG_BYTES) throw new Error('This PNG is too large. Choose a file smaller than 25 MB.');
                validatePNGHeader(await readBytes(file));
                var image = await decode(file);
                if (app.disposed()) return false;
                if (hasContent && !(await app.confirm('Replace this drawing?', 'Importing a PNG replaces the current drawing. Export it first if you want to keep a separate copy.'))) return false;
                if (app.disposed()) return false;
                drawImage(image); changed(true);
                return true;
            } finally { busy = false; fileInput.value = ''; update(); }
        }
        var commands = {
            newDrawing: app.command('New Drawing', function () {
                busy = true; update();
                operation = (async function () {
                try {
                    if (hasContent && !(await app.confirm('Start a new drawing?', 'The current drawing and its Undo history will be replaced. Export it first if you want to keep a copy.'))) return false;
                    if (app.disposed()) return false;
                    white(); hasContent = false; changed(true); return true;
                } finally { busy = false; update(); }
                })().catch(function (error) { app.report(error.message || 'Could not start a new drawing.', error); return false; });
                return operation;
            }, canEdit),
            importPNG: app.command('Import PNG…', function () { fileInput.value = ''; fileInput.click(); }, canEdit),
            exportPNG: app.command('Export PNG…', function () {
                busy = true; update();
                operation = (async function () {
                var targetRevision = revision, png = await blob();
                if (app.disposed()) return false;
                var url = trackURL(png), link = app.document.createElement('a');
                link.href = url; link.download = 'Sketch.png'; link.hidden = true;
                app.document.body.appendChild(link); link.click(); link.remove();
                // Keep the Blob URL alive long enough for browsers to start the download.
                app.window.setTimeout(function () { if (objectURLs.has(url)) revokeURL(url); }, 30000);
                exportedRevision = targetRevision;
                status.textContent = 'PNG export started · 1024 × 768 pixels.';
                return true;
                })().catch(function (error) { app.report(error.message || 'Could not export the PNG.', error); return false; })
                    .finally(function () { busy = false; update(); });
                return operation;
            }, canEdit),
            undo: app.command('Undo', function () { restore(history.undo()); }, function () { return canEdit() && history.canUndo(); }),
            redo: app.command('Redo', function () { restore(history.redo()); }, function () { return canEdit() && history.canRedo(); }),
            clear: app.command('Clear Drawing', function () { white(); hasContent = false; changed(false); }, function () { return canEdit() && hasContent; })
        };
        bindCommands(app, container, commands);
        app.listen(fileInput, 'change', function () {
            var file = fileInput.files && fileInput.files[0];
            operation = importFile(file).catch(function (error) { app.report(error.message || 'Could not import this PNG.', error); });
        });
        function point(event, clamp) { return canvasPoint(canvas.getBoundingClientRect(), DRAWING_WIDTH, DRAWING_HEIGHT, event.clientX, event.clientY, clamp); }
        function paintTo(next) {
            if (!next || !lastPoint) return;
            ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y); ctx.lineTo(next.x, next.y); ctx.stroke(); lastPoint = next;
        }
        app.listen(canvas, 'pointerdown', function (event) {
            if (!canEdit() || event.button !== 0 || event.isPrimary === false) return;
            var start = point(event, false); if (!start) return;
            event.preventDefault(); canvas.focus({ preventScroll: true });
            activePointer = event.pointerId; lastPoint = start;
            ctx.strokeStyle = color.value; ctx.fillStyle = color.value;
            ctx.lineWidth = Number(size.value); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.arc(start.x, start.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
            if (canvas.setPointerCapture) { try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* Window listeners are the fallback. */ } }
            update();
        });
        app.listen(app.window, 'pointermove', function (event) {
            if (activePointer === null || event.pointerId !== activePointer) return;
            event.preventDefault();
            var events = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
            if (!events.length) events = [event];
            events.forEach(function (sample) { paintTo(point(sample, true)); });
        }, { passive: false });
        function finish(event) {
            if (activePointer === null || (event && event.pointerId !== undefined && event.pointerId !== activePointer)) return;
            if (event && event.type === 'pointerup') paintTo(point(event, true));
            var pointer = activePointer; activePointer = null; lastPoint = null;
            if (canvas.releasePointerCapture) { try { if (!canvas.hasPointerCapture || canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer); } catch (error) { /* Already released. */ } }
            hasContent = true; changed(false);
        }
        app.listen(app.window, 'pointerup', finish);
        app.listen(app.window, 'pointercancel', finish);
        app.listen(canvas, 'lostpointercapture', finish);
        app.listen(app.window, 'blur', function () { finish(); });
        app.listen(app.document, 'visibilitychange', function () { if (app.document.hidden) finish(); });
        app.listen(canvas, 'keydown', function (event) {
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            var command = event.key.toLowerCase() === 'z' ? (event.shiftKey ? commands.redo : commands.undo) : event.key.toLowerCase() === 'y' ? commands.redo : null;
            if (command) { event.preventDefault(); event.stopPropagation(); command.run(); }
        });
        var ready = (async function () {
            if (!ctx) { status.textContent = 'Canvas drawing is unavailable in this browser.'; update(); return; }
            white();
            try {
                var value = await draft.load();
                if (app.disposed()) return;
                if (value) {
                    if (value.version !== 1 || !value.png || value.png.size > MAX_PNG_BYTES) throw new Error('The saved drawing draft is invalid.');
                    validatePNGHeader(await readBytes(value.png));
                    var image = await decode(value.png);
                    if (app.disposed()) return;
                    drawImage(image);
                }
                status.textContent = value ? 'Most recent drawing draft restored · 1024 × 768 pixels.' : '1024 × 768 canvas · Your latest drawing is saved after each stroke.';
            } catch (error) {
                storageWarning = true;
                if (!app.disposed()) {
                    status.textContent = 'The saved draft could not be opened. Export your drawing to keep a copy.';
                    app.report('Sketch draft storage is unavailable or its saved draft is invalid. Export PNG to keep your work.', error);
                }
            }
            if (!app.disposed()) { history.reset(capture()); initialized = true; update(); }
        })();
        update();
        return { commands: commands, ready: ready, snapshot: function () { return {}; },
            beforeClose: async function () {
                finish(); await ready; await operation; await saveQueue;
                if (revision === savedRevision || revision === exportedRevision) return true;
                return app.confirm('Close without a saved draft?', 'The latest drawing could not be saved. Cancel and use Export PNG to keep a copy, or close and lose the unsaved changes.');
            },
            dispose: function () {
                finish(); app.dispose(); objectURLs.forEach(function (url) { app.window.URL.revokeObjectURL(url); }); objectURLs.clear();
                saveQueue.finally(function () { draft.close(); });
            } };
    }

    return { createController: createController, CalculatorModel: CalculatorModel, SafariHistory: SafariHistory,
        normalizeAddress: normalizeAddress, DrawingHistory: DrawingHistory, canvasPoint: canvasPoint,
        validatePNGHeader: validatePNGHeader, DraftStore: DraftStore, HOME: HOME,
        DRAWING_WIDTH: DRAWING_WIDTH, DRAWING_HEIGHT: DRAWING_HEIGHT };
});
