/**
 * Graph Adapter - Bridge between GraphParser and AudioEngine
 * Converts parsed audio graph into audio engine structures
 * Maintains decoupling between parser and engine
 */

class GraphAdapter {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
    }

    /**
     * Apply a parsed graph to the audio engine
     * @param {Object} parsedGraph - Result from GraphParser.parse()
     */
    applyGraph(parsedGraph) {
        // Clear existing state
        this.audioEngine.clearAll();

        // Process nodes first (create named effects and instruments)
        this.processNodes(parsedGraph.nodes);

        // Process connections (build routing)
        this.processConnections(parsedGraph.connections);

        // Process patterns
        this.processPatterns(parsedGraph.patterns);

        // Return any errors encountered during processing
        return {
            success: parsedGraph.errors.length === 0,
            errors: parsedGraph.errors,
            nodesCreated: parsedGraph.nodes.size,
            connectionsCreated: parsedGraph.connections.length,
            patternsCreated: parsedGraph.patterns.size
        };
    }

    /**
     * Process nodes from parsed graph
     * Creates named effects and prepares instrument definitions
     */
    processNodes(nodes) {
        for (const [name, node] of nodes) {
            if (this.isInstrumentType(node.type)) {
                // Create instrument definition
                this.createInstrument(name, node);
            } else {
                // Create named effect
                this.audioEngine.createNamedEffect(name, node.type, node.parameters);
            }
        }
    }

    /**
     * Process connections from parsed graph
     * Builds the routing chains for each instrument
     */
    processConnections(connections) {
        // Group connections by source instrument
        const instrumentChains = new Map();

        for (const connection of connections) {
            if (!instrumentChains.has(connection.from)) {
                instrumentChains.set(connection.from, []);
            }
            instrumentChains.get(connection.from).push(connection.to);
        }

        // Apply routing chains to instruments
        for (const [instrumentName, chain] of instrumentChains) {
            this.applyRoutingChain(instrumentName, chain);
        }
    }

    /**
     * Process patterns from parsed graph
     */
    processPatterns(patterns) {
        for (const [name, pattern] of patterns) {
            this.audioEngine.addPattern(name, pattern.notes, pattern.duration);
        }
    }

    /**
     * Check if a node type is an instrument (vs effect)
     */
    isInstrumentType(type) {
        return ['sine', 'square', 'sawtooth', 'triangle', 'sample'].includes(type);
    }

    /**
     * Create an instrument with its base parameters
     */
    createInstrument(name, node) {
        const instrumentDef = {
            type: node.type,
            parameters: node.parameters,
            effectChains: [] // Will be populated by processConnections
        };

        // Convert to audio engine format
        if (node.type === 'sample') {
            this.audioEngine.addInstrument(name, 'sample', {
                url: node.parameters.url || null,
                gain: node.parameters.gain || 1.0
            });
        } else {
            // Oscillator instruments
            this.audioEngine.addInstrument(name, node.type, {
                attack: node.parameters.attack || 0.01,
                decay: node.parameters.decay || 0.3,
                sustain: node.parameters.sustain || 0.7,
                release: node.parameters.release || 0.5
            });
        }
    }

    /**
     * Apply a routing chain to an instrument
     * Converts graph connections into effect chains
     */
    applyRoutingChain(instrumentName, targetChain) {
        if (!this.audioEngine.instruments.has(instrumentName)) {
            console.warn(`Instrument ${instrumentName} not found for routing`);
            return;
        }

        // Convert connection chain to effect chain format
        const effectChain = [];

        for (const target of targetChain) {
            if (target === 'STEREO') {
                // End of chain - connects to output
                break;
            }

            // Check if target is a named effect
            if (this.audioEngine.namedEffects.has(target)) {
                effectChain.push({
                    type: 'named',
                    name: target
                });
            } else {
                // Target should be an inline effect node
                const targetNode = this.findNodeByName(target);
                if (targetNode) {
                    effectChain.push({
                        type: targetNode.type,
                        ...targetNode.parameters
                    });
                }
            }
        }

        // Apply the effect chain to the instrument
        if (effectChain.length > 0) {
            this.audioEngine.setInstrumentEffectChain(instrumentName, effectChain);
        }
    }

    /**
     * Find a node by its name (helper for routing)
     */
    findNodeByName(name) {
        // This would need access to the parsed nodes
        // For now, we'll implement this as a lookup in the stored graph
        return this.currentNodes?.get(name) || null;
    }

    /**
     * Store current nodes for routing lookup
     */
    setCurrentNodes(nodes) {
        this.currentNodes = nodes;
    }
}

/**
 * Enhanced AudioEngine methods for graph integration
 * These methods should be added to the existing AudioEngine class
 */
class AudioEngineGraphExtensions {
    /**
     * Clear all instruments, patterns, and named effects
     */
    clearAll() {
        this.instruments.clear();
        this.patterns.clear();
        this.namedEffects.clear();
        this.stop(); // Stop any current playback
    }

    /**
     * Add an instrument with the given type and parameters
     */
    addInstrument(name, type, parameters) {
        if (type === 'sample') {
            this.instruments.set(name, new SampleInstrument(
                this.audioContext, 
                parameters.url, 
                parameters.gain,
                this // Pass audioEngine reference for named effects
            ));
        } else {
            // Oscillator instruments
            this.instruments.set(name, new OscillatorInstrument(
                this.audioContext,
                type,
                parameters.attack,
                parameters.decay,
                parameters.sustain,
                parameters.release,
                this // Pass audioEngine reference for named effects
            ));
        }
    }

    /**
     * Add a pattern with the given notes and duration
     */
    addPattern(name, notes, duration) {
        this.patterns.set(name, {
            notes: notes,
            duration: duration,
            currentStep: 0,
            lastTriggeredStep: -1
        });
    }

    /**
     * Set an effect chain for an instrument
     */
    setInstrumentEffectChain(instrumentName, effectChain) {
        const instrument = this.instruments.get(instrumentName);
        if (instrument) {
            instrument.effectChains = [effectChain]; // Wrap in array for multiple chains support
        }
    }

    /**
     * Apply a parsed graph to this audio engine
     */
    applyParsedGraph(parsedGraph) {
        const adapter = new GraphAdapter(this);
        adapter.setCurrentNodes(parsedGraph.nodes);
        return adapter.applyGraph(parsedGraph);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GraphAdapter, AudioEngineGraphExtensions };
} else {
    // Browser environment - make classes globally available
    window.GraphAdapter = GraphAdapter;
    window.AudioEngineGraphExtensions = AudioEngineGraphExtensions;
}
