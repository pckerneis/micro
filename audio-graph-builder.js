/**
 * Simplified Audio Graph Builder
 * 
 * This class handles all audio graph creation and effect processing
 * in a unified, testable way. Eliminates code duplication between
 * instrument classes.
 */
class AudioGraphBuilder {
    constructor(audioContext, destination, audioEngine = null) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.audioEngine = audioEngine; // Reference to resolve named effects
    }

    /**
     * Create an effect node from effect definition
     * @param {Object} effect - Effect definition {type, ...params}
     * @returns {AudioNode} Web Audio API node
     */
    createEffectNode(effect) {
        // Handle named effects by resolving them first
        if (effect.type === 'named' && this.audioEngine && effect.name) {
            const namedEffect = this.audioEngine.namedEffects.get(effect.name);
            if (namedEffect) {
                // Recursively create the actual effect node
                return this.createEffectNode(namedEffect);
            } else {
                console.warn(`Named effect not found: ${effect.name}`);
                return null;
            }
        }

        switch (effect.type) {
            case 'delay':
                return this.createDelayNode(effect);
            case 'lowpass':
                return this.createLowpassNode(effect);
            case 'gain':
                return this.createGainNode(effect);
            default:
                console.warn(`Unknown effect type: ${effect.type}`);
                return null;
        }
    }

    /**
     * Create a delay effect node
     */
    createDelayNode(effect) {
        const delay = this.audioContext.createDelay();
        const delayTime = isFinite(effect.time) && effect.time > 0 ? effect.time : 0.25;
        delay.delayTime.value = Math.min(delayTime, 1.0);
        return delay;
    }

    /**
     * Create a lowpass filter node
     */
    createLowpassNode(effect) {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        
        const cutoff = isFinite(effect.cutoff) && effect.cutoff > 0 ? effect.cutoff : 1000;
        filter.frequency.value = Math.min(cutoff, this.audioContext.sampleRate / 2);
        filter.Q.value = 1;
        
        return filter;
    }

    /**
     * Create a gain node
     */
    createGainNode(effect) {
        const gainNode = this.audioContext.createGain();
        const level = isFinite(effect.level) && effect.level >= 0 ? effect.level : 1.0;
        gainNode.gain.value = level;
        return gainNode;
    }

    /**
     * Build a complete effect chain from source to destination
     * @param {AudioNode} sourceNode - Input audio node
     * @param {Array} effectChain - Array of effect definitions
     * @param {AudioNode} outputNode - Final destination (optional, defaults to this.destination)
     * @returns {AudioNode} Final node in the chain
     */
    buildEffectChain(sourceNode, effectChain, outputNode = this.destination) {
        if (!effectChain || effectChain.length === 0) {
            // No effects - connect directly to output
            sourceNode.connect(outputNode);
            return sourceNode;
        }

        let currentNode = sourceNode;

        // Process each effect in the chain
        for (const effect of effectChain) {
            const effectNode = this.createEffectNode(effect);
            if (effectNode) {
                currentNode.connect(effectNode);
                currentNode = effectNode;
            }
        }

        // Connect final node to output
        currentNode.connect(outputNode);
        return currentNode;
    }

    /**
     * Build multiple parallel effect chains from a single source
     * @param {AudioNode} sourceNode - Input audio node
     * @param {Array} effectChains - Array of effect chain arrays
     * @param {AudioNode} outputNode - Final destination
     */
    buildParallelChains(sourceNode, effectChains, outputNode = this.destination) {
        if (!effectChains || effectChains.length === 0) {
            sourceNode.connect(outputNode);
            return;
        }

        // Build each parallel chain
        effectChains.forEach(chain => {
            // Create a gain node to split the signal for this chain
            const splitter = this.audioContext.createGain();
            sourceNode.connect(splitter);
            
            // Build the effect chain from the splitter
            this.buildEffectChain(splitter, chain, outputNode);
        });
    }

    /**
     * Create an oscillator with ADSR envelope
     * @param {number} frequency - Oscillator frequency
     * @param {string} type - Oscillator type (sine, square, etc.)
     * @param {Object} envelope - ADSR parameters
     * @param {number} duration - Note duration in seconds
     * @returns {AudioNode} Gain node with envelope applied
     */
    createOscillatorWithEnvelope(frequency, type, envelope, duration) {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.connect(gainNode);
        
        // Apply ADSR envelope
        this.applyADSREnvelope(gainNode.gain, envelope, duration);
        
        return { oscillator, gainNode };
    }

    /**
     * Apply ADSR envelope to a gain parameter
     */
    applyADSREnvelope(gainParam, envelope, duration) {
        const now = this.audioContext.currentTime;
        const { attack, decay, sustain, release } = envelope;

        console.log(envelope);
        
        gainParam.setValueAtTime(0, now);
        gainParam.linearRampToValueAtTime(1, now + attack);
        gainParam.linearRampToValueAtTime(sustain, now + attack + decay);
        gainParam.setValueAtTime(sustain, Math.max(0, now + duration - release));
        gainParam.linearRampToValueAtTime(0, now + duration);
    }

    /**
     * Create a sample player (buffer source)
     * @param {AudioBuffer} buffer - Audio buffer to play
     * @returns {AudioBufferSourceNode} Buffer source node
     */
    createSamplePlayer(buffer) {
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        return source;
    }
}

// Export for browser usage
if (typeof window !== 'undefined') {
    window.AudioGraphBuilder = AudioGraphBuilder;
}
