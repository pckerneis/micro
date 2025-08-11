/**
 * Simplified Audio Engine
 * 
 * Clean, maintainable audio engine that eliminates code duplication
 * and provides a unified interface for all audio operations.
 */
class SimplifiedAudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.graphBuilder = null;
        this.instruments = new Map();
        this.patterns = new Map();
        this.namedEffects = new Map();
        this.isPlaying = false;
        this.startTime = 0;
        this.bpm = 120;
        this.beatDuration = 60 / this.bpm;
        this.nextEventTime = 0;
        this.scheduleAheadTime = 25.0; // 25ms ahead
        this.lookahead = 25.0;
        this.timerID = null;
    }

    /**
     * Initialize the audio engine
     */
    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.7;
            
            // Create the unified audio graph builder with reference to this engine for named effects
            this.graphBuilder = new AudioGraphBuilder(this.audioContext, this.masterGain, this);
            
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    /**
     * Clear all instruments, patterns, and named effects
     */
    clearAll() {
        if (this.instruments && typeof this.instruments.clear === 'function') {
            this.instruments.clear();
        }
        if (this.patterns && typeof this.patterns.clear === 'function') {
            this.patterns.clear();
        }
        if (this.namedEffects && typeof this.namedEffects.clear === 'function') {
            this.namedEffects.clear();
        }
    }

    /**
     * Add an instrument with unified interface
     * @param {string} name - Instrument name
     * @param {string} type - Instrument type ('sample' or oscillator type)
     * @param {Object} parameters - Instrument parameters
     */
    addInstrument(name, type, parameters) {
        let config;
        
        if (type === 'sample') {
            config = {
                type: 'sample',
                url: parameters.url,
                gain: parameters.gain || 1.0
            };
        } else {
            // Oscillator instrument
            config = {
                type: 'oscillator',
                oscillatorType: type,
                attack: parameters.attack || 0.01,
                decay: parameters.decay || 0.3,
                sustain: parameters.sustain || 0.3,
                release: parameters.release || 0.5
            };
        }

        const instrument = new UnifiedInstrument(
            this.audioContext,
            this.masterGain,
            config,
            this.graphBuilder
        );

        this.instruments.set(name, instrument);
    }

    /**
     * Set effect chains for an instrument
     * @param {string} instrumentName - Name of the instrument
     * @param {Array} effectChain - Array of effect definitions
     */
    setInstrumentEffectChain(instrumentName, effectChain) {
        const instrument = this.instruments.get(instrumentName);
        if (instrument) {
            // Wrap single chain in array for consistency
            instrument.setEffectChains([effectChain]);
        }
    }

    /**
     * Create a named effect for reuse
     * @param {string} name - Effect name
     * @param {string} type - Effect type
     * @param {Object} parameters - Effect parameters
     */
    createNamedEffect(name, type, parameters) {
        const effectDef = { type, ...parameters };
        this.namedEffects.set(name, effectDef);
    }

    /**
     * Add a pattern
     * @param {string} name - Pattern name
     * @param {Array} notes - Array of notes
     * @param {number} duration - Step duration
     */
    addPattern(name, notes, duration) {
        this.patterns.set(name, {
            notes,
            duration,
            currentStep: 0,
            lastTriggeredStep: -1
        });
    }

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.nextEventTime = this.startTime;
        this.scheduleEvents();
        this.timerID = setInterval(() => this.scheduleEvents(), this.lookahead);
    }

    /**
     * Stop playback
     */
    stop() {
        this.isPlaying = false;
        if (this.timerID) {
            clearInterval(this.timerID);
            this.timerID = null;
        }
        
        // Reset pattern positions
        this.patterns.forEach(pattern => {
            pattern.currentStep = 0;
            pattern.lastTriggeredStep = -1;
        });
    }

    /**
     * Schedule pattern events
     */
    scheduleEvents() {
        if (!this.isPlaying) return;

        const currentTime = this.audioContext.currentTime;
        const scheduleUntil = currentTime + (this.scheduleAheadTime / 1000);

        while (this.nextEventTime < scheduleUntil) {
            this.triggerPatterns(this.nextEventTime);
            this.nextEventTime += this.beatDuration / 4; // 16th note resolution
        }
    }

    /**
     * Trigger all patterns at the given time
     */
    triggerPatterns(time) {
        const elapsedTime = time - this.startTime;
        
        this.patterns.forEach((pattern, patternName) => {
            const stepDuration = pattern.duration * this.beatDuration;
            const totalSteps = Math.floor(elapsedTime / stepDuration);
            
            if (totalSteps > pattern.lastTriggeredStep && totalSteps < pattern.notes.length) {
                const note = pattern.notes[totalSteps];
                
                if (note !== null && note !== undefined && note !== '_') {
                    // Extract instrument name from pattern name (e.g., "@kick" -> "kick")
                    const instrumentName = patternName.startsWith('@') ? patternName.slice(1) : patternName;
                    const instrument = this.instruments.get(instrumentName);
                    
                    if (instrument) {
                        const stepTriggerTime = this.startTime + (totalSteps * stepDuration);
                        instrument.play(note, stepTriggerTime, stepDuration);
                    }
                }
                pattern.lastTriggeredStep = totalSteps;
            }
        });
    }

    /**
     * Parse duration string to number (e.g., "1/4" -> 0.25)
     */
    parseDuration(durationStr) {
        if (typeof durationStr === 'number') {
            return durationStr;
        }
        
        if (typeof durationStr === 'string' && durationStr.includes('/')) {
            const [numerator, denominator] = durationStr.split('/').map(Number);
            if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                return numerator / denominator;
            }
        }
        
        return parseFloat(durationStr) || 1;
    }

    /**
     * Apply a parsed graph from the GraphParser
     * @param {Object} parsedGraph - Parsed graph structure
     */
    applyParsedGraph(parsedGraph) {
        const adapter = new GraphAdapter(this);
        adapter.setCurrentNodes(parsedGraph.nodes);
        return adapter.applyGraph(parsedGraph);
    }
}

// Export for browser usage
if (typeof window !== 'undefined') {
    window.SimplifiedAudioEngine = SimplifiedAudioEngine;
}
