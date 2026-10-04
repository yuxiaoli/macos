/* Instance-scoped file controllers. Virtual files never leave this browser unless exported. */
(function (global, $) {
    'use strict';
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, i) => p === b[i]);
    const within = (path, parent) => Array.isArray(path) && parent.every((p, i) => path[i] === p);
    const moved = (path, event) => event.type === 'rename' && within(path, event.oldPath) ? event.newPath.concat(path.slice(event.oldPath.length)) : path;
    const command = (label, run, enabled, checked) => ({ label, run, enabled: enabled || (() => true), checked });

    class MacWorkspace {
        constructor(store, wm) {
            this.store = store;
            this.wm = wm;
            this.controllers = new Set();
            this.desktop = null;
            this.dialogSequence = 0;
            this.dialogQueue = Promise.resolve();
            this.trashing = false;
            this.unsubscribe = store.subscribe(event => {
                this.controllers.forEach(controller => { if (controller.onFileEvent) controller.onFileEvent(event); });
                this.changed();
            });
            this.unload = e => { if (this.getDirtyEditors().length) { e.preventDefault(); e.returnValue = ''; } };
            global.addEventListener('beforeunload', this.unload);
            this.dismissContext = e => { if (!$(e.target).closest('.workspace-context-menu').length) this.closeContextMenu(); };
            document.addEventListener('pointerdown', this.dismissContext);
        }
        createController(appId, container, record, options = {}) {
            const kinds = { finder: FinderController, textedit: TextEditorController, terminal: TerminalController, trash: TrashController };
            const Kind = kinds[String(appId).toLowerCase()];
            if (!Kind) return null;
            const controller = new Kind(this, $(container), record, options);
            this.controllers.add(controller);
            return controller;
        }
        createDesktop(container) {
            if (this.desktop) this.desktop.dispose();
            this.desktop = new FinderController(this, $(container), null, { path: ['Desktop'], desktop: true });
            this.controllers.add(this.desktop);
            return this.desktop;
        }
        getCommands(record) { return (record ? record.controller : this.desktop)?.commands || {}; }
        async command(id, record) {
            const item = this.getCommands(record)[id];
            if (!item || (typeof item.enabled === 'function' ? !item.enabled() : item.enabled === false)) return false;
            try { return await item.run(); } catch (error) { this.report(error.message, true); return false; }
        }
        changed(controller) { document.dispatchEvent(new global.CustomEvent('workspacechange', { detail: { controller } })); }
        getDirtyEditors() { return [...this.controllers].filter(c => c.editor && c.editor.dirty && !c.disposed); }
        isWithin(path, parent) { return within(path, parent); }
        button(text, title, action, className = '') {
            return $('<button type="button">').addClass('workspace-button ' + className).text(text).attr('title', title || text).on('click', action);
        }
        report(message, error = false) {
            let status = $('#workspace-notice');
            if (!status.length) status = $('<div id="workspace-notice" role="status" aria-live="polite">').appendTo('body');
            status.text(message).toggleClass('is-error', error).show();
            clearTimeout(this.noticeTimer);
            this.noticeTimer = setTimeout(() => status.fadeOut(200), 6000);
        }
        dialog(title, description, build, buttons) {
            // Native modal dialogs are serialized so independently opened windows cannot
            // compete for focus or accidentally accept one another's confirmation.
            const show = () => new Promise(resolve => {
                const previous = document.activeElement;
                const selection = previous && typeof previous.selectionStart === 'number' ? [previous.selectionStart, previous.selectionEnd, previous.selectionDirection] : null;
                const titleId = 'workspace-dialog-title-' + (++this.dialogSequence);
                const dialog = $('<dialog class="workspace-dialog">').attr('aria-labelledby', titleId);
                const form = $('<form method="dialog">').appendTo(dialog);
                $('<h2>').attr('id', titleId).text(title).appendTo(form);
                if (description) $('<p>').text(description).appendTo(form);
                const error = $('<p class="dialog-error" role="alert">');
                const fields = build ? build(form) : {};
                error.appendTo(form);
                const actions = $('<div class="dialog-actions">').appendTo(form);
                let settled = false, busy = false;
                const finish = value => {
                    if (settled) return;
                    settled = true;
                    if (typeof dialog[0].close === 'function') dialog[0].close();
                    dialog.remove();
                    if (previous && previous.isConnected) { previous.focus(); if (selection) previous.setSelectionRange(...selection); }
                    resolve(value);
                };
                buttons.forEach(item => {
                    const control = this.button(item.label, null, async () => {
                        if (busy || settled) return;
                        busy = true; actions.find('button').prop('disabled', true);
                        try { finish(item.action ? await item.action(fields) : item.value); }
                        catch (err) { error.text(err.message); busy = false; actions.find('button').prop('disabled', false); }
                    }, item.primary ? 'primary' : '');
                    if (item.primary) control.attr('data-primary', 'true');
                    actions.append(control);
                });
                form.on('submit', e => { e.preventDefault(); actions.find('[data-primary]').trigger('click'); });
                dialog.on('cancel', e => { e.preventDefault(); if (!busy) finish(null); });
                dialog.on('keydown', e => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) finish(null); }
                });
                dialog.appendTo('body');
                if (typeof dialog[0].showModal === 'function') dialog[0].showModal(); else dialog.attr('open', '').attr('aria-modal', 'true');
                const first = form.find('input, select, button').first();
                first.trigger('focus'); if (first.is('input')) first[0].select();
            });
            const pending = this.dialogQueue.then(show);
            this.dialogQueue = pending.catch(() => {});
            return pending;
        }
        confirm(title, description, label = 'Continue') {
            return this.dialog(title, description, null, [{ label: 'Cancel', value: false }, { label, value: true, primary: true }]);
        }
        nameDialog(title, initial, description, action) {
            return this.dialog(title, description, form => {
                const label = $('<label class="dialog-field">').text('Name').appendTo(form);
                const name = $('<input required maxlength="120" autocomplete="off">').val(initial).appendTo(label);
                return { name };
            }, [{ label: 'Cancel', value: null }, { label: title === 'Rename' ? 'Rename' : 'Create', primary: true, action: fields => action(fields.name.val()) }]);
        }
        closeContextMenu() { $('.workspace-context-menu').remove(); }
        contextMenu(event, controller) {
            event.preventDefault(); event.stopPropagation(); this.closeContextMenu();
            const previous = document.activeElement;
            const menu = $('<div class="workspace-menu workspace-context-menu" role="menu">').css({ position: 'fixed', left: Math.min(event.clientX, Math.max(0, global.innerWidth - 220)), top: Math.min(event.clientY, Math.max(30, global.innerHeight - 340)) }).appendTo('body');
            ['open', 'newFolder', 'newText', 'rename', 'getInfo', 'trash', 'sortName', 'sortType'].forEach(id => {
                const item = controller.commands[id]; if (!item) return;
                const enabled = typeof item.enabled === 'function' ? item.enabled() : item.enabled !== false;
                this.button(item.label, null, () => { this.closeContextMenu(); if (previous?.isConnected) previous.focus(); if (enabled) Promise.resolve(item.run()).catch(e => this.report(e.message, true)); })
                    .attr('role', 'menuitem').prop('disabled', !enabled).appendTo(menu);
            });
            menu.on('keydown', e => {
                const controls = menu.find('button:enabled');
                if (e.key === 'Escape') { e.preventDefault(); this.closeContextMenu(); if (previous?.isConnected) previous.focus(); }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = (controls.index(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length; controls.eq(next).trigger('focus'); }
            });
            menu.find('button:enabled').first().trigger('focus');
        }
        async openPath(path) {
            try {
                const item = this.store.read(path);
                if (item.type === 'folder') return this.wm.openApp('finder', { path: path.slice() });
                if (item.type !== 'text') throw new Error('This file type cannot be opened in TextEdit.');
                const existing = this.wm.listWindows().find(r => r.appId === 'textedit' && same(r.controller?.editor?.path, path));
                if (existing) { this.wm.focusWindow(existing.id); return existing; }
                return this.wm.openApp('textedit', { newWindow: true, path: path.slice() });
            } catch (error) { this.report(error.message, true); return null; }
        }
        async requestTrash(path) {
            if (this.trashing || this.store.readOnly) return false;
            this.trashing = true;
            try {
                const affected = [...this.controllers].filter(c => c.editor && within(c.editor.path, path));
                // Never discard a draft during preflight. A later Cancel aborts the
                // entire operation, including documents whose Discard was chosen.
                for (const editor of affected) if (!await editor.beforeClose()) return false;
                this.store.trash(path);
                this.report(path.at(-1) + ' moved to Trash. You can restore it from the Dock.');
                return true;
            } catch (error) { this.report(error.message, true); return false; }
            finally { this.trashing = false; }
        }
        async emptyTrash() {
            if (this.store.readOnly || !this.store.listTrash().length) return false;
            const approved = await this.dialog('Empty Trash?', 'All items in Trash will be permanently deleted. This cannot be undone.', null,
                [{ label: 'Cancel', value: false }, { label: 'Empty Trash', value: true, primary: true }]);
            if (!approved) return false;
            try { const count = this.store.emptyTrash(); this.report('Permanently deleted ' + count + ' item' + (count === 1 ? '.' : 's.')); return true; }
            catch (error) { this.report(error.message, true); return false; }
        }
        getInfo(path) {
            try {
                const item = this.store.read(path);
                const detail = item.type === 'folder' ? Object.keys(item.children).length + ' direct items' : new Blob([item.content]).size + ' bytes · ' + item.content.length + ' characters';
                return this.dialog(item.name === '/' ? 'Home — Get Info' : item.name + ' — Get Info', this.store.formatPath(path), form => {
                    $('<p>').text((item.type === 'folder' ? 'Folder' : 'Plain text document') + ' · ' + detail).appendTo(form);
                    $('<p>').text('Stored in this browser on this device.').appendTo(form);
                }, [{ label: 'Done', value: true, primary: true }]);
            } catch (error) { this.report(error.message, true); return Promise.resolve(false); }
        }
        folderChoices() {
            const choices = [];
            const visit = path => { if (path.length) choices.push(path); this.store.list(path).filter(item => item.type === 'folder').forEach(item => visit(path.concat(item.name))); };
            visit([]); return choices;
        }
        dispose() {
            this.unsubscribe(); this.controllers.forEach(c => c.dispose());
            global.removeEventListener('beforeunload', this.unload); document.removeEventListener('pointerdown', this.dismissContext);
            clearTimeout(this.noticeTimer); this.closeContextMenu();
        }
    }

    class Controller {
        constructor(workspace, container, record) { this.workspace = workspace; this.store = workspace.store; this.wm = workspace.wm; this.container = container; this.record = record; this.disposed = false; }
        button(...args) { return this.workspace.button(...args); }
        title(text) {
            if (!this.record) return;
            this.record.title = text;
            if (this.wm.setTitle) this.wm.setTitle(this.record.id, text); else $(this.record.element).find('.window-title').text(text);
        }
        changed() { this.workspace.changed(this); }
        async beforeClose() { return true; }
        snapshot() { return {}; }
        dispose() { this.disposed = true; this.workspace.controllers.delete(this); this.container.off('.workspace'); }
    }

    class FinderController extends Controller {
        constructor(workspace, container, record, options) {
            super(workspace, container, record);
            this.desktop = Boolean(options.desktop);
            this.path = this.validFolder(options.path || options.restore?.path || ['Desktop']);
            this.history = [this.path.slice()]; this.historyIndex = 0; this.selected = null; this.query = '';
            this.sort = options.restore?.sort || options.sort || 'name';
            const mutable = () => this.path.length > 0 && !this.store.readOnly;
            const selected = () => Boolean(this.selected);
            this.commands = {
                newFolder: command('New Folder', () => this.createItem('folder'), mutable),
                newText: command('New Text File', () => this.createItem('text'), mutable),
                open: command('Open', () => this.openSelected(), selected),
                rename: command('Rename…', () => this.renameSelected(), () => mutable() && selected()),
                getInfo: command('Get Info', () => this.workspace.getInfo(this.selectedPath()), selected),
                trash: command('Move to Trash', () => this.trashSelected(), () => mutable() && selected()),
                emptyTrash: command('Empty Trash…', () => this.workspace.emptyTrash(), () => !this.store.readOnly && this.store.listTrash().length > 0),
                sortName: command('Sort by Name', () => this.setSort('name'), null, () => this.sort === 'name'),
                sortType: command('Sort by Type', () => this.setSort('type'), null, () => this.sort === 'type'),
                back: command('Back', () => this.travel(-1), () => !this.desktop && this.historyIndex > 0),
                forward: command('Forward', () => this.travel(1), () => !this.desktop && this.historyIndex < this.history.length - 1),
                up: command('Enclosing Folder', () => this.navigate(this.path.slice(0, -1)), () => !this.desktop && this.path.length > 0)
            };
            this.render();
        }
        validFolder(path) { try { if (this.store.read(path).type === 'folder') return path.slice(); } catch (_) {} return ['Desktop']; }
        activate() { if (this.record) this.wm.focusWindow(this.record.id); else if (this.wm.focusDesktop) this.wm.focusDesktop(); else if (this.wm.activateDesktop) this.wm.activateDesktop(); }
        render() {
            this.container.empty();
            let main;
            if (this.desktop) main = this.container;
            else {
                const layout = $('<div class="finder-layout workspace-finder">').appendTo(this.container);
                const sidebar = $('<nav class="finder-sidebar" aria-label="Finder locations">').appendTo(layout);
                $('<div class="sidebar-heading">').text('Favorites').appendTo(sidebar);
                ['Desktop', 'Documents', 'Downloads'].forEach(name => this.button(name, 'Open ' + name, () => this.navigate([name]), 'sidebar-item').toggleClass('selected', this.path[0] === name).appendTo(sidebar));
                this.button('Trash', 'Open Trash', () => this.wm.openApp('trash'), 'sidebar-item').appendTo(sidebar);
                $('<p class="local-files-note">').text('Files are saved in this browser only. Export important documents for a backup.').appendTo(sidebar);
                main = $('<div class="finder-body">').appendTo(layout);
                const nav = $('<div class="finder-navigation">').appendTo(main);
                [['←', 'back', 'Back'], ['→', 'forward', 'Forward'], ['↑', 'up', 'Enclosing folder']].forEach(([label, id, title]) => this.button(label, title, () => this.commands[id].run()).attr({ 'aria-label': title, 'data-command': id }).appendTo(nav));
                this.location = $('<span class="finder-location">').appendTo(nav);
                this.search = $('<input class="finder-search" type="search" placeholder="Search this folder" aria-label="Search this folder">').val(this.query).on('input', e => { this.query = e.target.value; this.selected = null; this.update(); }).appendTo(nav);
                const actions = $('<div class="finder-actions">').appendTo(main);
                [['New Folder', 'newFolder'], ['New Text File', 'newText'], ['Open', 'open'], ['Rename', 'rename'], ['Get Info', 'getInfo'], ['Move to Trash', 'trash']].forEach(([label, id]) => this.button(label, null, () => this.commands[id].run()).attr('data-command', id).appendTo(actions));
            }
            this.grid = $('<div class="finder-grid" role="listbox" aria-label="Files" tabindex="0">').toggleClass('desktop-file-grid', this.desktop).appendTo(main);
            this.status = this.desktop ? $() : $('<div class="finder-status workspace-status" role="status">').appendTo(main);
            this.grid.on('keydown', e => this.keydown(e));
            this.grid.on('click', e => { if (e.target === this.grid[0]) { this.selected = null; this.activate(); this.updateSelection(); } });
            this.grid.on('contextmenu', e => { if (!$(e.target).closest('.file-item').length) { this.selected = null; this.activate(); this.updateSelection(); this.workspace.contextMenu(e, this); } });
            this.update();
        }
        setSort(sort) { this.sort = sort; this.update(); this.changed(); }
        update() {
            if (this.disposed) return;
            this.grid.empty();
            let items;
            try { items = this.store.list(this.path); } catch (_) { this.path = this.validFolder(['Desktop']); items = this.store.list(this.path); }
            items.sort((a, b) => this.sort === 'type' && a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.name.localeCompare(b.name));
            const filtered = items.filter(item => item.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
            if (!filtered.some(item => item.name === this.selected)) this.selected = null;
            if (this.location) this.location.text(this.store.formatPath(this.path)).attr('title', this.store.formatPath(this.path));
            filtered.forEach(item => {
                const entry = $('<button type="button" class="file-item" role="option">').attr({ 'aria-label': item.name, 'aria-selected': String(this.selected === item.name) }).toggleClass('selected', this.selected === item.name);
                const icon = $('<span aria-hidden="true" class="file-icon">').addClass(item.type === 'folder' ? 'folder' : 'text').appendTo(entry);
                // Inline artwork keeps file icons available offline without icon fonts.
                icon.html(item.type === 'folder' ? '<svg width="46" height="42" viewBox="0 0 46 42"><path fill="#59a7df" d="M3 6h15l5 5h20v26H3z"/><path fill="#85ccff" d="M3 14h40v23H3z"/><path fill="#b8e4ff" d="M3 14h40v3H3z"/></svg>' : '<svg width="40" height="45" viewBox="0 0 40 45"><path fill="#ecf2ff" d="M6 2h18l10 10v31H6z"/><path fill="#a8bedc" d="M24 2v10h10z"/><path stroke="#7996b5" stroke-width="2" d="M12 20h16M12 26h16M12 32h12"/></svg>');
                $('<span class="file-name">').text(item.name).appendTo(entry);
                entry.on('click focus', () => { this.selected = item.name; this.activate(); this.updateSelection(); });
                entry.on('dblclick', () => { this.selected = item.name; this.openSelected(); });
                entry.on('contextmenu', e => { this.selected = item.name; this.activate(); this.updateSelection(); this.workspace.contextMenu(e, this); });
                entry.appendTo(this.grid);
            });
            if (!filtered.length && !this.desktop) $('<p class="empty-folder">').text(this.query ? 'No matching files.' : 'This folder is empty. Create a folder or text file to get started.').appendTo(this.grid);
            this.status.text(this.store.storageWarning || `${filtered.length} of ${items.length} items · Saved on this browser`).toggleClass('is-error', Boolean(this.store.storageWarning));
            this.title((this.path.at(-1) || 'Home') + ' — Finder'); this.updateSelection();
        }
        updateSelection() {
            this.grid.children('.file-item').each((_, node) => { const chosen = $(node).attr('aria-label') === this.selected; $(node).toggleClass('selected', chosen).attr('aria-selected', String(chosen)); });
            this.container.find('[data-command]').each((_, node) => { const item = this.commands[$(node).attr('data-command')]; $(node).prop('disabled', !item.enabled()); });
            this.changed();
        }
        keydown(e) {
            const entries = this.grid.children('.file-item'), index = entries.index(e.target);
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key) && entries.length) {
                e.preventDefault(); e.stopPropagation();
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)));
                entries.eq(next).trigger('focus'); return;
            }
            if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
                e.preventDefault(); const bounds = e.target.getBoundingClientRect(); this.workspace.contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: bounds.left, clientY: bounds.bottom }, this); return;
            }
            const id = e.key === 'Enter' ? 'open' : e.key === 'F2' ? 'rename' : ['Delete', 'Backspace'].includes(e.key) ? 'trash' : null;
            if (id && this.commands[id].enabled()) { e.preventDefault(); e.stopPropagation(); this.commands[id].run(); }
        }
        navigate(path, record = true) {
            if (this.desktop) return this.workspace.openPath(path);
            try {
                if (this.store.read(path).type !== 'folder') throw new Error('This is not a folder.');
                this.path = path.slice(); this.selected = null; this.query = '';
                if (record) { this.history = this.history.slice(0, this.historyIndex + 1); this.history.push(this.path.slice()); this.historyIndex = this.history.length - 1; }
                this.render(); this.changed(); return true;
            } catch (error) { this.workspace.report(error.message, true); return false; }
        }
        travel(direction) { const next = this.historyIndex + direction; if (next >= 0 && next < this.history.length && this.navigate(this.history[next], false)) { this.historyIndex = next; this.updateSelection(); } }
        selectedPath() { return this.selected ? this.path.concat(this.selected) : this.path.slice(); }
        openSelected() { if (!this.selected) return; const path = this.selectedPath(); try { if (!this.desktop && this.store.read(path).type === 'folder') return this.navigate(path); return this.workspace.openPath(path); } catch (e) { this.workspace.report(e.message, true); } }
        async createItem(type) {
            if (!this.path.length || this.store.readOnly) return false;
            const parent = this.path.slice();
            return this.workspace.nameDialog(type === 'folder' ? 'New Folder' : 'New Text File', type === 'folder' ? 'untitled folder' : 'Untitled.txt', 'Create in ' + this.store.formatPath(parent), name => {
                const path = this.store.create(parent, name, type, ''); this.query = ''; if (this.search) this.search.val(''); this.selected = path.at(-1); this.update(); this.workspace.report('Created ' + path.at(-1)); return path;
            });
        }
        renameSelected() {
            if (!this.selected || !this.path.length || this.store.readOnly) return false;
            const path = this.selectedPath();
            return this.workspace.nameDialog('Rename', this.selected, 'Choose a new name for this item.', name => { const result = this.store.rename(path, name); this.selected = name; this.update(); this.workspace.report('Renamed to ' + name); return result; });
        }
        async trashSelected() { if (!this.selected || !this.path.length) return false; const success = await this.workspace.requestTrash(this.selectedPath()); if (success) { this.selected = null; this.update(); } return success; }
        onFileEvent(event) {
            const oldSelection = this.selected ? this.selectedPath() : null;
            if (event.type === 'rename') {
                this.path = moved(this.path, event); this.history = this.history.map(path => moved(path, event));
                if (oldSelection && same(oldSelection, event.oldPath)) this.selected = event.newPath.at(-1);
            }
            while (this.path.length) { try { if (this.store.read(this.path).type === 'folder') break; } catch (_) {} this.path.pop(); }
            if (this.desktop) this.path = ['Desktop'];
            this.update();
        }
        snapshot() { return { path: this.path.slice(), sort: this.sort }; }
    }

    class TextEditorController extends Controller {
        constructor(workspace, container, record, options) {
            super(workspace, container, record);
            const saved = options.restore || options.state || options;
            this.font = ['sans-serif', 'monospace', 'serif'].includes(saved.font) ? saved.font : 'sans-serif';
            this.size = [12, 14, 18, 24].includes(Number(saved.size)) ? Number(saved.size) : 14;
            this.editor = { path: null, content: '', savedContent: '', dirty: false, conflict: false };
            const path = options.path || saved.path;
            if (Array.isArray(path)) { try { const node = this.store.read(path); if (node.type === 'text') this.editor = { path: path.slice(), content: node.content, savedContent: node.content, dirty: false, conflict: false }; } catch (_) {} }
            this.edits = [this.editor.content]; this.editIndex = 0; this.saving = false; this.writing = false;
            this.commands = {
                newDocument: command('New Document', () => this.wm.openApp('textedit', { newWindow: true })),
                save: command('Save', () => this.save(), () => !this.store.readOnly && !this.saving),
                saveAs: command('Save As…', () => this.save(true), () => !this.store.readOnly && !this.saving),
                export: command('Export .txt', () => this.export()),
                reveal: command('Reveal in Finder', () => this.workspace.openPath(this.editor.path.slice(0, -1)), () => Boolean(this.editor.path)),
                undo: command('Undo', () => this.undo(-1), () => this.editIndex > 0),
                redo: command('Redo', () => this.undo(1), () => this.editIndex < this.edits.length - 1),
                font: command('Font…', () => this.styleDialog()),
                size: command('Font Size…', () => this.styleDialog())
            };
            this.render();
        }
        render() {
            this.container.empty(); const app = $('<div class="textedit-app">').appendTo(this.container);
            const toolbar = $('<div class="text-toolbar document-actions">').appendTo(app);
            [['New', 'newDocument'], ['Save', 'save'], ['Save As…', 'saveAs'], ['Export .txt', 'export']].forEach(([label, id]) => this.button(label, null, () => this.commands[id].run()).attr('data-command', id).prop('disabled', !this.commands[id].enabled()).appendTo(toolbar));
            const style = $('<div class="text-toolbar document-style">').appendTo(app);
            this.fontSelect = $('<select aria-label="Editor font"><option value="sans-serif">Helvetica</option><option value="monospace">Courier</option><option value="serif">Times</option></select>').val(this.font).on('change', e => { this.font = e.target.value; this.applyStyle(); }).appendTo($('<label>').text('Font ').appendTo(style));
            this.sizeSelect = $('<select aria-label="Editor font size"><option>12</option><option>14</option><option>18</option><option>24</option></select>').val(this.size).on('change', e => { this.size = Number(e.target.value); this.applyStyle(); }).appendTo($('<label>').text('Size ').appendTo(style));
            $('<span class="plain-text-note">').text('Plain text · Display settings only').appendTo(style);
            this.textarea = $('<textarea class="text-area" aria-label="Document text" spellcheck="true" placeholder="Start typing…">').val(this.editor.content).on('input', e => this.input(e.target.value)).appendTo(app);
            this.textarea.on('keydown', e => {
                if (!(e.metaKey || e.ctrlKey)) return;
                if (e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); this.save(e.shiftKey); }
                if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); this.undo(e.shiftKey ? 1 : -1); }
            });
            this.status = $('<div class="text-status workspace-status" role="status" aria-live="polite">').appendTo(app); this.applyStyle(); this.update();
        }
        applyStyle() { this.textarea.css({ 'font-family': this.font, 'font-size': this.size + 'px' }); this.changed(); }
        async styleDialog() {
            const choice = await this.workspace.dialog('Text Display', 'These settings change how plain text is displayed.', form => {
                const font = this.fontSelect.clone().val(this.font).appendTo($('<label class="dialog-field">').text('Font ').appendTo(form));
                const size = this.sizeSelect.clone().val(this.size).appendTo($('<label class="dialog-field">').text('Size ').appendTo(form)); return { font, size };
            }, [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, action: fields => ({ font: fields.font.val(), size: Number(fields.size.val()) }) }]);
            if (choice) { this.font = choice.font; this.size = choice.size; this.fontSelect.val(this.font); this.sizeSelect.val(this.size); this.applyStyle(); }
        }
        input(content) {
            if (content !== this.edits[this.editIndex]) { this.edits = this.edits.slice(0, this.editIndex + 1); this.edits.push(content); if (this.edits.length > 200) this.edits.shift(); this.editIndex = this.edits.length - 1; }
            this.editor.content = content; this.editor.dirty = content !== this.editor.savedContent; this.update();
        }
        undo(direction) {
            const next = this.editIndex + direction; if (next < 0 || next >= this.edits.length) return;
            this.editIndex = next; this.editor.content = this.edits[next]; this.editor.dirty = this.editor.content !== this.editor.savedContent;
            this.textarea.val(this.editor.content).trigger('focus'); this.update();
        }
        update(message) {
            this.title((this.editor.dirty ? '● ' : '') + (this.editor.path?.at(-1) || 'Untitled') + ' — TextEdit');
            this.status.text(message || (this.editor.conflict ? 'This file changed in another app. Your draft is preserved. Use Save As to keep your version.' : `${this.editor.dirty ? 'Unsaved changes' : this.editor.path ? 'Saved on this browser' : 'New document'} · ${this.editor.content.length} characters`)).toggleClass('is-error', Boolean(this.editor.conflict));
            this.changed();
        }
        async beforeClose() {
            if (!this.editor.dirty) return true;
            const choice = await this.workspace.dialog('Save your changes?', (this.editor.path?.at(-1) || 'Untitled') + ': your changes will be lost if you discard them.', null,
                [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard Changes', value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
            if (choice === 'discard') return true;
            if (choice === 'save') return this.save();
            return false;
        }
        async save(saveAs = false) {
            if (this.saving || this.store.readOnly || this.disposed) return false;
            this.saving = true;
            try {
                let path = this.editor.path;
                if (saveAs || !path) {
                    const choices = this.workspace.folderChoices();
                    path = await this.workspace.dialog('Save Text Document', 'Saved files are available in Finder and Terminal on this browser.', form => {
                        const name = $('<input required maxlength="120" autocomplete="off">').val(this.editor.path?.at(-1) || 'Untitled.txt').appendTo($('<label class="dialog-field">').text('Name').appendTo(form));
                        const folder = $('<select aria-label="Where">').appendTo($('<label class="dialog-field">').text('Where').appendTo(form));
                        choices.forEach((p, index) => $('<option>').val(index).text(this.store.formatPath(p)).appendTo(folder));
                        const preferred = this.editor.path ? this.editor.path.slice(0, -1) : ['Documents'];
                        const found = choices.findIndex(p => same(p, preferred)); folder.val(String(Math.max(0, found))); return { name, folder };
                    }, [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, action: fields => this.store.create(choices[Number(fields.folder.val())], fields.name.val(), 'text', this.editor.content) }]);
                    if (!path) return false;
                } else {
                    const current = this.store.read(path);
                    if (current.content !== this.editor.savedContent) { this.editor.conflict = true; throw new Error('This file changed in another app. Use Save As to keep your version.'); }
                    this.writing = true;
                    try { this.store.write(path, this.editor.content); } finally { this.writing = false; }
                }
                this.editor.path = path.slice(); this.editor.savedContent = this.editor.content; this.editor.dirty = false; this.editor.conflict = false;
                this.update(); this.workspace.report('Saved ' + this.store.formatPath(path)); return true;
            } catch (error) { this.update(error.message); this.workspace.report(error.message, true); return false; }
            finally { this.saving = false; this.changed(); }
        }
        export() {
            const blob = new Blob([this.editor.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
            const name = this.editor.path?.at(-1) || 'Untitled.txt'; link.download = /\.txt$/i.test(name) ? name : name + '.txt';
            document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        onFileEvent(event) {
            if (!this.editor.path || this.writing) return;
            if (event.type === 'rename') { this.editor.path = moved(this.editor.path, event); this.update(); return; }
            if (event.type === 'trash' && within(this.editor.path, event.path)) {
                // Keep a recoverable in-memory draft even after the underlying file is
                // trashed, including when the removal came from another controller.
                this.editor.path = null; this.editor.savedContent = ''; this.editor.dirty = this.editor.content !== ''; this.editor.conflict = false;
                this.update('The file was moved to Trash. This open copy is preserved; Save As to keep it.'); return;
            }
            if (event.type === 'write' && same(this.editor.path, event.path)) {
                const content = this.store.read(this.editor.path).content;
                if (this.editor.dirty) { this.editor.conflict = content !== this.editor.savedContent; this.update(); }
                else {
                    const start = this.textarea[0].selectionStart, end = this.textarea[0].selectionEnd;
                    this.editor.content = content; this.editor.savedContent = content; this.editor.conflict = false;
                    this.edits = [content]; this.editIndex = 0; this.textarea.val(content); this.textarea[0].setSelectionRange(Math.min(start, content.length), Math.min(end, content.length)); this.update();
                }
            }
        }
        snapshot() { return this.editor.path ? { path: this.editor.path.slice(), font: this.font, size: this.size } : null; }
    }

    class TrashController extends Controller {
        constructor(workspace, container, record, options = {}) {
            super(workspace, container, record); this.selected = null; this.sort = options.restore?.sort || 'name';
            this.commands = {
                restore: command('Restore Selected Item', () => this.restore(), () => Boolean(this.selected) && !this.store.readOnly),
                emptyTrash: command('Empty Trash…', () => workspace.emptyTrash(), () => !this.store.readOnly && this.store.listTrash().length > 0),
                sortName: command('Sort by Name', () => { this.sort = 'name'; this.render(); }, null, () => this.sort === 'name'),
                sortType: command('Sort by Type', () => { this.sort = 'type'; this.render(); }, null, () => this.sort === 'type')
            }; this.render();
        }
        render() {
            this.container.empty(); const app = $('<div class="trash-app">').appendTo(this.container);
            $('<h2>').text('Trash').appendTo(app); $('<p>').text('Restore files and folders to their original location. If that folder is gone, items return to Documents.').appendTo(app);
            this.button('Empty Trash…', null, () => this.workspace.emptyTrash()).prop('disabled', !this.commands.emptyTrash.enabled()).appendTo(app);
            const items = this.store.listTrash().sort((a, b) => this.sort === 'type' && a.node.type !== b.node.type ? (a.node.type === 'folder' ? -1 : 1) : a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase())); if (!items.some(item => item.id === this.selected)) this.selected = null;
            const list = $('<div role="listbox" aria-label="Trash items">').appendTo(app);
            if (!items.length) $('<div class="trash-empty">').text('Trash is empty.').appendTo(list);
            items.forEach(item => {
                const row = $('<div class="trash-row" role="option" tabindex="0">').attr({ 'aria-selected': String(item.id === this.selected), 'aria-label': item.name }).toggleClass('selected', item.id === this.selected).appendTo(list);
                row.on('click focus', () => { this.selected = item.id; list.children().removeClass('selected').attr('aria-selected', 'false'); row.addClass('selected').attr('aria-selected', 'true'); this.changed(); });
                row.on('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.selected = item.id; this.restore(); } });
                const info = $('<div class="trash-info">').appendTo(row); $('<strong>').text(item.name).appendTo(info); $('<small>').text(this.store.formatPath(item.originalPath)).appendTo(info);
                this.button('Restore', 'Restore ' + item.name, e => { e.stopPropagation(); this.selected = item.id; this.restore(); }).prop('disabled', this.store.readOnly).appendTo(row);
            });
            this.changed();
        }
        restore() { if (!this.selected || this.store.readOnly) return false; try { const path = this.store.restore(this.selected); this.workspace.report('Restored to ' + this.store.formatPath(path)); return true; } catch (error) { this.workspace.report(error.message, true); return false; } }
        onFileEvent() { this.render(); }
        snapshot() { return { sort: this.sort }; }
    }

    class TerminalController extends Controller {
        constructor(workspace, container, record, options) {
            super(workspace, container, record); this.terminal = new global.MacTerminal(this.store);
            const path = options.path || options.restore?.path || options.cwd || [];
            try { if (this.store.read(path).type === 'folder') this.terminal.cwd = path.slice(); } catch (_) {}
            this.history = []; this.historyIndex = 0; this.draft = ''; this.matrixTimer = null;
            this.commands = { reveal: command('Reveal in Finder', () => workspace.openPath(this.terminal.cwd)), newDocument: command('New Terminal Window', () => this.wm.openApp('terminal', { newWindow: true })) };
            this.render();
        }
        get cwd() { return this.terminal.cwd; }
        render() {
            this.container.html('<div class="terminal-app term-output"><div class="term-line">macOS Web Terminal · type help for commands</div><div class="term-line">Commands use browser files only.</div><div class="term-history"></div><div class="term-input-line"><label class="term-prompt"></label><input type="text" class="term-input" aria-label="Terminal command" autocomplete="off" spellcheck="false"></div></div>');
            this.historyElement = this.container.find('.term-history'); this.input = this.container.find('.term-input'); this.output = this.container.find('.term-output');
            this.container.on('click.workspace', e => { if (!$(e.target).is('button') && !global.getSelection().toString()) this.input.trigger('focus'); });
            this.container.on('keydown.workspace', e => { if (e.key === 'Escape' && this.matrixTimer) { e.preventDefault(); e.stopPropagation(); this.stopMatrix(); } });
            this.input.on('keydown', async e => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault(); if (this.historyIndex === this.history.length) this.draft = this.input.val();
                    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (e.key === 'ArrowUp' ? -1 : 1)));
                    this.input.val(this.historyIndex === this.history.length ? this.draft : this.history[this.historyIndex]); return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault(); await this.run(this.input.val());
            });
            this.updatePrompt();
        }
        prompt() { return 'guest@macbook ' + this.store.formatPath(this.cwd) + ' %'; }
        updatePrompt() { this.container.find('.term-prompt').text(this.prompt()); this.title((this.cwd.at(-1) || 'Home') + ' — Terminal'); this.changed(); }
        line(text) { $('<div class="term-line">').text(text).appendTo(this.historyElement); }
        async run(commandText) {
            this.input.val(''); if (commandText) { this.history.push(commandText); this.historyIndex = this.history.length; this.draft = ''; }
            this.line(this.prompt() + ' ' + commandText); const result = this.terminal.run(commandText);
            if (result.action === 'clear') this.historyElement.empty(); else if (result.action === 'matrix') this.matrix(); else if (result.action === 'open') await this.workspace.openPath(result.path);
            if (result.output) this.line(result.output); this.updatePrompt(); this.output.scrollTop(this.output[0].scrollHeight); return result;
        }
        stopMatrix() { if (this.matrixTimer) clearInterval(this.matrixTimer); this.matrixTimer = null; this.container.find('.matrix-overlay').remove(); if (!this.disposed) this.input.trigger('focus'); }
        matrix() {
            this.stopMatrix(); const overlay = $('<div class="matrix-overlay">').appendTo(this.output);
            const canvas = $('<canvas aria-label="Matrix animation">').appendTo(overlay)[0]; this.button('Exit Matrix (Esc)', null, () => this.stopMatrix()).appendTo(overlay);
            canvas.width = this.output.innerWidth() || 600; canvas.height = this.output.innerHeight() || 300;
            const ctx = canvas.getContext('2d'); if (!ctx) { this.workspace.report('Canvas animation is unavailable in this browser.', true); this.stopMatrix(); return; }
            const drops = Array.from({ length: Math.ceil(canvas.width / 10) }, () => 1);
            this.matrixTimer = setInterval(() => { ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#0f0'; ctx.font = '10px monospace'; drops.forEach((drop, i) => { ctx.fillText(Math.random() < .5 ? '0' : '1', i * 10, drop * 10); drops[i] = drop * 10 > canvas.height && Math.random() > .975 ? 0 : drop + 1; }); }, 33);
            overlay.find('button').trigger('focus');
        }
        onFileEvent(event) {
            const before = this.cwd.slice(); this.terminal.cwd = moved(this.cwd, event);
            while (this.cwd.length) { try { if (this.store.read(this.cwd).type === 'folder') break; } catch (_) {} this.cwd.pop(); }
            if (!same(before, this.cwd)) { if (event.type !== 'rename') this.line('Current folder is no longer available. Moved to ' + this.store.formatPath(this.cwd) + '.'); this.updatePrompt(); }
        }
        snapshot() { return { path: this.cwd.slice() }; }
        dispose() { super.dispose(); this.stopMatrix(); this.input.off(); }
    }
    global.MacWorkspace = MacWorkspace;
})(window, window.jQuery);
