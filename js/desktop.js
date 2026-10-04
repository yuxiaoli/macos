/* Local desktop shell. Application instances are independent from their Dock entries. */
(function (global) {
    'use strict';
    const SETTINGS_KEY = 'macos.web.settings.v1';
    const SESSION_KEY = 'macos.web.session.v1';
    const defaults = { appearance: 'dark', wallpaper: 'monterey', dockAutoHide: false, reducedMotion: false, clock24: false };
    const APPS = [
        { id: 'finder', name: 'Finder', width: 760, height: 480, multi: true },
        { id: 'safari', name: 'Safari', width: 760, height: 500 },
        { id: 'terminal', name: 'Terminal', width: 600, height: 400, multi: true },
        { id: 'textedit', name: 'TextEdit', width: 640, height: 460, multi: true },
        { id: 'sketch', name: 'Sketch', width: 700, height: 500 },
        { id: 'calculator', name: 'Calculator', width: 280, height: 350 },
        { id: 'settings', name: 'System Settings', width: 560, height: 490 },
        { id: 'trash', name: 'Trash', width: 600, height: 400, separator: true }
    ];
    const alias = id => ({ paint: 'sketch', calc: 'calculator' }[String(id).toLowerCase()] || String(id).toLowerCase());
    const el = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const button = (label, className, run) => {
        const element = el('button', className, label);
        element.type = 'button';
        element.addEventListener('click', run);
        return element;
    };
    const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const pathEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part, i) => part === b[i]);

    class WindowManager {
        constructor(storage) {
            this.storage = storage;
            this.windows = Object.create(null);
            this.apps = APPS;
            this.counter = 0;
            this.clock = 0;
            this.activeId = null;
            this.listeners = new Set();
            this.desktopShown = false;
            this.restoring = false;
            this.closing = false;
            this.settings = this.readSettings();
            this.applySettings();
            this.initDock();
            this.onResize = () => {
                this.activeGesture?.finish();
                this.listWindows().forEach(record => this.constrainWindow(record));
                this.persistSoon();
            };
            global.addEventListener('resize', this.onResize);
            document.addEventListener('workspacechange', () => this.persistSoon());
            global.addEventListener('pagehide', () => this.saveSession());
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveSession(); });
            this.systemScheme = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
            this.systemScheme?.addEventListener?.('change', () => this.applySettings());
            document.getElementById('desktop-files').addEventListener('pointerdown', () => this.focusDesktop());
        }
        get activeWindow() { return this.windows[this.activeId] || null; }
        get activeApp() { return this.activeWindow?.name || 'Finder'; }
        listWindows() { return Object.values(this.windows); }
        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
        emit() {
            this.updateDock();
            this.listeners.forEach(listener => listener(this));
            document.dispatchEvent(new CustomEvent('wmchange', { detail: this }));
            this.persistSoon();
        }
        readJSON(key) {
            try {
                const raw = this.storage?.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                this.storageWarnings = this.storageWarnings || [];
                this.storageWarnings.push('Some saved desktop preferences could not be read. Your files have not been changed.');
                return null;
            }
        }
        readSettings() {
            const saved = this.readJSON(SETTINGS_KEY);
            return this.validateSettings(saved?.version === 1 ? saved.settings : {});
        }
        validateSettings(settings) {
            const value = { ...defaults };
            if (settings && typeof settings === 'object') {
                if (['dark', 'light', 'system'].includes(settings.appearance)) value.appearance = settings.appearance;
                if (['monterey', 'sunset', 'midnight', 'ocean'].includes(settings.wallpaper)) value.wallpaper = settings.wallpaper;
                ['dockAutoHide', 'reducedMotion', 'clock24'].forEach(key => { if (typeof settings[key] === 'boolean') value[key] = settings[key]; });
            }
            return value;
        }
        applySettings() {
            const systemDark = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)').matches : true;
            document.documentElement.dataset.appearance = this.settings.appearance === 'system' ? (systemDark ? 'dark' : 'light') : this.settings.appearance;
            document.documentElement.dataset.wallpaper = this.settings.wallpaper;
            document.documentElement.classList.toggle('reduced-motion', this.settings.reducedMotion);
            document.documentElement.classList.toggle('dock-auto-hide', this.settings.dockAutoHide);
        }
        updateSettings(patch) {
            this.activeGesture?.finish();
            this.settings = this.validateSettings({ ...this.settings, ...patch });
            this.applySettings();
            this.listWindows().forEach(record => this.constrainWindow(record));
            this.writeJSON(SETTINGS_KEY, { version: 1, settings: this.settings });
            document.dispatchEvent(new CustomEvent('settingschange', { detail: { ...this.settings } }));
            this.listWindows().filter(record => record.appId === 'settings').forEach(record => record.controller?.refresh?.());
            this.emit();
        }
        writeJSON(key, value) {
            try {
                if (!this.storage) throw new Error('Storage unavailable');
                this.storage.setItem(key, JSON.stringify(value));
                return true;
            } catch (_) {
                if (!this.storageNoticeShown) {
                    this.storageNoticeShown = true;
                    this.workspace?.report('Desktop preferences cannot be saved in this browser. Open windows still work; export important files before leaving.', true);
                }
                return false;
            }
        }
        initDock() {
            const dock = document.getElementById('dock');
            dock.replaceChildren();
            APPS.forEach(app => {
                if (app.separator) dock.append(el('span', 'dock-separator'));
                const item = button('', 'dock-item', () => this.openApp(app.id));
                item.id = 'dock-' + app.id;
                item.title = app.name;
                item.setAttribute('aria-label', app.name);
                item.dataset.app = app.id;
                const icon = el('img', 'dock-icon');
                icon.src = 'assets/icons/' + app.id + '.svg';
                icon.alt = '';
                icon.draggable = false;
                item.append(icon, el('span', 'dock-label', app.name), el('span', 'dock-dot'));
                item.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    this.dockMenu(app, item);
                });
                item.addEventListener('keydown', event => {
                    if (event.key === 'ArrowUp' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault(); this.dockMenu(app, item);
                    }
                });
                dock.append(item);
            });
        }
        updateDock() {
            APPS.forEach(app => {
                const item = document.getElementById('dock-' + app.id);
                const open = this.listWindows().some(record => record.appId === app.id);
                item?.classList.toggle('running', open);
                item?.setAttribute('aria-label', app.name + (open ? ', running' : ''));
            });
        }
        dockMenu(app, anchor) {
            document.querySelector('.dock-menu')?.remove();
            const menu = el('div', 'dock-menu');
            menu.setAttribute('role', 'menu');
            const add = (label, run) => {
                const item = button(label, '', () => { cleanup(); run(); });
                item.setAttribute('role', 'menuitem');
                menu.append(item);
            };
            const dismiss = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) cleanup(); };
            const cleanup = () => { menu.remove(); document.removeEventListener('pointerdown', dismiss); anchor.focus(); };
            this.listWindows().filter(record => record.appId === app.id).sort((a, b) => b.lastFocused - a.lastFocused).forEach(record => {
                add((record.minimized ? '◇ ' : '') + record.title, () => this.focusWindow(record.id));
            });
            add(app.multi ? (app.id === 'textedit' ? 'New Document' : 'New Window') : 'Open ' + app.name, () => this.openApp(app.id, { newWindow: true }));
            if (this.listWindows().some(record => record.appId === app.id)) add('Close All Windows', () => this.closeApp(app.id));
            menu.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); cleanup(); }
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    const items = [...menu.querySelectorAll('button')];
                    const index = items.indexOf(document.activeElement);
                    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
                }
            });
            document.body.append(menu);
            const bounds = anchor.getBoundingClientRect();
            menu.style.left = Math.max(8, Math.min(bounds.left, global.innerWidth - menu.offsetWidth - 8)) + 'px';
            menu.style.bottom = (global.innerHeight - bounds.top + 12) + 'px';
            document.addEventListener('pointerdown', dismiss);
            menu.querySelector('button')?.focus();
        }
        normalizePath(path) {
            if (Array.isArray(path)) return path.slice();
            if (typeof path === 'string') return path.split('/').filter(Boolean);
            return null;
        }
        openApp(appId, options = {}) {
            appId = alias(appId);
            const config = APPS.find(app => app.id === appId);
            if (!config) return null;
            const path = this.normalizePath(options.path);
            if (path) options = { ...options, path };
            const existing = this.listWindows().filter(record => record.appId === appId).sort((a, b) => b.lastFocused - a.lastFocused);
            if (appId === 'textedit' && path) {
                const same = existing.find(record => pathEqual(record.controller?.editor?.path, path));
                if (same) { this.focusWindow(same.id); return same; }
            }
            if (existing.length && (!config.multi || (!options.newWindow && !(appId === 'textedit' && path)))) {
                if (appId === 'finder' && path) existing[0].controller?.navigate?.(path);
                this.focusWindow(existing[0].id);
                return existing[0];
            }
            const id = 'window-' + (++this.counter);
            const offset = ((this.counter - 1) % 8) * 25;
            const record = {
                id, appId, name: config.name, title: config.name, controller: null,
                minimized: false, maximized: false, lastFocused: ++this.clock,
                bounds: this.clampBounds({ x: 64 + offset, y: 58 + offset, width: config.width, height: config.height }), restoreBounds: null
            };
            const windowElement = el('section', 'window opening');
            windowElement.id = id;
            windowElement.dataset.app = appId;
            windowElement.dataset.windowId = id;
            windowElement.setAttribute('role', 'region');
            windowElement.setAttribute('aria-label', config.name);
            const header = el('div', 'window-header');
            const lights = el('div', 'traffic-lights');
            [['close-btn', 'Close', '×', () => this.requestClose(id)], ['min-btn', 'Minimize', '−', () => this.minimizeWindow(id)], ['max-btn', 'Maximize', '+', () => this.maximizeWindow(id)]].forEach(([style, label, symbol, run]) => {
                const control = button(symbol, 't-btn ' + style, event => { event.stopPropagation(); run(); });
                control.setAttribute('aria-label', label + ' ' + config.name);
                control.title = label;
                lights.append(control);
            });
            header.append(lights, el('div', 'window-title', config.name));
            const content = el('div', 'window-content');
            content.tabIndex = -1;
            windowElement.append(header, content);
            record.element = windowElement;
            record.content = content;
            this.windows[id] = record;
            document.getElementById('windows-container').append(windowElement);
            this.applyBounds(record);
            windowElement.addEventListener('pointerdown', () => this.focusWindow(id, false));
            windowElement.addEventListener('focusin', () => { if (this.activeId !== id) this.focusWindow(id, false); });
            this.attachDrag(record, header);
            this.attachResize(record);
            header.addEventListener('dblclick', event => { if (!event.target.closest('button')) this.maximizeWindow(id); });
            try {
                if (appId === 'settings') record.controller = this.settingsController(content);
                else if (['finder', 'textedit', 'terminal', 'trash'].includes(appId)) record.controller = this.workspace.createController(appId, content, record, options);
                else record.controller = global.MacApps.createController(appId, content, record, options, {
                    wm: this, workspace: this.workspace, store: this.workspace.store,
                    report: (...args) => this.workspace.report(...args),
                    confirm: (...args) => this.workspace.confirm(...args),
                    dialog: (...args) => this.workspace.dialog(...args)
                });
            } catch (error) {
                content.replaceChildren(el('p', 'app-error', 'This window could not be opened: ' + error.message));
                record.controller = { snapshot: () => null, dispose() {} };
                this.workspace?.report(error.message, true);
            }
            this.focusWindow(id);
            setTimeout(() => windowElement.classList.remove('opening'), 220);
            this.emit();
            return record;
        }
        setTitle(id, title) {
            const record = this.windows[id];
            if (!record) return;
            record.title = String(title || record.name);
            record.element.querySelector('.window-title').textContent = record.title;
            record.element.setAttribute('aria-label', record.title);
            this.emit();
        }
        focusWindow(id, focusContent = true) {
            if (this.activeGesture && this.activeGesture.record.id !== id) this.activeGesture.finish();
            const record = this.windows[id];
            if (!record) return;
            if (this.desktopShown) {
                this.desktopShown = false;
                document.getElementById('windows-container').classList.remove('show-desktop');
                this.listWindows().forEach(other => { if (!other.minimized) other.element.removeAttribute('inert'); });
            }
            record.minimized = false;
            record.element.hidden = false;
            record.element.classList.remove('minimized');
            record.element.removeAttribute('inert');
            record.lastFocused = ++this.clock;
            this.activeId = id;
            this.listWindows().forEach(other => other.element.classList.toggle('inactive', other.id !== id));
            record.element.style.zIndex = String(100 + this.clock);
            if (focusContent && !record.element.contains(document.activeElement)) {
                if (record.controller?.focus) record.controller.focus();
                else (record.content.querySelector('.mac-calculator, .text-area, .term-input, .finder-grid') || record.content).focus({ preventScroll: true });
            }
            this.emit();
        }
        setActiveWindow(id) { this.focusWindow(id); }
        restoreWindow(id) { this.focusWindow(id); }
        focusDesktop() {
            this.activeGesture?.finish();
            this.activeId = null;
            this.listWindows().forEach(record => record.element.classList.add('inactive'));
            this.emit();
        }
        activateDesktop() { this.focusDesktop(); }
        activateRecent() {
            const next = this.listWindows().filter(record => !record.minimized).sort((a, b) => b.lastFocused - a.lastFocused)[0];
            if (next && !this.desktopShown) this.focusWindow(next.id);
            else this.focusDesktop();
        }
        async preflight(records) {
            for (const record of records) {
                try {
                    if (record.controller?.beforeClose && !await record.controller.beforeClose()) return false;
                } catch (error) { this.workspace?.report('The window could not be closed: ' + error.message, true); return false; }
            }
            return true;
        }
        removeWindow(record) {
            if (this.activeGesture?.record === record) this.activeGesture.finish();
            try { record.controller?.dispose?.(); } catch (error) { this.workspace?.report(error.message, true); }
            record.element.remove();
            delete this.windows[record.id];
            if (this.activeId === record.id) this.activeId = null;
        }
        async requestClose(id) {
            const record = this.windows[id];
            if (!record || this.closing) return false;
            this.closing = true;
            try {
                if (!await this.preflight([record])) return false;
                this.removeWindow(record);
                this.activateRecent();
                this.emit();
                return true;
            } finally { this.closing = false; }
        }
        closeWindow(id) { return this.requestClose(id); }
        async closeApp(appId) {
            if (this.closing) return false;
            appId = alias(appId);
            const records = this.listWindows().filter(record => record.appId === appId || record.name === appId);
            this.closing = true;
            try {
                if (!await this.preflight(records)) return false;
                records.forEach(record => this.removeWindow(record));
                this.activateRecent();
                this.emit();
                return true;
            } finally { this.closing = false; }
        }
        minimizeWindow(id = this.activeId) {
            if (this.activeGesture?.record.id === id) this.activeGesture.finish();
            const record = this.windows[id];
            if (!record) return;
            record.minimized = true;
            record.element.hidden = true;
            record.element.classList.add('minimized');
            record.element.setAttribute('inert', '');
            if (this.activeId === id) this.activateRecent();
            this.emit();
        }
        maximizeWindow(id = this.activeId) {
            if (this.activeGesture?.record.id === id) this.activeGesture.finish();
            const record = this.windows[id];
            if (!record) return;
            if (record.maximized) {
                record.maximized = false;
                record.bounds = this.clampBounds(record.restoreBounds || record.bounds);
            } else {
                record.restoreBounds = { ...record.bounds };
                record.maximized = true;
                record.bounds = this.availableBounds();
            }
            record.element.classList.toggle('maximized', record.maximized);
            record.element.querySelector('.max-btn').setAttribute('aria-label', (record.maximized ? 'Restore ' : 'Maximize ') + record.name);
            this.applyBounds(record);
            this.focusWindow(id, false);
            this.emit();
        }
        availableBounds() {
            const width = Math.max(240, global.innerWidth || 1024);
            const height = Math.max(180, (global.innerHeight || 768) - 32 - (this.settings.dockAutoHide ? 8 : 94));
            return { x: 0, y: 32, width, height };
        }
        clampBounds(bounds) {
            const area = this.availableBounds();
            const width = Math.min(area.width, Math.max(Math.min(280, area.width), finite(bounds?.width, 680)));
            const height = Math.min(area.height, Math.max(Math.min(200, area.height), finite(bounds?.height, 460)));
            return {
                x: Math.min(area.width - width, Math.max(0, finite(bounds?.x, 40))),
                y: Math.min(area.y + area.height - height, Math.max(area.y, finite(bounds?.y, 50))),
                width, height
            };
        }
        constrainWindow(record) {
            record.bounds = record.maximized ? this.availableBounds() : this.clampBounds(record.bounds);
            if (record.restoreBounds) record.restoreBounds = this.clampBounds(record.restoreBounds);
            this.applyBounds(record);
        }
        applyBounds(record) {
            const { x, y, width, height } = record.bounds;
            Object.assign(record.element.style, { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' });
            record.controller?.resize?.();
        }
        pointerGesture(record, target, type, direction) {
            target.addEventListener('pointerdown', event => {
                if (event.button !== 0 || (type === 'drag' && event.target.closest('button')) || record.maximized || document.querySelector('dialog[open]')) return;
                this.activeGesture?.finish();
                event.preventDefault();
                this.focusWindow(record.id, false);
                const start = { x: event.clientX, y: event.clientY, bounds: { ...record.bounds } };
                const pointerId = event.pointerId;
                try { target.setPointerCapture?.(pointerId); } catch (_) {}
                let finished = false;
                document.documentElement.classList.add('window-gesture');
                const move = next => {
                    if (next.pointerId !== pointerId || finished) return;
                    if (document.querySelector('dialog[open]') || document.visibilityState === 'hidden' || !this.windows[record.id]) { finish(); return; }
                    const dx = next.clientX - start.x;
                    const dy = next.clientY - start.y;
                    const b = { ...start.bounds };
                    if (type === 'drag') { b.x += dx; b.y += dy; }
                    else {
                        const area = this.availableBounds();
                        const minimumWidth = Math.min(280, area.width), minimumHeight = Math.min(200, area.height);
                        if (direction.includes('e')) b.width = Math.min(area.width - b.x, Math.max(minimumWidth, b.width + dx));
                        if (direction.includes('s')) b.height = Math.min(area.y + area.height - b.y, Math.max(minimumHeight, b.height + dy));
                        if (direction.includes('w')) { b.x = Math.max(0, Math.min(b.x + dx, b.x + b.width - minimumWidth)); b.width = start.bounds.x + start.bounds.width - b.x; }
                        if (direction.includes('n')) { b.y = Math.max(area.y, Math.min(b.y + dy, b.y + b.height - minimumHeight)); b.height = start.bounds.y + start.bounds.height - b.y; }
                    }
                    record.bounds = this.clampBounds(b);
                    this.applyBounds(record);
                };
                const finish = next => {
                    if (finished || (next?.pointerId !== undefined && next.pointerId !== pointerId)) return;
                    finished = true;
                    target.removeEventListener('pointermove', move);
                    target.removeEventListener('pointerup', finish);
                    target.removeEventListener('pointercancel', finish);
                    target.removeEventListener('lostpointercapture', finish);
                    global.removeEventListener('blur', finish);
                    document.removeEventListener('visibilitychange', onVisibility);
                    document.removeEventListener('focusin', onFocus);
                    modalObserver.disconnect();
                    if (this.activeGesture?.finish === finish) this.activeGesture = null;
                    try { if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId); } catch (_) {}
                    document.documentElement.classList.remove('window-gesture');
                    this.emit();
                };
                const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
                const onFocus = next => { if (!record.element.contains(next.target)) finish(); };
                // Native showModal() changes the open attribute, but does not always
                // release pointer capture (notably in Firefox). Stop before another
                // movement task can reposition a background window.
                const modalObserver = new MutationObserver(() => { if (document.querySelector('dialog[open]')) finish(); });
                modalObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
                this.activeGesture = { record, finish };
                global.addEventListener('blur', finish);
                document.addEventListener('visibilitychange', onVisibility);
                document.addEventListener('focusin', onFocus);
                target.addEventListener('pointermove', move);
                target.addEventListener('pointerup', finish);
                target.addEventListener('pointercancel', finish);
                target.addEventListener('lostpointercapture', finish);
            });
        }
        attachDrag(record, header) { this.pointerGesture(record, header, 'drag'); }
        attachResize(record) {
            ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(direction => {
                const handle = el('div', 'resize-handle resize-' + direction);
                handle.setAttribute('aria-hidden', 'true');
                record.element.append(handle);
                this.pointerGesture(record, handle, 'resize', direction);
            });
        }
        showDesktop() {
            this.desktopShown = !this.desktopShown;
            document.getElementById('windows-container').classList.toggle('show-desktop', this.desktopShown);
            this.listWindows().forEach(record => {
                if (this.desktopShown || record.minimized) record.element.setAttribute('inert', '');
                else record.element.removeAttribute('inert');
            });
            if (this.desktopShown) { this.desktopActiveId = this.activeId; this.focusDesktop(); }
            else if (this.windows[this.desktopActiveId] && !this.windows[this.desktopActiveId].minimized) this.focusWindow(this.desktopActiveId);
            else this.activateRecent();
            this.emit();
        }
        overview() {
            if (document.querySelector('.window-overview')) return;
            const records = this.listWindows().sort((a, b) => b.lastFocused - a.lastFocused);
            const previous = document.activeElement;
            const dialog = el('dialog', 'window-overview');
            dialog.setAttribute('aria-labelledby', 'overview-title');
            const heading = el('h2', '', 'Window Overview'); heading.id = 'overview-title';
            const bar = el('div', 'overview-heading');
            const close = () => { dialog.close?.(); dialog.remove(); previous?.focus?.(); };
            bar.append(heading, button('Done', 'workspace-button', close));
            dialog.append(bar, el('p', 'overview-hint', 'Choose a window to bring it to the front.'));
            const grid = el('div', 'overview-grid');
            records.forEach(record => {
                const card = button('', 'overview-card', () => { close(); this.focusWindow(record.id); });
                const icon = el('img'); icon.src = 'assets/icons/' + record.appId + '.svg'; icon.alt = '';
                card.append(icon, el('strong', '', record.title), el('span', '', record.name + (record.minimized ? ' · Minimized' : '')));
                grid.append(card);
            });
            if (!records.length) grid.append(el('p', 'overview-empty', 'No windows are open. Choose an app in the Dock to get started.'));
            dialog.append(grid);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
            document.body.append(dialog);
            if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
            (grid.querySelector('button') || bar.querySelector('button')).focus();
        }
        settingsController(container) {
            const refresh = () => {
                const focusedSetting = container.contains(document.activeElement) ? document.activeElement.dataset.setting : null;
                const panel = el('div', 'settings-app');
                const intro = el('header', 'settings-intro');
                const icon = el('img'); icon.src = 'assets/icons/settings.svg'; icon.alt = '';
                const title = el('div'); title.append(el('h1', '', 'System Settings'), el('p', '', 'Make this desktop your own.'));
                intro.append(icon, title); panel.append(intro);
                const group = el('div', 'settings-group');
                const selectRow = (label, key, choices) => {
                    const row = el('label', 'settings-row'); row.append(el('span', '', label));
                    const select = el('select');
                    select.setAttribute('aria-label', label);
                    select.dataset.setting = key;
                    choices.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; select.append(option); });
                    select.value = this.settings[key];
                    select.addEventListener('change', () => this.updateSettings({ [key]: select.value }));
                    row.append(select); group.append(row);
                };
                selectRow('Appearance', 'appearance', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Follow system']]);
                [['Automatically hide the Dock', 'dockAutoHide'], ['Reduce motion', 'reducedMotion'], ['Use a 24-hour clock', 'clock24']].forEach(([label, key]) => {
                    const row = el('label', 'settings-row'); row.append(el('span', '', label));
                    const input = el('input', 'setting-switch'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.checked = this.settings[key]; input.dataset.setting = key;
                    input.addEventListener('change', () => this.updateSettings({ [key]: input.checked }));
                    row.append(input); group.append(row);
                });
                panel.append(group, el('h2', 'settings-section-title', 'Wallpaper'));
                const wallpapers = el('div', 'wallpaper-grid');
                [['monterey', 'Monterey'], ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['midnight', 'Midnight']].forEach(([value, title]) => {
                    const choice = button('', 'wallpaper-choice ' + value, () => this.updateSettings({ wallpaper: value }));
                    choice.dataset.setting = 'wallpaper-' + value;
                    choice.title = title; choice.setAttribute('aria-label', title + ' wallpaper'); choice.setAttribute('aria-pressed', String(this.settings.wallpaper === value));
                    choice.append(el('span', '', title)); wallpapers.append(choice);
                });
                panel.append(wallpapers, el('p', 'settings-local-note', 'Files, preferences, and saved documents stay in this browser. Unsaved text drafts are not restored after leaving.'));
                container.replaceChildren(panel);
                if (focusedSetting) [...container.querySelectorAll('[data-setting]')].find(control => control.dataset.setting === focusedSetting)?.focus();
            };
            refresh();
            return { refresh, commands: {}, snapshot: () => ({}), beforeClose: () => true, dispose() {} };
        }
        captureSession() {
            const windows = [];
            this.listWindows().sort((a, b) => a.lastFocused - b.lastFocused).forEach(record => {
                let state;
                try { state = record.controller?.snapshot?.(); } catch (_) { return; }
                if (state === null || state === undefined) return;
                windows.push({ appId: record.appId, state, bounds: { ...record.bounds }, restoreBounds: record.restoreBounds, minimized: record.minimized, maximized: record.maximized, active: this.activeId === record.id });
            });
            return { version: 1, windows };
        }
        persistSoon() {
            if (this.restoring || !this.workspace) return;
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.saveSession(), 180);
        }
        saveSession() {
            if (this.restoring || !this.workspace) return;
            clearTimeout(this.saveTimer);
            return this.writeJSON(SESSION_KEY, this.captureSession());
        }
        restoreSession(session) {
            this.restoring = true;
            let active = null;
            try {
                const records = session?.version === 1 && Array.isArray(session.windows) ? session.windows.slice(0, 40) : null;
                if (!records) { this.openApp('finder', { newWindow: true, path: ['Desktop'] }); return; }
                for (const saved of records) {
                    if (!saved || typeof saved !== 'object' || !APPS.some(app => app.id === saved.appId)) continue;
                    const state = saved.state && typeof saved.state === 'object' && !Array.isArray(saved.state) ? saved.state : {};
                    if (saved.appId === 'textedit' && !Array.isArray(state.path)) continue;
                    if (Array.isArray(state.path)) {
                        try {
                            const node = this.workspace.store.read(state.path);
                            if (saved.appId === 'textedit' && node.type !== 'text') continue;
                        } catch (_) {
                            if (saved.appId === 'textedit') continue;
                            state.path = ['Desktop'];
                        }
                    }
                    const record = this.openApp(saved.appId, { ...state, state, restore: state, newWindow: true });
                    if (!record) continue;
                    record.maximized = saved.maximized === true;
                    record.restoreBounds = saved.restoreBounds ? this.clampBounds(saved.restoreBounds) : null;
                    record.bounds = record.maximized ? this.availableBounds() : this.clampBounds(saved.bounds);
                    record.element.classList.toggle('maximized', record.maximized);
                    this.applyBounds(record);
                    if (saved.minimized === true) this.minimizeWindow(record.id);
                    if (saved.active && !saved.minimized) active = record.id;
                }
                if (active) this.focusWindow(active);
                else this.activateRecent();
            } finally { this.restoring = false; this.emit(); }
        }
        async restart() {
            if (this.closing) return false;
            this.closing = true;
            try {
                const records = this.listWindows();
                if (!await this.preflight(records)) return false;
                const session = this.captureSession();
                this.restoring = true;
                records.forEach(record => this.removeWindow(record));
                this.desktopShown = false;
                document.getElementById('windows-container').classList.remove('show-desktop');
                this.restoring = false;
                this.restoreSession(session);
                this.saveSession();
                this.workspace.report('Desktop restarted. Your saved files and window layout are ready.');
                return true;
            } finally { this.restoring = false; this.closing = false; }
        }
    }
    global.MacWindowManager = WindowManager;
    global.MacDesktopApps = APPS;
    global.MacDesktopStorageKeys = { settings: SETTINGS_KEY, session: SESSION_KEY };

    function startDesktop() {
        if (!document.getElementById('desktop') || global.wm) return;
        let storage;
        try { storage = global.localStorage; } catch (_) { storage = null; }
        const manager = new WindowManager(storage);
        global.wm = manager;
        global.fileStore = new global.MacFileStore(storage);
        const workspace = new global.MacWorkspace(global.fileStore, manager);
        global.workspace = workspace;
        manager.workspace = workspace;
        if (!workspace.confirm) workspace.confirm = async (title, description) => {
            const result = await workspace.dialog(title, description, null, [{ label: 'Cancel', value: false }, { label: 'Continue', value: true, primary: true }]);
            return result === true;
        };
        workspace.createDesktop(document.getElementById('desktop-files'));
        global.menus = new global.MacMenus(manager, workspace, global.fileStore);
        manager.restoreSession(manager.readJSON(SESSION_KEY));
        if (manager.storageWarnings?.length) workspace.report(manager.storageWarnings[0], true);
        document.dispatchEvent(new CustomEvent('desktopready'));
    }
    global.startDesktop = startDesktop;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDesktop, { once: true });
    else startDesktop();
}(window));
