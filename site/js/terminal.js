(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MacTerminal = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // This is a small command interpreter, not a JavaScript or system shell.
    // Keep output as plain text; the UI must render it with textContent/.text().
    function tokenize(input) {
        const tokens = [];
        let word = '';
        let started = false;
        let quote = null;

        function flush() {
            if (started) tokens.push({ type: 'word', value: word });
            word = '';
            started = false;
        }

        for (let index = 0; index < input.length; index += 1) {
            const char = input[index];
            if (quote === "'") {
                if (char === "'") quote = null;
                else word += char;
            } else if (char === '\\') {
                if (index + 1 === input.length) throw new Error('unfinished escape');
                const next = input[index + 1];
                // Inside double quotes, retain backslashes before ordinary letters.
                if (quote === '"' && !['"', '\\', '$', '`', '\n'].includes(next)) {
                    word += char;
                } else {
                    index += 1;
                    if (next !== '\n') word += next;
                }
                started = true;
            } else if (quote === '"') {
                if (char === '"') quote = null;
                else word += char;
            } else if (char === '"' || char === "'") {
                quote = char;
                started = true;
            } else if (/\s/.test(char)) {
                flush();
            } else if (char === '>') {
                flush();
                const append = input[index + 1] === '>';
                if (append) index += 1;
                tokens.push({ type: 'redirect', value: append ? '>>' : '>' });
            } else {
                word += char;
                started = true;
            }
        }
        if (quote) throw new Error('unclosed quote');
        flush();
        return tokens;
    }

    class MacTerminal {
        constructor(store) {
            this.store = store;
            this.cwd = [];
            this.history = [];
        }

        run(commandString) {
            let command = '';
            try {
                if (typeof commandString !== 'string') throw new Error('command must be text');
                const input = commandString.trim();
                if (!input) return { output: '' };
                this.history.push(commandString);

                // Parse the original text so an escaped trailing space stays intact.
                const tokens = tokenize(commandString);
                if (!tokens.length) return { output: '' };
                if (tokens[0].type !== 'word') throw new Error('expected a command before redirection');
                command = tokens.shift().value.toLowerCase();
                const redirectIndex = tokens.findIndex(token => token.type === 'redirect');
                let redirect = null;
                if (redirectIndex !== -1) {
                    if (command !== 'echo') throw new Error('redirection is supported only with echo');
                    if (redirectIndex !== tokens.length - 2 || tokens[redirectIndex + 1].type !== 'word') {
                        throw new Error('use echo text > file or echo text >> file');
                    }
                    redirect = { mode: tokens[redirectIndex].value, target: tokens[redirectIndex + 1].value };
                    tokens.splice(redirectIndex);
                }
                const args = tokens.map(token => token.value);

                switch (command) {
                    case 'help':
                        return { output: [
                            'Available commands:',
                            '  ls [path]              List files and folders',
                            '  pwd                    Show the current folder',
                            '  cd [path]              Change folder (default: /)',
                            '  cat path               Read a text file',
                            '  mkdir path             Create a folder',
                            '  touch path             Create a text file without overwriting',
                            '  open path              Open a file or folder in the desktop',
                            '  echo text              Print text',
                            '  echo text > file       Write text to a file',
                            '  echo text >> file      Append text to a file',
                            '  clear, whoami, date, sudo, matrix',
                            'Quote paths with spaces, for example: cat "Documents/My Notes.txt".',
                            'Create files inside Desktop, Documents or Downloads.',
                            'Files are shared with Finder and TextEdit. Commands run only in this browser.'
                        ].join('\n') };
                    case 'ls': {
                        this._arity(args, 0, 1, 'ls [path]');
                        const path = args.length ? this._resolve(args[0]) : this.cwd.slice();
                        const item = this.store.read(path);
                        const items = item.type === 'folder' ? this.store.list(path) : [item];
                        return { output: items.map(entry => entry.name + (entry.type === 'folder' ? '/' : '')).join('  ') };
                    }
                    case 'pwd':
                        this._arity(args, 0, 0, 'pwd');
                        return { output: this.store.formatPath(this.cwd) };
                    case 'cd': {
                        this._arity(args, 0, 1, 'cd [path]');
                        const path = args.length ? this._resolve(args[0]) : [];
                        // Listing validates existence and directory type before changing cwd.
                        this.store.list(path);
                        this.cwd = path.slice();
                        return { output: '' };
                    }
                    case 'cat': {
                        this._arity(args, 1, 1, 'cat path');
                        const path = this._resolve(args[0]);
                        return { output: this._text(path) };
                    }
                    case 'mkdir': {
                        this._arity(args, 1, 1, 'mkdir path');
                        const path = this._resolve(args[0]);
                        this._create(path, 'folder');
                        return { output: '' };
                    }
                    case 'touch': {
                        this._arity(args, 1, 1, 'touch path');
                        const path = this._resolve(args[0]);
                        if (path.length && !this._existing(path)) this._create(path, 'text', '');
                        return { output: '' };
                    }
                    case 'open': {
                        this._arity(args, 1, 1, 'open path');
                        const path = this._resolve(args[0]);
                        this.store.read(path);
                        return { output: '', action: 'open', path: path.slice() };
                    }
                    case 'echo': {
                        const output = args.join(' ');
                        if (!redirect) return { output };
                        const path = this._resolve(redirect.target);
                        const existing = this._existing(path);
                        if (existing) {
                            // Validate the type before replacing as well as appending.
                            const previous = this._text(path);
                            this.store.write(path, (redirect.mode === '>>' ? previous : '') + output + '\n');
                        } else {
                            this._create(path, 'text', output + '\n');
                        }
                        return { output: '' };
                    }
                    case 'clear':
                        this._arity(args, 0, 0, 'clear');
                        return { output: '', action: 'clear' };
                    case 'matrix':
                        this._arity(args, 0, 0, 'matrix');
                        return { output: '', action: 'matrix' };
                    case 'whoami':
                        return { output: 'guest' };
                    case 'date':
                        return { output: new Date().toString() };
                    case 'sudo':
                        return { output: 'Password: 🔑 (Just kidding, you have no power here)' };
                    default:
                        return { output: 'zsh: command not found: ' + command };
                }
            } catch (error) {
                const message = error && typeof error.message === 'string' ? error.message : 'Command failed';
                return { output: (command || 'zsh') + ': ' + message };
            }
        }

        _arity(args, minimum, maximum, usage) {
            if (args.length < minimum || args.length > maximum) throw new Error('usage: ' + usage);
        }

        _resolve(input) {
            if (!input) throw new Error('path must not be empty');
            return this.store.resolve(input, this.cwd);
        }

        _text(path) {
            const item = this.store.read(path);
            if (item.type === 'folder') throw new Error('Is a directory: ' + this.store.formatPath(path));
            if (item.type !== 'text') throw new Error('Not a text file: ' + this.store.formatPath(path));
            return typeof item.content === 'string' ? item.content : '';
        }

        _existing(path) {
            if (!path.length) return this.store.read([]);
            // Do not treat an arbitrary failed read as "not found" and overwrite data.
            return this.store.list(path.slice(0, -1)).find(entry => entry.name === path[path.length - 1]);
        }

        _create(path, type, content) {
            if (!path.length) throw new Error('File exists: /');
            return this.store.create(path.slice(0, -1), path[path.length - 1], type, content || '');
        }
    }

    return MacTerminal;
}));
