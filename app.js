class MicroApp {
    constructor() {
        this.audioEngine = new AudioEngineV2();
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
        const graphBtn = document.getElementById('graphBtn');
        const masterGainSlider = document.getElementById('masterGain');
        const volumeValue = document.getElementById('volumeValue');

        playBtn.addEventListener('click', () => this.play());
        stopBtn.addEventListener('click', () => this.stop());
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
    }

    executeCode() {
        if (!this.isInitialized) return;

        const code = this.editor.getValue();
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
        const integrationResult = this.audioEngine.applyParsedGraph(parsedGraph);
        
        if (integrationResult.success) {
            this.log('Audio graph built successfully!', 'success');
            const routes = this.audioEngine.getRoutes();
            const patterns = this.audioEngine.getPatterns();
            this.log(`Built ${Object.keys(routes).length} routes, ${Object.keys(patterns).length} patterns`, 'info');
        } else {
            integrationResult.errors.forEach(error => {
                this.log(error, 'error');
            });
        }
        
        // Save code to localStorage
        localStorage.setItem('micro-code', code);
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
        if (!this.isInitialized) return;
        this.audioEngine.stop();
        this.updateStatus('Stopped');
        this.log('Playback stopped', 'info');
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
        }, 100);
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
        
        // Add MASTER output node
        mermaidCode += '    MASTER["🔊 MASTER<br/>output"]:::output\n';
        
        // Add connections
        for (const connection of connections) {
            mermaidCode += `    ${connection.from} --> ${connection.to}\n`;
        }
        
        // Add patterns as annotations
        if (patterns.size > 0) {
            mermaidCode += '\n    %% Patterns\n';
            for (const [instrumentName, pattern] of patterns) {
                const readableName = nodeNames.get(instrumentName) || instrumentName;
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
