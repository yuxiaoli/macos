/* Persistent, transaction-safe filesystem shared by Finder, TextEdit and Terminal. */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MacFileStore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var STORAGE_KEY = 'macos.web.filesystem.v1';
    var VERSION = 1;
    var MAX_CONTENT_BYTES = 1024 * 1024;
    var MAX_STORE_BYTES = 4 * 1024 * 1024;
    var MAX_NAME_LENGTH = 120;
    var MAX_DEPTH = 64;
    var MAX_NODES = 5000;
    var ROOT_FOLDERS = ['Desktop', 'Documents', 'Downloads'];
    var hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

    function failure(message, code) {
        var error = new Error(message);
        error.code = code || 'EINVAL';
        return error;
    }

    // Counts UTF-8 bytes, including replacement characters for lone surrogates.
    function byteLength(text) {
        var bytes = 0;
        for (var i = 0; i < text.length; i += 1) {
            var code = text.charCodeAt(i);
            if (code < 0x80) bytes += 1;
            else if (code < 0x800) bytes += 2;
            else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
                text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
                bytes += 4;
                i += 1;
            } else bytes += 3;
        }
        return bytes;
    }

    function validateName(name) {
        if (typeof name !== 'string' || !name.trim()) throw failure('Enter a non-empty file or folder name.');
        if (name === '.' || name === '..') throw failure('The names . and .. are reserved.');
        if (/[\\/\x00-\x1F\x7F-\x9F]/.test(name)) throw failure('Names cannot contain slashes, backslashes or control characters.');
        if (name.length > MAX_NAME_LENGTH) throw failure('Names must be 120 characters or fewer.');
        if (/^(?:__proto__|prototype|constructor)$/i.test(name)) throw failure('That name is reserved.');
        return name;
    }

    function validateContent(content) {
        if (typeof content !== 'string') throw failure('Text file content must be a string.');
        if (byteLength(content) > MAX_CONTENT_BYTES) throw failure('Text files must be 1 MB or smaller.', 'EFBIG');
        return content;
    }

    function validatePath(path) {
        if (!Array.isArray(path)) throw failure('A file path must be an array of names.');
        if (path.length > MAX_DEPTH) throw failure('This path has too many nested folders.', 'EDEPTH');
        for (var i = 0; i < path.length; i += 1) validateName(path[i]);
        return path.slice();
    }

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function exactKeys(value, expected) {
        if (!isRecord(value) || Object.keys(value).length !== expected.length ||
            expected.some(function (key) { return !hasOwn(value, key); })) {
            throw failure('The saved filesystem has an invalid structure.');
        }
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function folder(children) {
        return { type: 'folder', children: children || {} };
    }

    function seed() {
        return {
            version: VERSION,
            root: folder({
                Desktop: folder({
                    'Welcome.txt': { type: 'text', content: 'Welcome to macOS Web Edition!\nCreate and edit files in Finder, TextEdit or Terminal.\nYour files are saved in this browser on this device.' },
                    Project: folder()
                }),
                Documents: folder({ 'notes.txt': { type: 'text', content: 'Buy milk\nFinish code' } }),
                Downloads: folder({ 'Readme.txt': { type: 'text', content: 'Downloaded text files can be exported from TextEdit.\nFiles in this desktop are stored locally in your browser.' } })
            }),
            trash: [],
            nextTrashId: 1
        };
    }

    function validateState(state) {
        exactKeys(state, ['version', 'root', 'trash', 'nextTrashId']);
        if (state.version !== VERSION) throw failure('This filesystem version is not supported.');
        if (!Number.isSafeInteger(state.nextTrashId) || state.nextTrashId < 1) throw failure('The saved Bin counter is invalid.');
        if (!Array.isArray(state.trash)) throw failure('The saved Bin is invalid.');
        var count = 0;
        function visit(node, depth) {
            count += 1;
            if (count > MAX_NODES) throw failure('The filesystem contains too many files.', 'ENOSPC');
            if (depth > MAX_DEPTH) throw failure('The filesystem has too many nested folders.', 'EDEPTH');
            if (!isRecord(node)) throw failure('A saved file is invalid.');
            if (node.type === 'text') {
                exactKeys(node, ['type', 'content']);
                validateContent(node.content);
            } else if (node.type === 'folder') {
                exactKeys(node, ['type', 'children']);
                if (!isRecord(node.children)) throw failure('A saved folder is invalid.');
                Object.keys(node.children).forEach(function (name) {
                    validateName(name);
                    visit(node.children[name], depth + 1);
                });
            } else throw failure('A saved file has an unsupported type.');
        }
        visit(state.root, 0);
        if (state.root.type !== 'folder') throw failure('The home folder is invalid.');
        var roots = Object.keys(state.root.children);
        if (roots.length !== ROOT_FOLDERS.length || ROOT_FOLDERS.some(function (name) {
            return !hasOwn(state.root.children, name) || state.root.children[name].type !== 'folder';
        })) throw failure('The Desktop, Documents and Downloads folders are required.');
        var ids = new Set();
        state.trash.forEach(function (entry) {
            exactKeys(entry, ['id', 'name', 'originalPath', 'node', 'deletedAt']);
            if (typeof entry.id !== 'string' || !/^trash-[1-9]\d*$/.test(entry.id)) throw failure('A saved Bin item ID is invalid.');
            var sequence = Number(entry.id.slice(6));
            if (!Number.isSafeInteger(sequence) || sequence >= state.nextTrashId || ids.has(entry.id)) throw failure('A saved Bin item ID is invalid.');
            ids.add(entry.id);
            var path = validatePath(entry.originalPath);
            if (path.length < 2 || ROOT_FOLDERS.indexOf(path[0]) === -1 || path[path.length - 1] !== entry.name) throw failure('A saved Bin path is invalid.');
            validateName(entry.name);
            if (typeof entry.deletedAt !== 'string' || !Number.isFinite(Date.parse(entry.deletedAt))) throw failure('A saved Bin date is invalid.');
            visit(entry.node, path.length);
        });
        return state;
    }

    function lookup(state, path) {
        var node = state.root;
        for (var i = 0; i < path.length; i += 1) {
            if (node.type !== 'folder') throw failure('Not a folder: /' + path.slice(0, i).join('/'), 'ENOTDIR');
            if (!hasOwn(node.children, path[i])) throw failure('File or folder not found: /' + path.join('/'), 'ENOENT');
            node = node.children[path[i]];
        }
        return node;
    }

    function parentFolder(state, path) {
        var node = lookup(state, path);
        if (node.type !== 'folder') throw failure('Not a folder: /' + path.join('/'), 'ENOTDIR');
        return node;
    }

    function assertMutable(path) {
        if (path.length < 2) throw failure('The home, Desktop, Documents and Downloads folders cannot be changed.', 'EPERM');
    }

    function publicNode(name, node) {
        var result = copy(node);
        result.name = name;
        return result;
    }

    function storageFailure(error) {
        var full = error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
        return failure(full ? 'Changes were not saved: browser storage is full. Free up browser storage and try again.' :
            'Changes were not saved: browser storage is unavailable. Check browser storage permissions and try again.', full ? 'ENOSPC' : 'EIO');
    }

    function MacFileStore(storage) {
        this._listeners = new Set();
        this._state = seed();
        this._storage = null;
        this._raw = null;
        this._readOnly = false;
        this.storageWarning = null;
        try {
            this._storage = arguments.length ? storage : globalThis.localStorage;
            if (!this._storage || typeof this._storage.getItem !== 'function' || typeof this._storage.setItem !== 'function') throw new Error('Storage is not available.');
            this._raw = this._storage.getItem(STORAGE_KEY);
            if (this._raw !== null && typeof this._raw !== 'string') throw new Error('Storage returned an invalid value.');
        } catch (error) {
            this._readOnly = true;
            this.storageWarning = 'Browser storage could not be read. Sample files are read-only so existing files are not overwritten. Reload after enabling browser storage.';
            return;
        }
        if (this._raw !== null) {
            try {
                if (byteLength(this._raw) > MAX_STORE_BYTES) throw new Error('Saved files exceed the size limit.');
                this._state = validateState(JSON.parse(this._raw));
            } catch (error) {
                this._readOnly = true;
                this.storageWarning = 'Saved files could not be loaded: ' + error.message + ' Sample files are read-only; the original saved data has been preserved.';
            }
            return;
        }
        try {
            var serialized = JSON.stringify(this._state);
            this._storage.setItem(STORAGE_KEY, serialized);
            this._raw = serialized;
        } catch (error) {
            this.storageWarning = storageFailure(error).message;
        }
    }

    Object.defineProperty(MacFileStore.prototype, 'readOnly', {
        get: function () { return this._readOnly; }
    });

    MacFileStore.prototype._change = function (type, mutate) {
        if (this._readOnly) throw failure(this.storageWarning || 'This filesystem is read-only.', 'EROFS');
        var latest;
        try { latest = this._storage.getItem(STORAGE_KEY); }
        catch (error) {
            var readError = storageFailure(error);
            this.storageWarning = readError.message;
            throw readError;
        }
        if (latest !== this._raw) {
            this.storageWarning = 'Files changed in another tab. Reload this page before making changes so those files are not overwritten.';
            throw failure(this.storageWarning, 'ESTALE');
        }
        var candidate = copy(this._state);
        var result = mutate(candidate);
        validateState(candidate);
        var serialized = JSON.stringify(candidate);
        if (byteLength(serialized) > MAX_STORE_BYTES) throw failure('Changes were not saved: the filesystem is larger than the 4 MB limit.', 'ENOSPC');
        try { this._storage.setItem(STORAGE_KEY, serialized); }
        catch (error) {
            var writeError = storageFailure(error);
            this.storageWarning = writeError.message;
            throw writeError;
        }
        this._state = candidate;
        this._raw = serialized;
        this.storageWarning = null;
        // An observer failure must never turn a successful save into a reported failure.
        Array.from(this._listeners).forEach(function (listener) {
            try { listener({ type: type }); } catch (error) { /* The committed state is already safe. */ }
        });
        return result;
    };

    MacFileStore.prototype.read = function (path) {
        path = validatePath(path);
        return publicNode(path.length ? path[path.length - 1] : '/', lookup(this._state, path));
    };

    MacFileStore.prototype.list = function (path) {
        path = validatePath(path);
        var children = parentFolder(this._state, path).children;
        return Object.keys(children).map(function (name) { return publicNode(name, children[name]); }).sort(function (a, b) {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            var lowerA = a.name.toLowerCase();
            var lowerB = b.name.toLowerCase();
            if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
    };

    MacFileStore.prototype.create = function (parentPath, name, type, content) {
        parentPath = validatePath(parentPath);
        name = validateName(name);
        type = type === undefined ? 'text' : type;
        if (type !== 'text' && type !== 'folder') throw failure('Only text files and folders can be created.');
        content = content === undefined ? '' : content;
        if (type === 'text') validateContent(content);
        if (!parentPath.length) throw failure('Create files inside Desktop, Documents or Downloads.', 'EPERM');
        var path = validatePath(parentPath.concat(name));
        return this._change('create', function (state) {
            var parent = parentFolder(state, parentPath);
            if (hasOwn(parent.children, name)) throw failure('A file or folder with that name already exists.', 'EEXIST');
            parent.children[name] = type === 'folder' ? folder() : { type: 'text', content: content };
            return path;
        });
    };

    MacFileStore.prototype.write = function (path, content) {
        path = validatePath(path);
        content = validateContent(content);
        return this._change('write', function (state) {
            var node = lookup(state, path);
            if (node.type !== 'text') throw failure('Only text files can be edited.', 'EISDIR');
            node.content = content;
            return path;
        });
    };

    MacFileStore.prototype.rename = function (path, newName) {
        path = validatePath(path);
        assertMutable(path);
        newName = validateName(newName);
        var parentPath = path.slice(0, -1);
        var oldName = path[path.length - 1];
        return this._change('rename', function (state) {
            var node = lookup(state, path);
            var parent = parentFolder(state, parentPath);
            if (newName !== oldName && hasOwn(parent.children, newName)) throw failure('A file or folder with that name already exists.', 'EEXIST');
            if (newName !== oldName) {
                parent.children[newName] = node;
                delete parent.children[oldName];
            }
            return parentPath.concat(newName);
        });
    };

    MacFileStore.prototype.trash = function (path) {
        path = validatePath(path);
        assertMutable(path);
        return this._change('trash', function (state) {
            var node = lookup(state, path);
            var name = path[path.length - 1];
            var id = 'trash-' + state.nextTrashId;
            state.nextTrashId += 1;
            state.trash.push({ id: id, name: name, originalPath: path, node: node, deletedAt: new Date().toISOString() });
            delete parentFolder(state, path.slice(0, -1)).children[name];
            return id;
        });
    };

    MacFileStore.prototype.listTrash = function () {
        return copy(this._state.trash).reverse();
    };

    function availableRestoreName(children, name, type) {
        if (!hasOwn(children, name)) return name;
        var dot = type === 'text' ? name.lastIndexOf('.') : -1;
        var extension = dot > 0 ? name.slice(dot) : '';
        var stem = dot > 0 ? name.slice(0, dot) : name;
        for (var i = 1; i <= MAX_NODES + 1; i += 1) {
            var suffix = ' (restored ' + i + ')';
            // Extremely long extensions must also leave room for a stem and suffix.
            var safeExtension = extension.slice(0, MAX_NAME_LENGTH - suffix.length - 1);
            var candidate = stem.slice(0, MAX_NAME_LENGTH - suffix.length - safeExtension.length) + suffix + safeExtension;
            if (!hasOwn(children, candidate)) return candidate;
        }
        throw failure('A unique restored filename could not be found.', 'EEXIST');
    }

    MacFileStore.prototype.restore = function (id) {
        if (typeof id !== 'string') throw failure('Choose a valid Bin item.');
        return this._change('restore', function (state) {
            var index = state.trash.findIndex(function (entry) { return entry.id === id; });
            if (index < 0) throw failure('The Bin item was not found.', 'ENOENT');
            var entry = state.trash[index];
            var parentPath = entry.originalPath.slice(0, -1);
            var parent;
            try { parent = parentFolder(state, parentPath); }
            catch (error) {
                if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
                parentPath = ['Documents'];
                parent = parentFolder(state, parentPath);
            }
            var name = availableRestoreName(parent.children, entry.name, entry.node.type);
            parent.children[name] = entry.node;
            state.trash.splice(index, 1);
            return parentPath.concat(name);
        });
    };

    MacFileStore.prototype.subscribe = function (listener) {
        if (typeof listener !== 'function') throw failure('A filesystem listener must be a function.');
        this._listeners.add(listener);
        var listeners = this._listeners;
        return function () { listeners.delete(listener); };
    };

    MacFileStore.prototype.resolve = function (input, cwd) {
        if (typeof input !== 'string') throw failure('A path must be a string.');
        cwd = validatePath(cwd === undefined ? [] : cwd);
        if (/[\\\x00-\x1F\x7F-\x9F]/.test(input)) throw failure('Paths cannot contain backslashes or control characters.');
        var absolute = input.charAt(0) === '/';
        if (input === '~' || input.indexOf('~/') === 0) {
            absolute = true;
            input = input.slice(1);
        }
        var path = absolute ? [] : cwd;
        input.split('/').forEach(function (part) {
            if (!part || part === '.') return;
            if (part === '..') path.pop();
            else path.push(validateName(part));
        });
        return validatePath(path);
    };

    MacFileStore.prototype.formatPath = function (path) {
        return '/' + validatePath(path).join('/');
    };

    MacFileStore.STORAGE_KEY = STORAGE_KEY;
    MacFileStore.VERSION = VERSION;
    MacFileStore.MAX_CONTENT_BYTES = MAX_CONTENT_BYTES;
    MacFileStore.MAX_STORE_BYTES = MAX_STORE_BYTES;
    return MacFileStore;
}));
