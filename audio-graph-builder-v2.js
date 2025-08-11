/**
 * Simple Audio Graph Builder
 * Takes a parsed graph and returns connected AudioNodes
 */
class AudioGraphBuilderV2 {
    constructor(audioContext, destination) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.nodeMap = new Map(); // Maps node names to AudioNode instances
        this.routeMap = new Map(); // Maps route names to AudioNode arrays
    }

    /**
     * Build the complete audio graph from parsed graph
     * @param {Object} parsedGraph - Output from GraphParser
     * @returns {Map<string, AudioNode[]>} Map of route/instrument names to AudioNode arrays
     */
    buildGraph(parsedGraph) {
        // Clear previous state
        this.nodeMap.clear();
        this.routeMap.clear();

        // Step 1: Create all AudioNodes
        this.createAllNodes(parsedGraph.nodes);

        // Step 2: Connect all nodes according to connections
        this.connectAllNodes(parsedGraph.connections);

        // Step 3: Build route references for pattern scheduling
        this.buildRouteReferences(parsedGraph.namedRoutes, parsedGraph.nodes);

        return this.routeMap;
    }

    /**
     * Create AudioNode instances for all parsed nodes
     */
    createAllNodes(nodes) {
        for (const [nodeName, nodeDefinition] of nodes) {
            const audioNode = this.createAudioNode(nodeDefinition);
            if (audioNode) {
                this.nodeMap.set(nodeName, audioNode);
            }
        }
    }

    /**
     * Create a single AudioNode from node definition
     */
    createAudioNode(nodeDefinition) {
        const { type, parameters } = nodeDefinition;

        switch (type) {
            case 'sine':
            case 'square':
            case 'sawtooth':
            case 'triangle':
                return this.createOscillatorNode(type, parameters);
            
            case 'gain':
                return this.createGainNode(parameters);
            
            case 'delay':
                return this.createDelayNode(parameters);
            
            case 'reverb':
                return this.createReverbNode(parameters);
            
            case 'lowpass':
            case 'highpass':
            case 'bandpass':
                return this.createFilterNode(type, parameters);
            
            case 'sample':
                return this.createSampleNode(parameters);
            
            default:
                console.warn(`Unknown node type: ${type}`);
                return null;
        }
    }

    /**
     * Create oscillator with envelope (for instruments)
     */
    createOscillatorNode(type, parameters) {
        // For instruments, we create a gain node that will be the "instrument"
        // The actual oscillators will be created when notes are played
        const instrumentGain = this.audioContext.createGain();
        instrumentGain.gain.value = 1.0;
        
        // Store instrument parameters for later use
        instrumentGain._instrumentType = type;
        instrumentGain._instrumentParams = {
            attack: parameters.attack ?? 0.01,
            decay: parameters.decay ?? 0.3,
            sustain: parameters.sustain ?? 0.7,
            release: parameters.release ?? 0.5
        };
        
        return instrumentGain;
    }

    /**
     * Create gain node
     */
    createGainNode(parameters) {
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = parameters.level ?? 1.0;
        return gainNode;
    }

    /**
     * Create delay node
     */
    createDelayNode(parameters) {
        const delayTime = parameters.time ?? 0.3;
        const feedback = parameters.feedback ?? 0.3;
        
        const delayNode = this.audioContext.createDelay(Math.max(delayTime, 1.0));
        delayNode.delayTime.value = delayTime;
        
        // Add feedback if specified
        if (feedback > 0) {
            const feedbackGain = this.audioContext.createGain();
            feedbackGain.gain.value = feedback;
            delayNode.connect(feedbackGain);
            feedbackGain.connect(delayNode);
        }
        
        return delayNode;
    }

    /**
     * Create reverb node (simplified convolution reverb)
     */
    createReverbNode(parameters) {
        const size = parameters.size ?? 2.0;
        const length = parameters.length ?? 2.0;
        
        // Create a simple reverb using multiple delays
        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 0.3;
        
        const delays = [];
        const delayTimes = [0.03, 0.05, 0.07, 0.09, 0.11, 0.13];
        
        for (const delayTime of delayTimes) {
            const delay = this.audioContext.createDelay(1.0);
            delay.delayTime.value = delayTime * size;
            
            const delayGain = this.audioContext.createGain();
            delayGain.gain.value = 0.2 / delayTimes.length;
            
            reverbGain.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(reverbGain); // Feedback
            
            delays.push({ delay, gain: delayGain });
        }
        
        return reverbGain;
    }

    /**
     * Create filter node
     */
    createFilterNode(type, parameters) {
        const filter = this.audioContext.createBiquadFilter();
        
        switch (type) {
            case 'lowpass':
                filter.type = 'lowpass';
                filter.frequency.value = parameters.cutoff ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
            case 'highpass':
                filter.type = 'highpass';
                filter.frequency.value = parameters.cutoff ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
            case 'bandpass':
                filter.type = 'bandpass';
                filter.frequency.value = parameters.frequency ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
        }
        
        return filter;
    }

    /**
     * Create sample node with buffer loading
     */
    createSampleNode(parameters) {
        const sampleGain = this.audioContext.createGain();
        sampleGain.gain.value = parameters.gain ?? 1.0;
        sampleGain._instrumentType = 'sample';
        sampleGain._sampleUrl = parameters.url;
        sampleGain._buffer = null;
        sampleGain._isLoading = false;
        
        // Load the audio buffer if URL is provided
        if (parameters.url) {
            this.loadSampleBuffer(sampleGain, parameters.url);
        }
        
        return sampleGain;
    }

    /**
     * Load audio buffer for sample node
     */
    async loadSampleBuffer(sampleNode, url) {
        if (sampleNode._isLoading) return;
        
        sampleNode._isLoading = true;
        
        try {
            console.log(`Loading sample: ${url}`);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Failed to load sample: ${response.status} ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            sampleNode._buffer = audioBuffer;
            sampleNode._isLoading = false;
            
            console.log(`Sample loaded successfully: ${url} (${audioBuffer.duration.toFixed(2)}s)`);
        } catch (error) {
            console.error(`Failed to load sample ${url}:`, error);
            sampleNode._isLoading = false;
        }
    }

    /**
     * Connect all nodes according to parsed connections
     */
    connectAllNodes(connections) {
        for (const connection of connections) {
            const sourceNode = this.nodeMap.get(connection.from);
            
            if (!sourceNode) {
                console.warn(`Source node not found: ${connection.from}`);
                continue;
            }

            if (connection.to === 'MASTER') {
                // Connect to destination
                sourceNode.connect(this.destination);
                console.log(`Connected ${connection.from} -> MASTER`);
            } else {
                const targetNode = this.nodeMap.get(connection.to);
                if (targetNode) {
                    sourceNode.connect(targetNode);
                    console.log(`Connected ${connection.from} -> ${connection.to}`);
                } else {
                    console.warn(`Target node not found: ${connection.to}`);
                }
            }
        }
    }

    /**
     * Build route references for pattern scheduling
     */
    buildRouteReferences(namedRoutes, nodes) {
        // Add individual instruments to route map
        for (const [nodeName, nodeDefinition] of nodes) {
            if (this.isInstrumentType(nodeDefinition.type)) {
                const audioNode = this.nodeMap.get(nodeName);
                if (audioNode) {
                    this.routeMap.set(nodeName, [audioNode]);
                }
            }
        }

        // Add named routes to route map
        for (const [routeName, routeDefinition] of namedRoutes) {
            const routeNodes = [];
            
            // Get all nodes in the route
            for (const nodeName of routeDefinition.allNodes) {
                if (nodeName !== 'MASTER') {
                    const audioNode = this.nodeMap.get(nodeName);
                    if (audioNode) {
                        routeNodes.push(audioNode);
                    }
                }
            }
            
            if (routeNodes.length > 0) {
                this.routeMap.set(routeName, routeNodes);
            }
        }
    }

    /**
     * Check if a node type is an instrument
     */
    isInstrumentType(type) {
        return ['sine', 'square', 'sawtooth', 'triangle', 'sample'].includes(type);
    }

    /**
     * Get the first (source) node for a route - used for pattern scheduling
     */
    getSourceNodeForRoute(routeName) {
        const routeNodes = this.routeMap.get(routeName);
        if (routeNodes && routeNodes.length > 0) {
            // Find the first instrument node in the route
            for (const node of routeNodes) {
                if (node._instrumentType) {
                    return node;
                }
            }
            // If no instrument found, return first node
            return routeNodes[0];
        }
        return null;
    }

    /**
     * Play a note on an instrument node
     */
    playNote(instrumentNode, frequency, duration = 1.0, time = 0) {
        if (!instrumentNode._instrumentType) {
            console.warn('Trying to play note on non-instrument node', instrumentNode);
            return;
        }

        const startTime = this.audioContext.currentTime + time;

        // Handle sample playback
        if (instrumentNode._instrumentType === 'sample') {
            return this.playSample(instrumentNode, frequency, duration, startTime);
        }

        // Handle oscillator playback
        const endTime = startTime + duration;

        // Create oscillator for this note
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = instrumentNode._instrumentType;
        oscillator.frequency.value = frequency;

        // Create envelope
        const envelope = this.audioContext.createGain();
        const params = instrumentNode._instrumentParams;

        // ADSR envelope
        envelope.gain.setValueAtTime(0, startTime);
        envelope.gain.linearRampToValueAtTime(1, startTime + params.attack);
        envelope.gain.linearRampToValueAtTime(params.sustain, startTime + params.attack + params.decay);
        envelope.gain.setValueAtTime(params.sustain, Math.max(0, endTime - params.release));
        envelope.gain.linearRampToValueAtTime(0, endTime);

        // Connect: oscillator -> envelope -> instrument node
        oscillator.connect(envelope);
        envelope.connect(instrumentNode);

        // Start and stop
        oscillator.start(startTime);
        oscillator.stop(endTime);

        return { oscillator, envelope };
    }

    /**
     * Play a sample buffer
     */
    playSample(sampleNode, frequency, duration, startTime) {
        if (!sampleNode._buffer) {
            if (!sampleNode._isLoading) {
                console.warn(`Sample buffer not loaded: ${sampleNode._sampleUrl}`);
            }
            return null;
        }

        // Create buffer source
        const bufferSource = this.audioContext.createBufferSource();
        bufferSource.buffer = sampleNode._buffer;

        // Calculate playback rate for pitch shifting (optional)
        // frequency parameter can be used to pitch shift samples
        // Base frequency is assumed to be middle C (261.63 Hz)
        if (typeof frequency === 'number' && frequency > 0) {
            const baseFrequency = 261.63; // Middle C
            bufferSource.playbackRate.value = frequency / baseFrequency;
        }

        // Create envelope for sample
        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(1, startTime);

        // Simple fade out if duration is shorter than sample
        const sampleDuration = sampleNode._buffer.duration / (bufferSource.playbackRate.value || 1);
        const actualDuration = Math.min(duration, sampleDuration);
        const fadeOutTime = Math.min(0.1, actualDuration * 0.1); // 10% fade out or 100ms max

        if (actualDuration > fadeOutTime) {
            envelope.gain.setValueAtTime(1, startTime + actualDuration - fadeOutTime);
            envelope.gain.linearRampToValueAtTime(0, startTime + actualDuration);
        }

        // Connect: buffer source -> envelope -> sample node
        bufferSource.connect(envelope);
        envelope.connect(sampleNode);

        // Start playback
        bufferSource.start(startTime);
        
        // Stop after duration or when sample ends
        bufferSource.stop(startTime + actualDuration);

        return { bufferSource, envelope };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioGraphBuilderV2;
}
