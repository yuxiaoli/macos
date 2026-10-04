/* The virtual desktop's shared file workflows. Files stay in this browser. */
(function (global, $) {
    'use strict';
    class MacWorkspace {
        constructor(store, wm) {
            this.store = store;
            this.wm = wm;
            this.path = ['Desktop'];
            this.history = [this.path.slice()];
            this.historyIndex = 0;
            this.selected = null;
            this.query = '';
            this.editor = this.blankEditor();
            this.transitioning = false;
            this.terminalCleanup = null;
            store.subscribe(() => this.refreshFiles());
            $('#file-menu-button').on('click', e => { e.stopPropagation(); this.toggleFileMenu(); });
            $(document).on('click.workspace-menu', () => this.closeFileMenu());
            global.addEventListener('beforeunload', e => {
                if (this.editor.dirty) { e.preventDefault(); e.returnValue = ''; }
            });
            $(document).on('keydown.workspace', e => {
                if ($('dialog[open]').length) return;
                if (e.key === 'Escape') this.closeFileMenu();
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
                    if (wm.activeApp === 'TextEdit') { e.preventDefault(); this.newDocument(); }
                    else if (wm.activeApp === 'Finder' && e.shiftKey) { e.preventDefault(); this.createItem('folder'); }
                }
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && wm.activeApp === 'TextEdit') {
                    e.preventDefault(); this.saveEditor(e.shiftKey);
                }
            });
        }
        closeFileMenu() { $('#workspace-file-menu').remove(); $('#file-menu-button').attr('aria-expanded', 'false'); }
        toggleFileMenu() {
            if ($('#workspace-file-menu').length) { this.closeFileMenu(); return; }
            const menu = $('<div id="workspace-file-menu" role="menu" class="workspace-menu">').appendTo('body');
            const bounds = document.getElementById('file-menu-button').getBoundingClientRect();
            menu.css({ top: bounds.bottom + 5, left: bounds.left });
            $('#file-menu-button').attr('aria-expanded', 'true');
            const add = (text, action, disabled = false) => this.button(text, null, () => { this.closeFileMenu(); action(); })
                .attr('role', 'menuitem').prop('disabled', disabled).appendTo(menu);
            if (this.wm.activeApp === 'TextEdit') {
                add('New Document', () => this.newDocument());
                add('Save', () => this.saveEditor());
                add('Save As…', () => this.saveEditor(true));
                add('Export .txt', () => this.exportEditor());
            } else {
                add('Open Finder', () => this.wm.openApp('finder'));
                add('New Folder', () => this.createItem('folder'), !this.path.length);
                add('New Text File', () => this.createItem('text'), !this.path.length);
                add('Rename', () => this.renameSelected(), !this.selected || !this.path.length);
                add('Move to Trash', () => this.trashSelected(), !this.selected || !this.path.length);
            }
            menu.find('button:enabled').first().trigger('focus');
        }
        blankEditor() { return { path: null, content: '', savedContent: '', dirty: false }; }
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
            return new Promise(resolve => {
                const previous = document.activeElement;
                const dialog = $('<dialog class="workspace-dialog" aria-labelledby="workspace-dialog-title">');
                const form = $('<form method="dialog">').appendTo(dialog);
                $('<h2 id="workspace-dialog-title">').text(title).appendTo(form);
                if (description) $('<p>').text(description).appendTo(form);
                const error = $('<p class="dialog-error" role="alert">');
                const fields = build ? build(form) : {};
                error.appendTo(form);
                const actions = $('<div class="dialog-actions">').appendTo(form);
                let settled = false;
                const finish = value => {
                    if (settled) return;
                    settled = true; dialog[0].close(); dialog.remove();
                    if (previous && previous.isConnected) previous.focus();
                    resolve(value);
                };
                buttons.forEach((button, index) => {
                    const control = this.button(button.label, null, async () => {
                        try {
                            const result = button.action ? await button.action(fields) : button.value;
                            finish(result);
                        } catch (err) { error.text(err.message); }
                    }, button.primary ? 'primary' : '');
                    if (button.primary) control.attr('data-primary', 'true');
                    actions.append(control);
                });
                form.on('submit', e => { e.preventDefault(); actions.find('[data-primary]').trigger('click'); });
                dialog.on('cancel', e => { e.preventDefault(); finish(null); });
                dialog.appendTo('body'); dialog[0].showModal();
                const first = form.find('input, select').first();
                if (first.length) { first.trigger('focus'); if (first.is('input')) first[0].select(); }
            });
        }
        nameDialog(title, initial, description, action) {
            return this.dialog(title, description, form => {
                const label = $('<label class="dialog-field">').text('Name').appendTo(form);
                const name = $('<input required maxlength="120" autocomplete="off">').val(initial).appendTo(label);
                return { name };
            }, [
                { label: 'Cancel', value: null },
                { label: title === 'Rename' ? 'Rename' : 'Create', primary: true, action: fields => action(fields.name.val()) }
            ]);
        }
        refreshFiles() {
            if ($('#content-finder').length) {
                try { if (this.store.read(this.path).type !== 'folder') throw new Error(); }
                catch (_) { this.path = ['Desktop']; this.selected = null; }
                this.updateFinder();
            }
            if ($('#content-trash').length) this.renderTrash($('#content-trash'));
        }
        navigate(path, record = true) {
            try {
                const node = this.store.read(path);
                if (node.type !== 'folder') throw new Error('This is not a folder.');
                this.path = path.slice(); this.selected = null; this.query = '';
                if (record) {
                    this.history = this.history.slice(0, this.historyIndex + 1);
                    this.history.push(path.slice()); this.historyIndex = this.history.length - 1;
                }
                this.wm.openApp('finder'); this.renderFinder($('#content-finder'));
            } catch (err) { this.report(err.message, true); }
        }
        travel(direction) {
            const target = this.historyIndex + direction;
            if (target < 0 || target >= this.history.length) return;
            try { this.store.read(this.history[target]); }
            catch (_) { this.report('That folder no longer exists. Choose a location in the sidebar.', true); return; }
            this.historyIndex = target; this.navigate(this.history[target], false);
        }
        renderFinder(container) {
            container.empty();
            const layout = $('<div class="finder-layout workspace-finder">').appendTo(container);
            const sidebar = $('<nav class="finder-sidebar" aria-label="Finder locations">').appendTo(layout);
            $('<div class="sidebar-heading">').text('Favorites').appendTo(sidebar);
            ['Desktop', 'Documents', 'Downloads'].forEach(name => {
                this.button(name, 'Open ' + name, () => this.navigate([name]), 'sidebar-item')
                    .toggleClass('selected', this.path[0] === name).appendTo(sidebar);
            });
            this.button('Trash', 'Open Trash', () => this.wm.openApp('trash'), 'sidebar-item').appendTo(sidebar);
            $('<p class="local-files-note">').text('Files are saved in this browser only. Export important documents for a backup.').appendTo(sidebar);
            const main = $('<div class="finder-body">').appendTo(layout);
            const nav = $('<div class="finder-navigation">').appendTo(main);
            this.button('←', 'Back', () => this.travel(-1)).attr('aria-label', 'Back').prop('disabled', this.historyIndex === 0).appendTo(nav);
            this.button('→', 'Forward', () => this.travel(1)).attr('aria-label', 'Forward').prop('disabled', this.historyIndex === this.history.length - 1).appendTo(nav);
            this.button('↑', 'Enclosing folder', () => this.navigate(this.path.slice(0, -1))).attr('aria-label', 'Enclosing folder').prop('disabled', !this.path.length).appendTo(nav);
            $('<span id="finder-location" class="finder-location">').appendTo(nav);
            $('<input id="finder-search" type="search" placeholder="Search this folder" aria-label="Search this folder">').val(this.query).on('input', e => {
                this.query = e.target.value; this.selected = null; this.updateFinder();
            }).appendTo(nav);
            const actions = $('<div class="finder-actions">').appendTo(main);
            this.button('New Folder', null, () => this.createItem('folder')).prop('disabled', !this.path.length).appendTo(actions);
            this.button('New Text File', null, () => this.createItem('text')).prop('disabled', !this.path.length).appendTo(actions);
            this.button('Open', null, () => this.openSelected()).attr('id', 'finder-open').appendTo(actions);
            this.button('Rename', null, () => this.renameSelected()).attr('id', 'finder-rename').appendTo(actions);
            this.button('Move to Trash', null, () => this.trashSelected()).attr('id', 'finder-trash').appendTo(actions);
            $('<div class="finder-grid" id="finder-grid" role="listbox" aria-label="Files" tabindex="0">').appendTo(main).on('keydown', e => {
                const entries = $('#finder-grid .file-item');
                const index = entries.index(e.target);
                if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key) && entries.length) {
                    e.preventDefault();
                    const next = e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)));
                    entries.eq(next).trigger('focus'); return;
                }
                if (e.key === 'Enter') { e.preventDefault(); this.openSelected(); }
                if (e.key === 'F2') { e.preventDefault(); this.renameSelected(); }
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.trashSelected(); }
            });
            $('<div id="finder-status" class="workspace-status" role="status">').appendTo(main);
            this.updateFinder();
        }
        updateFinder() {
            const grid = $('#finder-grid').empty(); if (!grid.length) return;
            let items;
            try { items = this.store.list(this.path); }
            catch (err) { this.report(err.message, true); return; }
            const filtered = items.filter(item => item.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
            if (!filtered.some(item => item.name === this.selected)) this.selected = null;
            $('#finder-location').text(this.store.formatPath(this.path)).attr('title', this.store.formatPath(this.path));
            filtered.forEach(item => {
                const entry = $('<button type="button" class="file-item" role="option">').attr('aria-label', item.name)
                    .attr('aria-selected', String(this.selected === item.name)).toggleClass('selected', this.selected === item.name);
                $('<i aria-hidden="true" class="fas file-icon">').addClass(item.type === 'folder' ? 'fa-folder folder' : 'fa-file-alt text').appendTo(entry);
                $('<span class="file-name">').text(item.name).appendTo(entry);
                entry.on('click focus', () => {
                    this.selected = item.name;
                    grid.children('.file-item').removeClass('selected').attr('aria-selected', 'false');
                    entry.addClass('selected').attr('aria-selected', 'true'); this.updateSelectionButtons();
                }).on('dblclick', () => { this.selected = item.name; this.openSelected(); });
                entry.appendTo(grid);
            });
            if (!filtered.length) $('<p class="empty-folder">').text(this.query ? 'No matching files.' : 'This folder is empty. Create a folder or text file to get started.').appendTo(grid);
            $('#finder-status').text(this.store.storageWarning || `${filtered.length} of ${items.length} items · Saved on this browser`)
                .toggleClass('is-error', Boolean(this.store.storageWarning));
            this.updateSelectionButtons();
        }
        updateSelectionButtons() {
            $('#finder-open').prop('disabled', !this.selected);
            $('#finder-rename, #finder-trash').prop('disabled', !this.selected || !this.path.length);
        }
        async createItem(type, parent = this.path.slice()) {
            if (!parent.length) return;
            await this.nameDialog(type === 'folder' ? 'New Folder' : 'New Text File', type === 'folder' ? 'untitled folder' : 'Untitled.txt',
                'Create in ' + this.store.formatPath(parent), name => {
                    const path = this.store.create(parent, name, type, '');
                    this.query = ''; $('#finder-search').val(''); this.selected = path.at(-1); this.updateFinder();
                    this.report('Created ' + path.at(-1)); return path;
                });
        }
        openSelected() {
            if (this.selected) this.openPath(this.path.concat(this.selected));
        }
        async openPath(path) {
            try {
                const item = this.store.read(path);
                if (item.type === 'folder') return this.navigate(path);
                if (item.type !== 'text') return this.report('This file type cannot be opened in TextEdit.', true);
                if (this.transitioning) return;
                this.transitioning = true;
                try {
                    if (!await this.canCloseEditor()) return;
                    const latest = this.store.read(path);
                    this.editor = { path: path.slice(), content: latest.content, savedContent: latest.content, dirty: false };
                    this.wm.openApp('textedit'); this.renderTextEdit($('#content-textedit'));
                } finally { this.transitioning = false; }
            } catch (err) { this.report(err.message, true); }
        }
        async renameSelected() {
            if (!this.selected || !this.path.length) return;
            const oldPath = this.path.concat(this.selected);
            await this.nameDialog('Rename', this.selected, 'Choose a new name for this item.', name => {
                const newPath = this.store.rename(oldPath, name);
                if (this.editor.path && this.isWithin(this.editor.path, oldPath)) {
                    this.editor.path = newPath.concat(this.editor.path.slice(oldPath.length)); this.updateEditorStatus();
                }
                this.selected = name; this.updateFinder(); this.report('Renamed to ' + name); return newPath;
            });
        }
        isWithin(path, parent) { return parent.every((part, i) => path[i] === part); }
        async trashSelected() {
            if (!this.selected || !this.path.length || this.transitioning) return;
            const path = this.path.concat(this.selected);
            const affectsEditor = this.editor.path && this.isWithin(this.editor.path, path);
            this.transitioning = true;
            try {
                if (affectsEditor && !await this.canCloseEditor()) return;
                this.store.trash(path); this.selected = null;
                if (affectsEditor) { this.editor = this.blankEditor(); if ($('#content-textedit').length) this.renderTextEdit($('#content-textedit')); }
                this.updateFinder(); this.report(path.at(-1) + ' moved to Trash. You can restore it from the Dock.');
            } catch (err) { this.report(err.message, true); }
            finally { this.transitioning = false; }
        }
        renderTrash(container) {
            container.empty();
            const app = $('<div class="trash-app">').appendTo(container);
            $('<h2>').text('Trash').appendTo(app);
            $('<p>').text('Restore files and folders to their original location. If that folder is gone, items return to Documents.').appendTo(app);
            const items = this.store.listTrash();
            if (!items.length) $('<div class="trash-empty">').text('Trash is empty.').appendTo(app);
            items.forEach(item => {
                const row = $('<div class="trash-row">').appendTo(app);
                const info = $('<div class="trash-info">').appendTo(row);
                $('<strong>').text(item.name).appendTo(info);
                $('<small>').text(this.store.formatPath(item.originalPath)).appendTo(info);
                this.button('Restore', 'Restore ' + item.name, () => {
                    try { const restored = this.store.restore(item.id); this.report('Restored to ' + this.store.formatPath(restored)); }
                    catch (err) { this.report(err.message, true); }
                }).attr('aria-label', 'Restore ' + item.name).appendTo(row);
            });
        }
        renderTextEdit(container) {
            container.empty();
            const app = $('<div class="textedit-app">').appendTo(container);
            const toolbar = $('<div class="text-toolbar document-actions">').appendTo(app);
            this.button('New', 'New document', () => this.newDocument()).appendTo(toolbar);
            this.button('Save', 'Save (Command/Ctrl+S)', () => this.saveEditor()).attr('id', 'text-save').appendTo(toolbar);
            this.button('Save As…', 'Save a copy in a chosen folder', () => this.saveEditor(true)).appendTo(toolbar);
            this.button('Export .txt', 'Download a plain text copy', () => this.exportEditor()).appendTo(toolbar);
            const style = $('<div class="text-toolbar document-style">').appendTo(app);
            const fontLabel = $('<label>').text('Font ').appendTo(style);
            $('<select aria-label="Editor font"><option value="sans-serif">Helvetica</option><option value="monospace">Courier</option><option value="serif">Times</option></select>')
                .on('change', e => $('#text-area').css('font-family', e.target.value)).appendTo(fontLabel);
            const sizeLabel = $('<label>').text('Size ').appendTo(style);
            $('<select aria-label="Editor font size"><option>12</option><option selected>14</option><option>18</option><option>24</option></select>')
                .on('change', e => $('#text-area').css('font-size', e.target.value + 'px')).appendTo(sizeLabel);
            $('<span class="plain-text-note">').text('Plain text · Display settings only').appendTo(style);
            $('<textarea id="text-area" aria-label="Document text" spellcheck="true" placeholder="Start typing…">').val(this.editor.content).on('input', e => {
                this.editor.content = e.target.value; this.editor.dirty = this.editor.content !== this.editor.savedContent;
                this.updateEditorStatus();
            }).appendTo(app);
            $('<div id="text-status" class="workspace-status" role="status" aria-live="polite">').appendTo(app);
            this.updateEditorStatus();
        }
        updateEditorStatus(message) {
            const name = this.editor.path ? this.editor.path.at(-1) : 'Untitled';
            $('#win-textedit .window-title').text((this.editor.dirty ? '● ' : '') + name + ' — TextEdit');
            $('#text-status').text(message || `${this.editor.dirty ? 'Unsaved changes' : this.editor.path ? 'Saved on this browser' : 'New document'} · ${this.editor.content.length} characters`);
        }
        async newDocument() {
            if (this.transitioning) return;
            this.transitioning = true;
            try {
                if (!await this.canCloseEditor()) return;
                this.editor = this.blankEditor(); this.wm.openApp('textedit'); this.renderTextEdit($('#content-textedit'));
                $('#text-area').trigger('focus');
            } finally { this.transitioning = false; }
        }
        async canCloseEditor() {
            if (!this.editor.dirty) return true;
            const choice = await this.dialog('Save your changes?', 'Your changes will be lost if you discard them.', null, [
                { label: 'Cancel', value: 'cancel' }, { label: 'Discard Changes', value: 'discard' },
                { label: 'Save', value: 'save', primary: true }
            ]);
            if (choice === 'discard') return true;
            if (choice === 'save') return this.saveEditor();
            return false;
        }
        folderChoices() {
            const choices = [];
            const visit = path => {
                if (path.length) choices.push(path);
                this.store.list(path).filter(item => item.type === 'folder').forEach(item => visit(path.concat(item.name)));
            };
            visit([]); return choices;
        }
        async saveEditor(saveAs = false) {
            if (this.saving) return false;
            this.saving = true;
            try {
                let path = this.editor.path;
                if (saveAs || !path) {
                    const choices = this.folderChoices();
                    path = await this.dialog('Save Text Document', 'Saved files are available in Finder and Terminal on this browser.', form => {
                        const label = $('<label class="dialog-field">').text('Name').appendTo(form);
                        const name = $('<input required maxlength="120" autocomplete="off">').val(this.editor.path ? this.editor.path.at(-1) : 'Untitled.txt').appendTo(label);
                        const location = $('<label class="dialog-field">').text('Where').appendTo(form);
                        const folder = $('<select aria-label="Where">').appendTo(location);
                        choices.forEach((choice, index) => $('<option>').val(index).text(this.store.formatPath(choice)).appendTo(folder));
                        const preferred = this.editor.path ? this.editor.path.slice(0, -1) : this.path.length ? this.path : ['Documents'];
                        const found = choices.findIndex(choice => JSON.stringify(choice) === JSON.stringify(preferred));
                        folder.val(String(found < 0 ? 0 : found));
                        return { name, folder };
                    }, [
                        { label: 'Cancel', value: null },
                        { label: 'Save', primary: true, action: fields => this.store.create(choices[Number(fields.folder.val())], fields.name.val(), 'text', this.editor.content) }
                    ]);
                    if (!path) return false;
                } else {
                    const current = this.store.read(path);
                    if (current.content !== this.editor.savedContent) throw new Error('This file changed in another app. Use Save As to keep your version.');
                    this.store.write(path, this.editor.content);
                }
                this.editor.path = path.slice(); this.editor.savedContent = this.editor.content; this.editor.dirty = false;
                this.updateEditorStatus(); this.report('Saved ' + this.store.formatPath(path)); return true;
            } catch (err) { this.updateEditorStatus(err.message); this.report(err.message, true); return false; }
            finally { this.saving = false; }
        }
        exportEditor() {
            const blob = new Blob([this.editor.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url;
            link.download = this.editor.path ? this.editor.path.at(-1) : 'Untitled.txt';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        editorClosed() { this.editor = this.blankEditor(); }
        renderTerminal(container) {
            if (this.terminalCleanup) this.terminalCleanup();
            const terminal = new global.MacTerminal(this.store);
            container.html('<div class="terminal-app" id="term-output"><div class="term-line">macOS Web Terminal · type help for commands</div><div class="term-line">Commands use browser files only.</div><div id="term-history"></div><div class="term-input-line"><label class="term-prompt" for="term-input"></label><input type="text" id="term-input" aria-label="Terminal command" autocomplete="off" spellcheck="false"></div></div>');
            const history = $('#term-history'), input = $('#term-input'), output = $('#term-output');
            let commands = [], historyIndex = 0, draft = '', matrixTimer = null;
            const prompt = () => 'guest@macbook ' + this.store.formatPath(terminal.cwd) + ' %';
            const updatePrompt = () => container.find('.term-input-line .term-prompt').text(prompt());
            const line = text => $('<div class="term-line">').text(text).appendTo(history);
            const stopMatrix = () => { if (matrixTimer) clearInterval(matrixTimer); matrixTimer = null; container.find('.matrix-overlay').remove(); input.trigger('focus'); };
            const unsubscribe = this.store.subscribe(() => {
                const previous = terminal.cwd.slice();
                while (terminal.cwd.length) {
                    try { if (this.store.read(terminal.cwd).type === 'folder') break; } catch (_) { /* Move to a surviving parent. */ }
                    terminal.cwd.pop();
                }
                if (previous.length !== terminal.cwd.length) {
                    line('Current folder is no longer available. Moved to ' + this.store.formatPath(terminal.cwd) + '.');
                    updatePrompt();
                }
            });
            this.terminalCleanup = () => { unsubscribe(); stopMatrix(); $(document).off('keydown.matrix'); container.off('click.terminal'); };
            const matrix = () => {
                stopMatrix();
                const overlay = $('<div class="matrix-overlay">').appendTo(output);
                const canvas = $('<canvas aria-label="Matrix animation">').appendTo(overlay)[0];
                this.button('Exit Matrix (Esc)', null, stopMatrix).appendTo(overlay);
                canvas.width = output.innerWidth(); canvas.height = output.innerHeight();
                const ctx = canvas.getContext('2d'), drops = Array.from({ length: Math.ceil(canvas.width / 10) }, () => 1);
                matrixTimer = setInterval(() => {
                    ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#0f0'; ctx.font = '10px monospace';
                    drops.forEach((drop, i) => { ctx.fillText(Math.random() < .5 ? '0' : '1', i * 10, drop * 10); drops[i] = drop * 10 > canvas.height && Math.random() > .975 ? 0 : drop + 1; });
                }, 33);
            };
            $(document).off('keydown.matrix').on('keydown.matrix', e => { if (e.key === 'Escape' && matrixTimer) { e.preventDefault(); stopMatrix(); } });
            container.off('click.terminal').on('click.terminal', e => { if (!$(e.target).is('button') && !global.getSelection().toString()) input.trigger('focus'); });
            input.on('keydown', async e => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault(); if (historyIndex === commands.length) draft = input.val();
                    historyIndex = Math.max(0, Math.min(commands.length, historyIndex + (e.key === 'ArrowUp' ? -1 : 1)));
                    input.val(historyIndex === commands.length ? draft : commands[historyIndex]); return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault(); const command = input.val(); input.val('');
                if (command) { commands.push(command); historyIndex = commands.length; draft = ''; }
                line(prompt() + ' ' + command);
                const result = terminal.run(command);
                if (result.action === 'clear') history.empty();
                else if (result.action === 'matrix') matrix();
                else if (result.action === 'open') await this.openPath(result.path);
                if (result.output) line(result.output);
                updatePrompt(); output.scrollTop(output[0].scrollHeight);
            });
            updatePrompt(); input.trigger('focus');
        }
    }
    global.MacWorkspace = MacWorkspace;
})(window, window.jQuery);
