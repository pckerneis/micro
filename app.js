class MicroApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.parser = new MicroParser();
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
                'Cmd-Enter': () => this.executeCode()
            }
        });

        // Auto-execute on change (with debounce)
        let timeout;
        this.editor.on('change', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (this.audioEngine.isPlaying) {
                    this.executeCode();
                }
            }, 500);
        });
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
        
        const result = this.parser.parse(code, this.audioEngine);
        
        if (result.success) {
            this.log('Code parsed successfully!', 'success');
            const instrumentCount = this.audioEngine.instruments.size;
            const patternCount = this.audioEngine.patterns.size;
            this.log(`Loaded ${instrumentCount} instruments, ${patternCount} patterns`, 'info');
        } else {
            result.errors.forEach(error => {
                this.log(error, 'error');
            });
        }
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
