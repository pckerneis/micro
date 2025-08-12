import {OUTPUT_KEYWORD} from './constants.mjs';

/**
 * Simple Audio Graph Builder
 * Takes a parsed graph and returns connected AudioNodes
 */
export class AudioGraphBuilder {
    constructor(audioContext, outputNode) {
        this.audioContext = audioContext;
        this.outputNode = outputNode || audioContext.destination;
        this.routeMap = new Map(); // Map of route names to AudioNode arrays
        this.activeNodeCallback = null; // Callback to register active audio nodes
        this.nodeMap = new Map();
        this.sampleLoadPromises = [];
    }

    /**
     * Set callback for tracking active audio nodes
     */
    setActiveNodeCallback(callback) {
        this.activeNodeCallback = callback;
    }

    /**
     * Convert a parameter value to linear gain.
     * Supports:
     * - number (linear)
     * - { unit: 'dB', value: x }
     * - string like "-6dB" or "-6 dB"
     */
    resolveGainValue(value, defaultValue = 1.0) {
        if (value == null) return defaultValue;
        if (typeof value === 'number' && isFinite(value)) return value;
        if (typeof value === 'object' && value && value.unit === 'dB' && typeof value.value === 'number') {
            return Math.pow(10, value.value / 20);
        }
        if (typeof value === 'string') {
            const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*dB\s*$/i);
            if (m) {
                const db = parseFloat(m[1]);
                return Math.pow(10, db / 20);
            }
            const num = parseFloat(value);
            if (isFinite(num)) return num;
        }
        return defaultValue;
    }

    /**
     * Build the complete audio graph from parsed graph
     * @param {Object} parsedGraph - Output from GraphParser
     * @returns {Map<string, AudioNode[]>} Map of route/instrument names to AudioNode arrays
     */
    async buildGraph(parsedGraph) {
        // Clear previous state
        this.nodeMap.clear();
        this.routeMap.clear();
        this.sampleLoadPromises = [];

        // Step 1: Create all AudioNodes
        this.createAllNodes(parsedGraph.nodes);

        // Step 2: Connect all nodes according to connections
        this.connectAllNodes(parsedGraph.connections);

        // Step 3: Build route references for pattern scheduling
        this.buildRouteReferences(parsedGraph.namedRoutes, parsedGraph.nodes);

        // Wait for any sample buffers to finish loading before returning
        if (this.sampleLoadPromises.length > 0) {
            try {
                await Promise.all(this.sampleLoadPromises);
            } catch (e) {
                console.warn('Some samples failed to load:', e);
            }
        }

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
        // Keep raw params as well (for modulators: frequency, level, etc.)
        instrumentGain._rawParams = { ...parameters };
        instrumentGain._paramModulations = {}; // paramName -> [AudioNode]
        
        return instrumentGain;
    }

    /**
     * Create gain node
     */
    createGainNode(parameters) {
        const gainNode = this.audioContext.createGain();
        const levelParam = (parameters.level !== undefined)
            ? parameters.level
            : (parameters.volume !== undefined)
                ? parameters.volume
                : (parameters.gain !== undefined)
                    ? parameters.gain
                    : 1.0;
        gainNode.gain.value = this.resolveGainValue(levelParam, 1.0);
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
        reverbGain.gain.value = 0.8;
        
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
        sampleGain.gain.value = this.resolveGainValue(parameters.gain ?? 1.0, 1.0);
        sampleGain._instrumentType = 'sample';
        sampleGain._sampleUrl = parameters.url;
        sampleGain._buffer = null;
        sampleGain._isLoading = false;
        sampleGain._rawParams = { ...parameters };
        sampleGain._paramModulations = {};
        
        // Load the audio buffer if URL is provided
        if (parameters.url) {
            const p = this.loadSampleBuffer(sampleGain, parameters.url);
            this.sampleLoadPromises.push(p);
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

            if (connection.to === OUTPUT_KEYWORD) {
                // Connect to provided output node (e.g., master gain)
                sourceNode.connect(this.outputNode);
                console.log(`Connected ${connection.from} -> OUT`);
            } else {
                const targetNode = this.nodeMap.get(connection.to);
                if (targetNode) {
                    if (connection.toParam) {
                        // Handle AudioParam connections
                        this.connectToParam(sourceNode, targetNode, connection.toParam);
                        console.log(`Connected ${connection.from} -> ${connection.to}.${connection.toParam}`);
                    } else {
                        sourceNode.connect(targetNode);
                        console.log(`Connected ${connection.from} -> ${connection.to}`);
                    }
                } else {
                    console.warn(`Target node not found: ${connection.to}`);
                }
            }
        }
    }

    /**
     * Ensure instrument node has modulation list for a parameter
     */
    ensureParamModList(instrumentNode, paramName) {
        if (!instrumentNode._paramModulations) instrumentNode._paramModulations = {};
        if (!instrumentNode._paramModulations[paramName]) instrumentNode._paramModulations[paramName] = [];
        return instrumentNode._paramModulations[paramName];
    }

    /**
     * Create or reuse a continuous oscillator modulator from an instrument node definition
     * Used when an instrument node is used as a modulation source rather than a note-triggered instrument.
     */
    getOrCreateContinuousModulator(sourceInstrumentNode) {
        if (sourceInstrumentNode._continuousModulatorOutput) return sourceInstrumentNode._continuousModulatorOutput;
        const osc = this.audioContext.createOscillator();
        osc.type = sourceInstrumentNode._instrumentType || 'sine';
        // Frequency from raw params or a reasonable LFO default
        const rp = sourceInstrumentNode._rawParams || {};
        const freq = (typeof rp.frequency === 'number') ? rp.frequency : 2.0;
        osc.frequency.value = freq;
        // Optional depth/level scaling
        const levelParam = rp.level ?? rp.gain ?? rp.amount;
        const gain = this.audioContext.createGain();
        gain.gain.value = this.resolveGainValue(levelParam, 1.0);
        osc.connect(gain);
        try { osc.start(); } catch (e) { /* already started */ }
        sourceInstrumentNode._continuousOscillator = osc;
        sourceInstrumentNode._continuousModGain = gain;
        sourceInstrumentNode._continuousModulatorOutput = gain;
        // Track active node if callback present
        if (this.activeNodeCallback) {
            this.activeNodeCallback(osc);
        }
        return gain;
    }

    /**
     * Connect source to a target AudioParam or store for instrument per-note application
     */
    connectToParam(sourceNode, targetNode, paramName) {
        // If target is an instrument wrapper (Gain), defer to per-note modulation
        if (targetNode._instrumentType) {
            const mods = this.ensureParamModList(targetNode, paramName);
            let sourceOut = sourceNode;
            if (sourceNode._instrumentType) {
                // Use a continuous oscillator from the instrument def as modulator
                sourceOut = this.getOrCreateContinuousModulator(sourceNode);
            }
            mods.push(sourceOut);
            return;
        }

        // Non-instrument target: connect directly to the AudioParam if present
        const targetParam = targetNode && targetNode[paramName];
        if (targetParam && typeof targetParam.setValueAtTime === 'function') {
            let sourceOut = sourceNode;
            if (sourceNode._instrumentType) {
                sourceOut = this.getOrCreateContinuousModulator(sourceNode);
            }
            try {
                sourceOut.connect(targetParam);
            } catch (e) {
                console.warn(`Failed to connect to param ${paramName} on target`, e);
            }
        } else {
            console.warn(`Target parameter not found or not an AudioParam: ${paramName}`);
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
            const routeNodeSet = new Set();

            // Always include the actual first node of the route, resolving nested routes
            const firstNodeName = this.resolveFirstNodeName(routeDefinition.firstNode, namedRoutes);
            const firstAudioNode = this.nodeMap.get(firstNodeName);
            if (firstAudioNode) {
                routeNodeSet.add(firstAudioNode);
            }

            // Include other nodes, resolving nested route references where possible
            for (const nodeName of routeDefinition.allNodes) {
                if (nodeName === OUTPUT_KEYWORD) continue;
                const resolvedName = this.resolveFirstNodeName(nodeName, namedRoutes);
                const audioNode = this.nodeMap.get(resolvedName);
                if (audioNode) {
                    routeNodeSet.add(audioNode);
                }
            }

            const routeNodes = Array.from(routeNodeSet);
            if (routeNodes.length > 0) {
                this.routeMap.set(routeName, routeNodes);
            }
        }
    }

    /**
     * Resolve to the underlying node name if the provided name is a route.
     * For targets (sources for scheduling), we want the first node of the route.
     */
    resolveFirstNodeName(name, namedRoutes) {
        let current = name;
        const guard = new Set();
        while (namedRoutes && namedRoutes.has(current)) {
            if (guard.has(current)) break; // prevent cycles
            guard.add(current);
            const route = namedRoutes.get(current);
            current = route.firstNode;
        }
        return current;
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
        console.log('play note')
        if (!instrumentNode._instrumentType) {
            console.warn('Trying to play note on non-instrument node', instrumentNode);
            return;
        }

        // 'time' is expected to be an absolute AudioContext time. If not provided, use now.
        let startTime = (typeof time === 'number' && time > 0) ? time : this.audioContext.currentTime;
        // Clamp to a tiny bit in the future to avoid past-start edge cases
        const now = this.audioContext.currentTime;
        startTime = Math.max(startTime, now + 0.005);
        // console.log({ startTime })

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

        // ADSR envelope with safe pre-zero and minimum attack to avoid burst
        const eps = 0.001;
        const attack = Math.max(0.005, params.attack ?? 0.01);
        const decay = Math.max(0, params.decay ?? 0.3);
        const sustain = params.sustain ?? 0.7;
        const release = Math.max(0, params.release ?? 0.5);
        const t0 = startTime - eps;
        envelope.gain.cancelScheduledValues(t0);
        envelope.gain.setValueAtTime(0, t0);
        envelope.gain.linearRampToValueAtTime(1, startTime + attack);
        envelope.gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
        envelope.gain.setValueAtTime(sustain, Math.max(0, endTime - release));
        envelope.gain.linearRampToValueAtTime(0, endTime);

        // Connect: oscillator -> envelope -> instrument node
        oscillator.connect(envelope);
        envelope.connect(instrumentNode);

        // Apply per-note param modulations (e.g., FM/AM)
        const mods = instrumentNode._paramModulations || {};
        if (mods.frequency && oscillator.frequency) {
            for (const modNode of mods.frequency) {
                try { modNode.connect(oscillator.frequency); } catch (e) { /* ignore */ }
            }
        }
        if (mods.detune && oscillator.detune) {
            for (const modNode of mods.detune) {
                try { modNode.connect(oscillator.detune); } catch (e) { /* ignore */ }
            }
        }

        // Register active node for tracking
        if (this.activeNodeCallback) {
            this.activeNodeCallback(oscillator);
        }

        // Start and stop
        oscillator.start(startTime);
        oscillator.stop(endTime);

        console.log('osc')

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

        // Clamp start time to avoid past scheduling
        const now = this.audioContext.currentTime;
        startTime = Math.max(startTime, now + 0.005);

        // Create envelope for sample with short fade-in to avoid burst/click
        const envelope = this.audioContext.createGain();
        const eps = 0.001;
        const fadeIn = 0.005; // 5ms fade-in
        const t0 = startTime - eps;
        envelope.gain.cancelScheduledValues(t0);
        envelope.gain.setValueAtTime(0, t0);
        envelope.gain.linearRampToValueAtTime(1, startTime + fadeIn);

        // Simple fade out if duration is shorter than sample
        const sampleDuration = sampleNode._buffer.duration / (bufferSource.playbackRate.value || 1);
        const actualDuration = Math.max(0.01, Math.min(duration, sampleDuration));
        const fadeOutTime = Math.min(0.1, actualDuration * 0.1); // 10% fade out or 100ms max

        if (actualDuration > fadeOutTime) {
            envelope.gain.setValueAtTime(1, startTime + actualDuration - fadeOutTime);
            envelope.gain.linearRampToValueAtTime(0, startTime + actualDuration);
        }

        // Connect: buffer source -> envelope -> sample node
        bufferSource.connect(envelope);
        envelope.connect(sampleNode);

        // Apply per-note param modulations (playbackRate)
        const mods = sampleNode._paramModulations || {};
        if (mods.playbackRate && bufferSource.playbackRate) {
            for (const modNode of mods.playbackRate) {
                try { modNode.connect(bufferSource.playbackRate); } catch (e) { /* ignore */ }
            }
        }

        // Register active node for tracking
        if (this.activeNodeCallback) {
            this.activeNodeCallback(bufferSource);
        }

        // Start playback
        bufferSource.start(startTime);
        
        // Stop after duration or when sample ends
        bufferSource.stop(startTime + actualDuration);

        return { bufferSource, envelope };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioGraphBuilder;
}
