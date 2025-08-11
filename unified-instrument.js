/**
 * Unified Instrument Class
 * 
 * Handles both oscillator and sample-based instruments using
 * the same interface and effect processing pipeline.
 * Eliminates code duplication between instrument types.
 */
class UnifiedInstrument {
    constructor(audioContext, destination, config, audioGraphBuilder) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.config = config;
        this.graphBuilder = audioGraphBuilder;
        this.effectChains = [];
        
        // Initialize based on instrument type
        if (config.type === 'sample') {
            this.initSample(config);
        } else {
            this.initOscillator(config);
        }
    }

    /**
     * Initialize as sample instrument
     */
    initSample(config) {
        this.instrumentType = 'sample';
        this.url = config.url;
        this.buffer = null;
        this.gain = config.gain || 1.0;
        
        if (this.url) {
            this.loadSample();
        }
    }

    /**
     * Initialize as oscillator instrument
     */
    initOscillator(config) {
        this.instrumentType = 'oscillator';
        this.oscillatorType = config.oscillatorType || 'sine';
        this.envelope = {
            attack: config.attack ?? 0.01,
            decay: config.decay ?? 0.3,
            sustain: config.sustain ?? 0.3,
            release: config.release ?? 0.5
        };
    }

    /**
     * Load sample from URL
     */
    async loadSample() {
        try {
            const response = await fetch(this.url);
            const arrayBuffer = await response.arrayBuffer();
            this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.warn(`Could not load sample ${this.url}:`, error.message);
            this.buffer = null;
        }
    }

    /**
     * Set effect chains for this instrument
     * @param {Array} chains - Array of effect chain arrays
     */
    setEffectChains(chains) {
        this.effectChains = chains || [];
    }

    /**
     * Play a note
     * @param {number} note - MIDI note number or frequency
     * @param {number} time - Start time (optional)
     * @param {number} duration - Note duration in seconds (optional)
     */
    play(note, time = 0, duration = 1.0) {
        if (this.instrumentType === 'sample') {
            this.playSample(time);
        } else {
            this.playOscillator(note, time, duration);
        }
    }

    /**
     * Play sample
     */
    playSample(time) {
        if (!this.buffer) {
            console.warn('Sample buffer not loaded');
            return;
        }

        const source = this.graphBuilder.createSamplePlayer(this.buffer);
        
        // Apply gain if specified
        if (this.gain !== 1.0) {
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = this.gain;
            source.connect(gainNode);
            this.processEffectChains(gainNode);
        } else {
            this.processEffectChains(source);
        }

        source.start(time);
    }

    /**
     * Play oscillator note
     */
    playOscillator(note, time, duration) {
        // Validate note
        if (typeof note !== 'number' || !isFinite(note)) {
            console.warn(`Invalid note value: ${note}`);
            return;
        }

        const frequency = this.noteToFreq(note);
        if (!isFinite(frequency) || frequency <= 0) {
            console.warn(`Invalid frequency: ${frequency} from note: ${note}`);
            return;
        }

        // Create oscillator with envelope
        const { oscillator, gainNode } = this.graphBuilder.createOscillatorWithEnvelope(
            frequency,
            this.oscillatorType,
            this.envelope,
            duration
        );

        // Process effect chains
        this.processEffectChains(gainNode);

        // Start and stop oscillator
        oscillator.start(time);
        oscillator.stop(time + duration);
    }

    /**
     * Set effect chains for this instrument
     * @param {Array<Array>} effectChains - Array of effect chain arrays
     * @param {Array} feedbackConnections - Array of feedback connection definitions
     */
    setEffectChains(effectChains, feedbackConnections = []) {
        this.effectChains = effectChains || [];
        this.feedbackConnections = feedbackConnections || [];
    }

    /**
     * Process effect chains for the given source node
     */
    processEffectChains(sourceNode) {
        if (this.effectChains.length === 0) {
            // No effects - connect directly to destination
            sourceNode.connect(this.destination);
        } else if (this.effectChains.length === 1) {
            // Single effect chain
            this.graphBuilder.buildEffectChain(sourceNode, this.effectChains[0], this.destination);
        } else {
            // Multiple parallel effect chains with feedback support
            this.graphBuilder.buildParallelChains(sourceNode, this.effectChains, this.destination, this.feedbackConnections);
        }
    }

    /**
     * Convert MIDI note number to frequency
     */
    noteToFreq(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }
}

// Export for browser usage
if (typeof window !== 'undefined') {
    window.UnifiedInstrument = UnifiedInstrument;
}
