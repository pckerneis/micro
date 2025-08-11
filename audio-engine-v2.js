/**
 * Simplified Audio Engine V2
 * Focuses on scheduling and pattern playback
 * Delegates audio graph building to AudioGraphBuilderV2
 */
class AudioEngineV2 {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.graphBuilder = null;
        this.routeMap = new Map(); // Map of route names to AudioNode arrays
        this.patterns = new Map(); // Map of pattern names to pattern data
        this.isPlaying = false;
        this.startTime = 0;
        this.pausedTime = 0;
        this.bpm = 120;
        this.stepDuration = 60 / this.bpm; // Duration of one step in seconds
        this.schedulerInterval = null;
        this.nextStepTime = 0;
        this.currentStep = 0;
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
            
            // Create graph builder
            this.graphBuilder = new AudioGraphBuilderV2(this.audioContext, this.masterGain);
            
            console.log('Audio Engine V2 initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    /**
     * Apply a parsed graph to build the audio graph
     */
    applyParsedGraph(parsedGraph) {
        try {
            // Clear previous state
            this.stop();
            this.routeMap.clear();
            this.patterns.clear();

            // Build audio graph using new graph builder
            this.routeMap = this.graphBuilder.buildGraph(parsedGraph);

            // Store patterns for scheduling
            for (const [targetName, pattern] of parsedGraph.patterns) {
                this.patterns.set(pattern.name, {
                    targetName: targetName,
                    notes: pattern.notes,
                    duration: pattern.duration,
                    currentStep: 0,
                    lastTriggeredStep: -1
                });
            }

            console.log(`Applied graph: ${this.routeMap.size} routes, ${this.patterns.size} patterns`);
            
            return {
                success: true,
                errors: []
            };
        } catch (error) {
            console.error('Failed to apply parsed graph:', error);
            return {
                success: false,
                errors: [error.message]
            };
        }
    }

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying) return;

        this.resetTime();
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime - this.pausedTime;
        this.nextStepTime = this.audioContext.currentTime;
        this.currentStep = 0;
        
        // Reset all pattern positions
        for (const pattern of this.patterns.values()) {
            pattern.currentStep = 0;
            pattern.lastTriggeredStep = -1;
        }

        // Start scheduler
        this.schedulerInterval = setInterval(() => {
            this.scheduleNotes();
        }, 25); // Check every 25ms for precise timing

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

        console.log('Playback stopped');
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
    scheduleNotes() {
        if (!this.isPlaying) return;

        const currentTime = this.audioContext.currentTime;
        const lookAhead = 0.1; // Look ahead 100ms

        // Schedule notes that should play within the look-ahead window
        while (this.nextStepTime < currentTime + lookAhead) {
            for (const [patternName, pattern] of this.patterns) {
                this.schedulePatternStep(patternName, pattern, this.nextStepTime);
            }

            // Advance to next step - use quarter note steps for now
            this.nextStepTime += this.stepDuration;
            this.currentStep++;
        }
    }

    /**
     * Schedule a single step for a pattern
     */
    schedulePatternStep(patternName, pattern, stepTime) {
        // Calculate which note in the pattern should play based on current step
        const patternStepDuration = this.stepDuration * pattern.duration;
        const totalSteps = Math.floor(stepTime / patternStepDuration);
        const stepIndex = totalSteps % pattern.notes.length;
        
        // Only trigger if we haven't already triggered this step
        if (totalSteps !== pattern.lastTriggeredStep) {
            const note = pattern.notes[stepIndex];
            
            if (note !== null && note !== '_') {
                this.playNote(patternName, note, patternStepDuration, stepTime);
            }
            
            pattern.lastTriggeredStep = totalSteps;
        }
    }

    /**
     * Play a note on a specific route/instrument
     */
    playNote(routeName, note, duration, time = 0) {
        const sourceNode = this.graphBuilder.getSourceNodeForRoute(routeName);
        
        if (!sourceNode) {
            console.warn(`No source node found for route: ${routeName}`);
            return;
        }

        // Convert MIDI note to frequency if needed
        let frequency;
        if (typeof note === 'number') {
            frequency = 440 * Math.pow(2, (note - 69) / 12);
        } else {
            frequency = parseFloat(note) || 440;
        }

        // Play the note using the graph builder
        return this.graphBuilder.playNote(sourceNode, frequency, duration, time);
    }

    /**
     * Set master volume (0-100)
     */
    setMasterGain(volume) {
        if (this.masterGain) {
            const gain = Math.max(0, Math.min(100, volume)) / 100;
            this.masterGain.gain.value = gain;
        }
    }

    /**
     * Set BPM
     */
    setBPM(bpm) {
        this.bpm = Math.max(60, Math.min(200, bpm));
        this.stepDuration = 60 / this.bpm;
    }

    /**
     * Get current playback state
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            currentStep: this.currentStep,
            bpm: this.bpm,
            routeCount: this.routeMap.size,
            patternCount: this.patterns.size
        };
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioEngineV2;
}
