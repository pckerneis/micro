class MicroApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.parser = new GraphParser();
        this.editor = null;
        this.isInitialized = false;
    }

    async init() {
        try {
            // Initialize audio engine
            const audioInitialized = await this.audioEngine.init();
            if (!audioInitialized) {
                this.log('Failed to initialize audio engine', 'error');
                return;
            }

            // Initialize CodeMirror editor
            this.initEditor();
            
            // Setup event listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.log('Micro initialized successfully!', 'success');
            this.updateStatus('Ready');
        } catch (error) {
            this.log(`Initialization error: ${error.message}`, 'error');
        }
    }

    initEditor() {
        const textarea = document.getElementById('editor');
        
        // Load saved code from localStorage
        const savedCode = localStorage.getItem('micro-code');
        if (savedCode) {
            textarea.value = savedCode;
        }
        
        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'javascript',
            theme: 'monokai',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            extraKeys: {
                'Ctrl-Enter': () => this.executeCode(),
                'Cmd-Enter': () => this.executeCode(),
                'Ctrl-S': (cm) => {
                    this.saveCode();
                    return false; // Prevent browser save dialog
                },
                'Cmd-S': (cm) => {
                    this.saveCode();
                    return false; // Prevent browser save dialog
                }
            }
        });

        // Auto-save to localStorage on change (but don't execute)
        let saveTimeout;
        this.editor.on('change', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                this.autoSaveCode();
            }, 1000); // Auto-save after 1 second of inactivity
        });
        
        // Load saved code into editor if available
        if (savedCode) {
            this.editor.setValue(savedCode);
        }
    }

    setupEventListeners() {
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');

        playBtn.addEventListener('click', () => this.play());
        stopBtn.addEventListener('click', () => this.stop());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.executeCode();
            }
            if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.togglePlayback();
            }
        });
    }

    executeCode() {
        if (!this.isInitialized) return;

        const code = this.editor.getValue();
        this.log('Parsing code...', 'info');
        
        // Step 1: Parse code with GraphParser (decoupled from audio engine)
        const parsedGraph = this.parser.parse(code);
        
        if (parsedGraph.errors.length > 0) {
            parsedGraph.errors.forEach(error => {
                this.log(error, 'error');
            });
            return;
        }
        
        this.log('Code parsed successfully!', 'success');
        this.log(`Parsed ${parsedGraph.nodes.size} nodes, ${parsedGraph.connections.length} connections, ${parsedGraph.patterns.size} patterns`, 'info');
        
        // Step 2: Apply parsed graph to audio engine via GraphAdapter
        this.log('Applying to audio engine...', 'info');
        const integrationResult = this.audioEngine.applyParsedGraph(parsedGraph);
        
        if (integrationResult.success) {
            this.log('Integration successful!', 'success');
            const instrumentCount = this.audioEngine.instruments.size;
            const patternCount = this.audioEngine.patterns.size;
            this.log(`Loaded ${instrumentCount} instruments, ${patternCount} patterns`, 'info');
        } else {
            integrationResult.errors.forEach(error => {
                this.log(error, 'error');
            });
        }
    }

    saveCode() {
        const code = this.editor.getValue();
        localStorage.setItem('micro-code', code);
        this.log('Code saved! Parsing...', 'info');
        this.executeCode();
    }

    autoSaveCode() {
        const code = this.editor.getValue();
        localStorage.setItem('micro-code', code);
        // Don't log auto-saves to avoid spam
    }

    async play() {
        if (!this.isInitialized) return;

        try {
            // Execute code first
            this.executeCode();
            
            // Start playback
            this.audioEngine.play();
            this.updateStatus('Playing');
            this.log('Playback started', 'success');
            
            // Update UI
            document.getElementById('playBtn').textContent = '⏸ Pause';
        } catch (error) {
            this.log(`Playback error: ${error.message}`, 'error');
        }
    }

    stop() {
        this.audioEngine.stop();
        this.updateStatus('Stopped');
        this.log('Playback stopped', 'info');
        
        // Update UI
        document.getElementById('playBtn').textContent = '▶ Play';
    }

    togglePlayback() {
        if (this.audioEngine.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    log(message, type = 'info') {
        const console = document.getElementById('console');
        const line = document.createElement('div');
        line.className = `console-line ${type}`;
        line.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        console.appendChild(line);
        console.scrollTop = console.scrollHeight;
    }

    updateStatus(status) {
        document.getElementById('status').textContent = status;
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    const app = new MicroApp();
    await app.init();
    
    // Make app globally available for debugging
    window.microApp = app;
});
