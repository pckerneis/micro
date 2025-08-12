import {AudioGraphBuilder} from './audio-graph-builder.mjs';

/**
 * Focuses on scheduling and pattern playback
 * Delegates audio graph building to AudioGraphBuilder
 */
export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.graphBuilder = null;
        this.routeMap = new Map(); // Map of route names to AudioNode arrays
        this.patterns = new Map(); // Map of pattern names to pattern data
        this.activeAudioNodes = new Set(); // Track active oscillators and buffer sources
        this.isPlaying = false;
        this.startTime = 0;
        this.pausedTime = 0;
        this.bpm = 120;
        this.stepDuration = 60 / this.bpm; // Duration of one step in seconds
        // Transport timing (integer tick scheduler)
        this.ppq = 96; // pulses per quarter note
        this.tickSec = 60 / this.bpm / this.ppq; // seconds per tick
        this.currentTick = 0; // transport tick position during scheduling
        this.lookaheadSec = 0.15; // schedule 150ms ahead
        this.intervalMs = 25; // scheduler wakeup period
        this.schedulerInterval = null;
        this.nextStepTime = 0; // deprecated (kept for compatibility)
        this.currentStep = 0;  // deprecated (kept for compatibility)
    }

    /**
     * Initialize the audio engine
     */
    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create master gain node
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.7; // Default volume
            
            console.log('Audio Engine V2 initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    /**
     * Load parsed graph and build audio routes
     */
    async loadGraph(parsedGraph) {
        try {
            // Create new graph builder with master gain as output
            this.graphBuilder = new AudioGraphBuilder(this.audioContext, this.masterGain);
            
            // Set up active node tracking callback
            this.graphBuilder.setActiveNodeCallback((audioNode) => {
                this.activeAudioNodes.add(audioNode);
                
                // Remove from tracking when node ends
                audioNode.addEventListener('ended', () => {
                    this.activeAudioNodes.delete(audioNode);
                });
            });
            
            // Build the audio graph
            this.routeMap = await this.graphBuilder.buildGraph(parsedGraph);
            
            // Load patterns from parsed graph
            this.loadPatterns(parsedGraph.patterns);
            
            console.log(`Built audio graph with ${this.routeMap.size} routes:`, Array.from(this.routeMap.keys()));
            console.log(`Loaded ${this.patterns.size} patterns:`, Array.from(this.patterns.keys()));
            
            return true;
        } catch (error) {
            console.error('Failed to load graph:', error);
            throw error;
        }
    }

    /**
     * Load patterns from parsed graph
     */
    loadPatterns(patterns) {
        this.patterns.clear();
        
        // Parser maps patterns by resolved node key. We re-key by the original target name
        // (route or alias) so we can use builder.getSourceNodeForRoute()
        for (const [, patternData] of patterns) {
            const key = patternData.name; // original target in user code (route or alias)
            const stepTicks = Math.max(1, Math.round((patternData.duration || 1) * this.ppq));
            const loopTicks = stepTicks * (patternData.notes?.length || 1);
            const pattern = {
                notes: patternData.notes,
                duration: patternData.duration, // in beats
                targetName: key,
                resolvedName: patternData.resolvedName,
                stepTicks,
                loopTicks,
                nextTick: 0
            };
            // If we're already playing, align nextTick to the next step boundary
            if (this.isPlaying) {
                const ct = Math.max(0, this.currentTick);
                pattern.nextTick = Math.ceil(ct / stepTicks) * stepTicks;
            }
            this.patterns.set(key, pattern);
        }

        // Recalculate scheduling grid based on current patterns
        // this.updateGridStep(); // removed
    }

    /**
     * Start playback
     */
    async play() {
        if (this.isPlaying) return;

        this.resetTime();
        
        // Always attempt to resume; it's a no-op if already running
        try {
            await this.audioContext.resume();
        } catch (e) {
            console.warn('AudioContext resume failed:', e);
        }
        if (this.audioContext.state !== 'running') {
            console.warn('AudioContext is not running; aborting play');
            return;
        }

        this.isPlaying = true;
        // Start slightly in the future to avoid scheduling-in-the-past
        this.startTime = this.audioContext.currentTime + 0.1;
        this.currentTick = 0;
 
        // Reset all pattern positions
        for (const pattern of this.patterns.values()) {
            pattern.nextTick = 0;
        }
 
        // Schedule the first step immediately to avoid delay
        this.scheduleLoop();
 
        // Start scheduler
        this.schedulerInterval = setInterval(() => {
            this.scheduleLoop();
        }, this.intervalMs); // Check periodically for precise timing

        console.log('Playback started');
    }

    /**
     * Stop playback
     */
    stop() {
        if (this.isPlaying) {
            this.pausedTime = this.audioContext.currentTime - this.startTime;
        }
        
        this.isPlaying = false;
        
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }

        // Immediately stop all active audio nodes
        this.stopAllActiveNodes();

        console.log('Playback stopped');
    }

    /**
     * Stop all currently active audio nodes immediately
     */
    stopAllActiveNodes() {
        const currentTime = this.audioContext.currentTime;
        
        for (const audioNode of this.activeAudioNodes) {
            try {
                if (audioNode && typeof audioNode.stop === 'function') {
                    audioNode.stop(currentTime);
                }
            } catch (error) {
                // Node might already be stopped, ignore error
            }
        }
        
        // Clear the set of active nodes
        this.activeAudioNodes.clear();
    }

    /**
     * Get current playback time in seconds
     */
    getCurrentTime() {
        if (this.isPlaying) {
            return this.audioContext.currentTime - this.startTime;
        } else {
            return this.pausedTime;
        }
    }

    /**
     * Reset playback time to zero
     */
    resetTime() {
        this.startTime = this.audioContext.currentTime;
        this.pausedTime = 0;
    }

    /**
     * Schedule notes for patterns
     */
    scheduleLoop() {
        if (!this.isPlaying) return;

        const now = this.audioContext.currentTime;
        const horizonTick = Math.floor((now + this.lookaheadSec - this.startTime) / this.tickSec);

        while (this.currentTick <= horizonTick) {
            for (const [routeKey, pattern] of this.patterns) {
                if (this.currentTick === pattern.nextTick) {
                    const notesLen = pattern.notes.length || 1;
                    const stepIndex = Math.floor((pattern.nextTick / pattern.stepTicks) % notesLen);
                    const tok = pattern.notes[stepIndex];
                    // Rest or continuation: advance only
                    if (tok === null || tok === '-' || tok === '_') {
                        pattern.nextTick += pattern.stepTicks;
                    } else {
                        // Compute sustain across subsequent '-' tokens
                        let sustainSteps = 1;
                        for (let i = 1; i < notesLen; i++) {
                            const nextTok = pattern.notes[(stepIndex + i) % notesLen];
                            if (nextTok === '-') {
                                sustainSteps += 1;
                            } else {
                                break;
                            }
                        }
                        let timeSec = this.startTime + pattern.nextTick * this.tickSec;
                        timeSec = Math.max(timeSec, now + 0.005);
                        const durSec = Math.max(0.01, sustainSteps * pattern.stepTicks * this.tickSec);
                        this.playNote(routeKey, tok, durSec, timeSec);
                        pattern.nextTick += pattern.stepTicks;
                    }
                }
            }
            this.currentTick += 1;
        }
    }

    // schedulePatternStep removed in favor of integer-tick scheduleLoop

    /**
     * Play a note on a specific route/instrument
     */
    playNote(routeName, note, duration, time = 0) {
        let sourceNode = this.graphBuilder.getSourceNodeForRoute(routeName);
        // Fallback: try resolvedName from pattern definition if route alias key didn't resolve
        if (!sourceNode) {
            const pattern = this.patterns.get(routeName);
            if (pattern && pattern.resolvedName) {
                sourceNode = this.graphBuilder.getSourceNodeForRoute(pattern.resolvedName);
            }
        }
        
        if (!sourceNode) {
            console.warn(`No source node found for route: ${routeName}`);
            return;
        }

        // Convert MIDI note to frequency if needed
        let frequency;
        if (typeof note === 'number') {
            // MIDI note number
            frequency = 440 * Math.pow(2, (note - 69) / 12);
        } else if (typeof note === 'string') {
            // Literal frequency tokens like "440Hz" or "440.0Hz"
            const hzMatch = note.match(/^(\d+(?:\.\d+)?)\s*Hz$/i);
            if (hzMatch) {
                frequency = parseFloat(hzMatch[1]);
            } else {
                // Fallback: parse leading number if present
                const n = parseFloat(note);
                frequency = isFinite(n) ? n : 440;
            }
        } else {
            frequency = 440;
        }

        // Play the note using the graph builder
        return this.graphBuilder.playNote(sourceNode, frequency, duration, time);
    }

    /**
     * Set BPM
     */
    setBPM(bpm) {
        this.bpm = Math.max(60, Math.min(200, bpm));
        this.stepDuration = 60 / this.bpm;
        this.tickSec = 60 / this.bpm / this.ppq;
    }

    /**
     * Get available routes for debugging
     */
    getRoutes() {
        const routes = {};
        for (const [name, nodes] of this.routeMap) {
            routes[name] = nodes.length;
        }
        return routes;
    }

    /**
     * Get patterns for debugging
     */
    getPatterns() {
        const patterns = {};
        for (const [name, pattern] of this.patterns) {
            patterns[name] = {
                notes: pattern.notes,
                duration: pattern.duration,
                targetName: pattern.targetName
            };
        }
        return patterns;
    }
}

