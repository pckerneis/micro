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
     * Build a complete effect chain and return both the final node and all created nodes
     * @param {AudioNode} sourceNode - Input audio node
     * @param {Array} effectChain - Array of effect definitions
     * @param {AudioNode} outputNode - Final destination (optional, defaults to this.destination)
     * @returns {Object} Object with finalNode and nodes Map
     */
    buildEffectChainWithNodes(sourceNode, effectChain, outputNode = this.destination) {
        const nodes = new Map();
        
        if (!effectChain || effectChain.length === 0) {
            // No effects - connect directly to output
            sourceNode.connect(outputNode);
            return { finalNode: sourceNode, nodes };
        }

        let currentNode = sourceNode;

        // Process each effect in the chain
        for (let i = 0; i < effectChain.length; i++) {
            const effect = effectChain[i];
            const effectNode = this.createEffectNode(effect);
            if (effectNode) {
                currentNode.connect(effectNode);
                currentNode = effectNode;
                
                // Store node with a unique identifier for feedback connections
                const nodeId = `effect_${i}_${effect.type}`;
                nodes.set(nodeId, effectNode);
                
                // Also store by effect name if it's a named effect
                if (effect.name) {
                    nodes.set(effect.name, effectNode);
                }
            }
        }

        // Connect final node to output
        currentNode.connect(outputNode);
        return { finalNode: currentNode, nodes };
    }

    /**
     * Build multiple parallel effect chains from a single source
     * @param {AudioNode} sourceNode - Input audio node
     * @param {Array} effectChains - Array of effect chain arrays
     * @param {AudioNode} outputNode - Final destination
     * @param {Array} feedbackConnections - Array of feedback connection definitions
     */
    buildParallelChains(sourceNode, effectChains, outputNode = this.destination, feedbackConnections = []) {
        if (!effectChains || effectChains.length === 0) {
            sourceNode.connect(outputNode);
            return;
        }

        // Store created effect nodes for feedback connections
        const effectNodes = new Map();

        // Build each parallel chain
        const chainResults = effectChains.map((chain, index) => {
            // Create a gain node to split the signal for this chain
            const splitter = this.audioContext.createGain();
            sourceNode.connect(splitter);
            
            // Build the effect chain from the splitter and collect nodes
            const result = this.buildEffectChainWithNodes(splitter, chain, outputNode);
            
            // Store nodes for feedback connections
            result.nodes.forEach((node, name) => {
                effectNodes.set(name, node);
            });
            
            return result;
        });

        // Process feedback connections after all chains are built
        this.processFeedbackConnections(feedbackConnections, effectNodes);
    }

    /**
     * Process feedback connections to create audio feedback loops
     * @param {Array} feedbackConnections - Array of feedback connection definitions
     * @param {Map} effectNodes - Map of effect node names to AudioNode instances
     */
    processFeedbackConnections(feedbackConnections, effectNodes) {
        for (const feedback of feedbackConnections) {
            const fromNode = effectNodes.get(feedback.from);
            const toNode = effectNodes.get(feedback.to);
            
            if (fromNode && toNode) {
                // Create feedback connection
                // Note: In Web Audio API, feedback loops are automatically handled
                // as long as there's at least one DelayNode in the loop to prevent
                // immediate feedback that could cause issues
                try {
                    fromNode.connect(toNode);
                } catch (error) {
                    console.warn(`Failed to create feedback connection ${feedback.from} -> ${feedback.to}:`, error);
                }
            } else {
                console.warn(`Feedback connection failed - nodes not found: ${feedback.from} -> ${feedback.to}`);
            }
        }
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
