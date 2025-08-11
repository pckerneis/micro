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
        // Build complete chains starting from instruments
        const instrumentChains = new Map();
        
        // Find all instrument nodes (sources of chains)
        const instrumentNodes = new Set();
        for (const [name, node] of this.currentNodes) {
            if (this.isInstrumentType(node.type)) {
                instrumentNodes.add(name);
            }
        }
        
        // Build all parallel chains for each instrument
        for (const instrumentName of instrumentNodes) {
            const result = this.buildAllChainsFromInstrument(instrumentName, connections);
            if (result.chains.length > 0) {
                instrumentChains.set(instrumentName, result);
            }
        }

        // Apply routing chains to instruments
        for (const [instrumentName, result] of instrumentChains) {
            this.applyRoutingChains(instrumentName, result.chains, result.feedbackConnections);
        }
    }
    
    /**
     * Build all parallel effect chains starting from an instrument
     */
    buildAllChainsFromInstrument(startNode, connections) {
        const chains = [];
        const allFeedbackConnections = [];
        
        // Find all direct connections from the instrument
        const directConnections = connections.filter(conn => conn.from === startNode);
        
        if (directConnections.length === 0) {
            return { chains, feedbackConnections: allFeedbackConnections };
        }
        
        // Build a complete chain for each direct connection
        for (const connection of directConnections) {
            const result = this.buildSingleChain(connection.to, connections);
            chains.push(result.chain);
            allFeedbackConnections.push(...result.feedbackConnections);
        }
        
        return { chains, feedbackConnections: allFeedbackConnections };
    }
    
    /**
     * Build a single effect chain starting from a given node
     */
    buildSingleChain(startNode, connections) {
        const chain = [];
        let currentNode = startNode;
        const visited = new Set();
        const feedbackConnections = [];
        
        // If we start with MASTER, return empty chain (direct to output)
        if (currentNode === 'MASTER') {
            return { chain, feedbackConnections };
        }
        
        // Add the starting node to the chain
        chain.push(currentNode);
        
        while (true) {
            // Check for cycles (feedback loops)
            if (visited.has(currentNode)) {
                // This is a feedback connection - record it and break
                const connection = connections.find(conn => conn.from === currentNode);
                if (connection) {
                    feedbackConnections.push({
                        from: currentNode,
                        to: connection.to,
                        type: 'feedback'
                    });
                }
                break;
            }
            visited.add(currentNode);
            
            // Find the next node in the chain
            const connection = connections.find(conn => conn.from === currentNode);
            if (!connection) {
                break; // End of chain
            }
            
            const nextNode = connection.to;
            
            // If we reach MASTER, we're done
            if (nextNode === 'MASTER') {
                break;
            }
            
            // Add this target to the chain
            chain.push(nextNode);
            currentNode = nextNode;
        }
        
        return { chain, feedbackConnections };
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
        // Convert to audio engine format
        if (node.type === 'sample') {
            this.audioEngine.addInstrument(name, 'sample', {
                url: node.parameters.url || null,
                gain: node.parameters.gain ?? 1.0
            });
        } else {
            // Oscillator instruments
            this.audioEngine.addInstrument(name, node.type, {
                attack: node.parameters.attack ?? 0.01,
                decay: node.parameters.decay ?? 0.3,
                sustain: node.parameters.sustain ?? 0.7,
                release: node.parameters.release ?? 0.5
            });
        }
    }

    /**
     * Apply a routing chain to an instrument
     * Converts graph connections into multiple effect chains
     */
    applyRoutingChains(instrumentName, targetChains, feedbackConnections = []) {
        if (!this.audioEngine.instruments.has(instrumentName)) {
            console.warn(`Instrument ${instrumentName} not found for routing`);
            return;
        }

        // Convert each connection chain to effect chain format
        const effectChains = [];

        for (const targetChain of targetChains) {
            const effectChain = [];

            for (const target of targetChain) {
                if (target === 'MASTER') {
                    // End of chain - connects to output
                    break;
                }

                // Check if target is a named effect (but not anonymous nodes)
                if (this.audioEngine.namedEffects.has(target) && !target.startsWith('_anon_')) {
                    effectChain.push({
                        type: 'named',
                        name: target
                    });
                } else {
                    // Target should be an inline effect node (including anonymous nodes)
                    const targetNode = this.findNodeByName(target);
                    if (targetNode) {
                        effectChain.push({
                            type: targetNode.type,
                            ...targetNode.parameters
                        });
                    }
                }
            }

            effectChains.push(effectChain);
        }

        // Apply all effect chains to the instrument
        if (effectChains.length > 0) {
            this.audioEngine.setInstrumentEffectChains(instrumentName, effectChains, feedbackConnections);
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
