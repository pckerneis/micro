import {AudioEngine} from './audio-engine.mjs';
import {GraphParser} from './graph-parser.mjs';

class MicroApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.parser = new GraphParser();
        this.editor = null;
        this.isInitialized = false;
        this.sampleRegistry = new Map(); // name -> AudioBuffer
    }

    async init() {
        try {
            // Initialize audio engine
            const audioInitialized = await this.audioEngine.init();
            if (!audioInitialized) {
                this.log('Failed to initialize audio engine', 'error');
                return;
            }

            // Provide an initial (empty) sample registry to the engine/builder
            this.audioEngine.setSampleRegistry(this.sampleRegistry);

            // Initialize CodeMirror editor
            this.initEditor();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Initialize master gain to default slider value (70%)
            this.setMasterGain(70);
            
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
            mode: 'micro',
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
                'Ctrl-/': 'toggleComment',
                'Cmd-/': 'toggleComment',
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
        const runBtn = document.getElementById('runBtn');
        const graphBtn = document.getElementById('graphBtn');
        const masterGainSlider = document.getElementById('masterGain');
        const volumeValue = document.getElementById('volumeValue');

        playBtn.addEventListener('click', () => this.togglePlayback());
        runBtn.addEventListener('click', () => this.executeCode());
        graphBtn.addEventListener('click', () => this.showGraph());
        
        // Start time display update interval
        this.startTimeDisplay();
        
        // Master gain control
        masterGainSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            this.setMasterGain(volume);
            volumeValue.textContent = `${volume}%`;
        });

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

        // Samples UI (drag & drop, file picker)
        this.setupSamplesUI();
    }

    async executeCode() {
        if (!this.isInitialized) return;

        const code = this.editor.getValue();
        
        if (!code.trim()) {
            this.log('No code to execute', 'warning');
            return;
        }

        this.log('Parsing code...', 'info');
        
        // Step 1: Parse code with GraphParser
        const parsedGraph = this.parser.parse(code);

        console.log({ parsedGraph })
        
        if (parsedGraph.errors.length > 0) {
            parsedGraph.errors.forEach(error => {
                this.log(error, 'error');
            });
            return;
        }
        
        this.lastParsedGraph = parsedGraph;
        
        this.log('Code parsed successfully!', 'success');
        this.log(`Parsed ${parsedGraph.nodes.size} nodes, ${parsedGraph.connections.length} connections, ${parsedGraph.patterns.size} patterns`, 'info');
        
        // Step 2: Apply parsed graph to audio engine
        this.log('Building audio graph...', 'info');
        try {
            await this.audioEngine.loadGraph(parsedGraph);
            this.log('Audio graph built successfully!', 'success');
            const routes = this.audioEngine.getRoutes();
            const patterns = this.audioEngine.getPatterns();
            this.log(`Built ${Object.keys(routes).length} routes, ${Object.keys(patterns).length} patterns`, 'info');
        } catch (error) {
            this.log(`Failed to build audio graph: ${error.message}`, 'error');
        }
        
        // Save code to localStorage
        localStorage.setItem('micro-code', code);
    }

    async saveCode() {
        const code = this.editor.getValue();
        localStorage.setItem('micro-code', code);
        this.log('Code saved! Parsing...', 'info');
        await this.executeCode();
    }

    autoSaveCode() {
        const code = this.editor.getValue();
        localStorage.setItem('micro-code', code);
    }

    async play() {
        if (!this.isInitialized) return;

        try {
            // Execute code first
            await this.executeCode();
            
            // Start playback
            await this.audioEngine.play();
            this.updateStatus('Playing');
            this.log('Playback started', 'success');
            
            // Update UI
            document.getElementById('playBtn').textContent = '⏹ Stop';
        } catch (error) {
            this.log(`Playback error: ${error.message}`, 'error');
        }
    }

    stop() {
        if (!this.isInitialized) return;
        this.audioEngine.stop();
        this.updateStatus('Stopped');
        this.log('Playback stopped', 'info');
        document.getElementById('playBtn').textContent = '▶ Play';
    }

    togglePlayback() {
        if (this.audioEngine.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    setMasterGain(volumePercent) {
        if (!this.isInitialized || !this.audioEngine.masterGain) return;
        
        this.audioEngine.masterGain.gain.value = volumePercent / 100;
    }

    /**
     * Start the time display update interval
     */
    startTimeDisplay() {
        // Update time display every 100ms
        setInterval(() => {
            this.updateTimeDisplay();
        }, 60);
    }

    /**
     * Update the time display in the UI
     */
    updateTimeDisplay() {
        if (!this.isInitialized) return;
        
        const currentTime = this.audioEngine.getCurrentTime();
        const minutes = Math.floor(currentTime / 60);
        const seconds = Math.floor(currentTime % 60);
        const milliseconds = Math.floor((currentTime % 1) * 1000);
        
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
        
        const timeElement = document.getElementById('currentTime');
        if (timeElement) {
            timeElement.textContent = timeString;
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

    /**
     * Show a temporary toast message on screen
     */
    showToast(message, durationMs = 2000) {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);
        // Trigger CSS transition reliably
        // Force reflow then add class so opacity transitions from 0 -> 1
        // This avoids cases where rAF might run before styles are applied
        void toast.offsetWidth; // reflow
        toast.classList.add('show');
        // Fallback: if still computed as transparent after a tick, set inline styles
        setTimeout(() => {
            const cs = window.getComputedStyle(toast);
            if (parseFloat(cs.opacity) === 0) {
                toast.style.opacity = '1';
                toast.style.transform = 'translateY(0)';
            }
        }, 0);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
    }

    /**
     * Setup drag-and-drop and file picker for loading audio samples
     */
    setupSamplesUI() {
        const dropzone = document.getElementById('dropzone');
        const samplesList = document.getElementById('samplesList');
        const pickBtn = document.getElementById('pickFilesBtn');
        const filePicker = document.getElementById('filePicker');

        if (!dropzone || !samplesList) return; // defensive

        // Highlight on dragover/dragenter
        const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
        ['dragenter','dragover','dragleave','drop'].forEach(evt => {
            dropzone.addEventListener(evt, prevent);
        });
        dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', async (e) => {
            dropzone.classList.remove('dragover');
            const dt = e.dataTransfer;
            const files = Array.from(dt.files || []).filter(f => f.type.startsWith('audio/'));
            if (files.length === 0) {
                this.log('No audio files dropped', 'warning');
                return;
            }
            await this.addSamplesFromFiles(files);
        });

        if (pickBtn && filePicker) {
            pickBtn.addEventListener('click', () => filePicker.click());
            filePicker.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('audio/'));
                if (files.length > 0) {
                    await this.addSamplesFromFiles(files);
                    filePicker.value = '';
                }
            });
        }
    }

    /**
     * Decode and register multiple audio files
     */
    async addSamplesFromFiles(files) {
        for (const file of files) {
            try {
                const buffer = await this.decodeFileToAudioBuffer(file);
                const name = this.generateUniqueSampleName(this.suggestNameFromFile(file.name));
                this.sampleRegistry.set(name, buffer);
                // Inform engine/builder of registry update
                this.audioEngine.setSampleRegistry(this.sampleRegistry);
                // Render UI block
                this.addSampleBlock(name, buffer);
                this.log(`Loaded sample "${name}" (${file.type}, ${(buffer.duration).toFixed(2)}s)`, 'success');
            } catch (err) {
                this.log(`Failed to load sample ${file.name}: ${err.message}`, 'error');
            }
        }
    }

    /**
     * Decode a File into an AudioBuffer using the engine's AudioContext
     */
    async decodeFileToAudioBuffer(file) {
        const arrayBuffer = await file.arrayBuffer();
        return await this.audioEngine.audioContext.decodeAudioData(arrayBuffer);
    }

    /**
     * Create and append a sample block with waveform and name
     */
    addSampleBlock(name, audioBuffer) {
        const container = document.getElementById('samplesList');
        if (!container) return;

        const item = document.createElement('div');
        item.className = 'sample-item';
        item.title = `Click to copy name: ${name}`;

        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 40;
        canvas.className = 'sample-waveform';
        this.drawWaveform(canvas, audioBuffer);

        const meta = document.createElement('div');
        meta.className = 'sample-meta';
        const nameEl = document.createElement('span');
        nameEl.className = 'sample-name';
        nameEl.textContent = name;
        const lenEl = document.createElement('span');
        lenEl.className = 'sample-len';
        lenEl.textContent = `${audioBuffer.duration.toFixed(2)}s`;
        meta.appendChild(nameEl);
        meta.appendChild(lenEl);

        item.appendChild(canvas);
        item.appendChild(meta);
        
        // Remove button (visible on hover)
        const removeBtn = document.createElement('button');
        removeBtn.className = 'sample-remove';
        removeBtn.title = 'Remove sample';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation(); // prevent triggering copy
            if (this.sampleRegistry.has(name)) {
                this.sampleRegistry.delete(name);
                this.audioEngine.setSampleRegistry(this.sampleRegistry);
            }
            item.remove();
            this.showToast(`Removed sample '${name}'`, 1800);
        });
        item.appendChild(removeBtn);

        // Copy snippet to clipboard on click
        item.addEventListener('click', async () => {
            try {
                const snippet = `sample{name='${name}'}`;
                await navigator.clipboard.writeText(snippet);
                item.classList.add('copied');
                const prev = item.dataset.tooltip;
                item.dataset.tooltip = 'Copied sample{name=...}!';
                setTimeout(() => {
                    item.classList.remove('copied');
                    if (prev !== undefined) item.dataset.tooltip = prev; else delete item.dataset.tooltip;
                }, 800);
                this.showToast(`Copied ${snippet} to clipboard`, 2000);
            } catch (e) {
                this.log('Clipboard not available', 'warning');
            }
        });

        container.appendChild(item);
    }

    /**
     * Draw a simple min/max waveform to a canvas
     */
    drawWaveform(canvas, buffer) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#2d2d30';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#9cdcfe';
        ctx.lineWidth = 1;

        const data = buffer.getChannelData(0);
        const samplesPerBucket = Math.max(1, Math.floor(data.length / width));
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
            const start = x * samplesPerBucket;
            const end = Math.min(data.length, start + samplesPerBucket);
            let min = 1.0, max = -1.0;
            for (let i = start; i < end; i++) {
                const v = data[i];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const y1 = Math.round((1 - (max + 1) / 2) * height);
            const y2 = Math.round((1 - (min + 1) / 2) * height);
            ctx.moveTo(x, y1);
            ctx.lineTo(x, y2);
        }
        ctx.stroke();
    }

    suggestNameFromFile(filename) {
        const base = filename.replace(/\.[^/.]+$/, '');
        return this.slugify(base);
    }

    generateUniqueSampleName(base) {
        let name = base;
        let i = 1;
        while (this.sampleRegistry.has(name)) {
            name = `${base}-${i++}`;
        }
        return name;
    }

    slugify(s) {
        return String(s)
            .toLowerCase()
            .replace(/[^a-z0-9-_]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64) || 'sample';
    }
    showGraph() {
        if (!this.lastParsedGraph) {
            this.log('No graph to display. Execute some code first!', 'warning');
            return;
        }

        // Initialize Mermaid if not already done
        if (typeof mermaid !== 'undefined' && !this.mermaidInitialized) {
            mermaid.initialize({
                theme: 'dark',
                themeVariables: {
                    primaryColor: '#569cd6',
                    primaryTextColor: '#d4d4d4',
                    primaryBorderColor: '#3e3e42',
                    lineColor: '#858585',
                    secondaryColor: '#2d2d30',
                    tertiaryColor: '#1e1e1e'
                },
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: 'basis',
                    nodeSpacing: 80,
                    rankSpacing: 120,
                    padding: 40
                },
                gantt: {
                    useMaxWidth: false
                },
                startOnLoad: false
            });
            this.mermaidInitialized = true;
        }

        // Generate Mermaid graph
        const mermaidCode = this.generateMermaidGraph(this.lastParsedGraph);
        
        // Display in modal
        const modal = document.getElementById('graphModal');
        const container = document.getElementById('graphContainer');
        
        try {
            // Clear previous content
            container.innerHTML = '';
            
            // Create a div for the mermaid diagram
            const graphDiv = document.createElement('div');
            graphDiv.className = 'mermaid';
            graphDiv.textContent = mermaidCode;
            container.appendChild(graphDiv);
            
            // Render the mermaid diagram with explicit sizing
            if (typeof mermaid !== 'undefined') {
                // Force larger rendering by setting container size first
                container.style.width = '100%';
                container.style.height = '100%';
                graphDiv.style.width = '100%';
                graphDiv.style.height = '100%';
                
                // Render with explicit configuration
                mermaid.render('graphId' + Date.now(), mermaidCode).then(result => {
                    graphDiv.innerHTML = result.svg;
                    
                    // Force SVG to scale to container
                    const svg = graphDiv.querySelector('svg');
                    if (svg) {
                        svg.setAttribute('width', '100%');
                        svg.setAttribute('height', '100%');
                        svg.style.width = '100%';
                        svg.style.height = '100%';
                        svg.style.maxWidth = 'none';
                        svg.style.maxHeight = 'none';
                    }
                }).catch(error => {
                    console.error('Mermaid render error:', error);
                    // Fallback to old method
                    mermaid.init(undefined, graphDiv);
                });
            }
            
            // Show the modal
            modal.showModal();
            
            this.log('Graph visualization opened', 'success');
        } catch (error) {
            container.innerHTML = `<p style="color: #f44747;">Error rendering graph: ${error.message}</p>`;
            modal.showModal();
            this.log(`Graph visualization error: ${error.message}`, 'error');
        }
    }

    generateMermaidGraph(parsedGraph) {
        const { nodes, connections, patterns } = parsedGraph;
        
        let mermaidCode = 'graph TD\n';
        
        // Add nodes with readable names and styling
        const nodeNames = new Map();

        for (const [name, node] of nodes) {
            let readableName = name;
            nodeNames.set(name, readableName);
            
            // Determine node styling based on type
            let nodeStyle = '';
            let nodeIcon = '';
            
            if (['sine', 'square', 'sawtooth', 'triangle'].includes(node.type)) {
                nodeStyle = ':::oscillator';
                nodeIcon = '🎵';
            } else if (node.type === 'sample') {
                nodeStyle = ':::sample';
                nodeIcon = '🥁';
            } else if (node.type === 'delay') {
                nodeStyle = ':::effect';
                nodeIcon = '🔄';
            } else if (node.type === 'gain') {
                nodeStyle = ':::effect';
                nodeIcon = '🔊';
            } else if (node.type === 'lowpass') {
                nodeStyle = ':::effect';
                nodeIcon = '🎛️';
            }
            
            // Format parameters for display with truncation
            const params = Object.entries(node.parameters || {})
                .map(([key, value]) => {
                    let displayValue = String(value);
                    // Truncate long parameter values (especially URLs)
                    if (displayValue.length > 20) {
                        displayValue = displayValue.substring(0, 17) + '...';
                    }
                    return `${key}=${displayValue}`;
                })
                .join('<br/>');
            
            const paramText = params ? `<br/><small>${params}</small>` : '';
            
            mermaidCode += `    ${name}["${nodeIcon} ${readableName}<br/>${node.type}${paramText}"]${nodeStyle}\n`;
        }
        
        // Add OUT output node
        mermaidCode += '    OUT["🔊 OUT<br/>output"]:::output\n';
        
        // Add connections
        for (const connection of connections) {
            if (connection.toParam) {
                mermaidCode += `    ${connection.from} --|.${connection.toParam}|--> ${connection.to}\n`;
            } else {
                mermaidCode += `    ${connection.from} --> ${connection.to}\n`;
            }
        }
        
        // Add patterns as annotations (patterns are keyed by unique IDs; use targetName for display)
        if (patterns.size > 0) {
            mermaidCode += '\n    %% Patterns\n';
            for (const [, pattern] of patterns) {
                const target = pattern.targetName || pattern.resolvedName || 'unknown';
                const readableName = nodeNames.get(target) || target;
                mermaidCode += `    %% @${readableName} [${pattern.notes.join(' ')}] ${pattern.duration}\n`;
            }
        }
        
        // Add styling classes
        mermaidCode += `
    classDef oscillator fill:#4a9eff,stroke:#2d5aa0,stroke-width:2px,color:#fff
    classDef sample fill:#ff6b6b,stroke:#cc5555,stroke-width:2px,color:#fff
    classDef effect fill:#51cf66,stroke:#37b24d,stroke-width:2px,color:#fff
    classDef output fill:#ffd43b,stroke:#fab005,stroke-width:2px,color:#000
`;
        
        return mermaidCode;
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    const app = new MicroApp();
    await app.init();
    
    // Make app globally available for debugging
    window.microApp = app;
});
