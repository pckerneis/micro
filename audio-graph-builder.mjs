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
        this.sampleRegistry = new Map(); // name -> AudioBuffer (provided by app)
    }

    /**
     * Set callback for tracking active audio nodes
     */
    setActiveNodeCallback(callback) {
        this.activeNodeCallback = callback;
    }

    /**
     * Provide a registry of decoded AudioBuffers keyed by name
     */
    setSampleRegistry(registry) {
        if (registry && typeof registry.get === 'function') {
            this.sampleRegistry = registry;
        } else if (registry && typeof registry === 'object') {
            // Allow plain object mapping
            this.sampleRegistry = new Map(Object.entries(registry));
        } else {
            this.sampleRegistry = new Map();
        }
        // Update existing sample nodes to bind buffers by name when available
        if (this.nodeMap && this.nodeMap.size > 0) {
            for (const node of this.nodeMap.values()) {
                if (node && node._instrumentType === 'sample' && node._sampleName && !node._buffer) {
                    if (this.sampleRegistry.has(node._sampleName)) {
                        node._buffer = this.sampleRegistry.get(node._sampleName);
                    }
                }
            }
        }
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
            release: parameters.release ?? 0.1
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
        const mix = Math.max(0, Math.min(1, parameters.mix ?? 0.3));

        // Build composite: input -> [dry, convolver->wet] -> output
        const input = this.audioContext.createGain();
        const output = this.audioContext.createGain();
        const dry = this.audioContext.createGain();
        const wet = this.audioContext.createGain();

        const delayNode = this.audioContext.createDelay(Math.max(delayTime, 1.0));
        delayNode.delayTime.value = delayTime;

        dry.gain.value = 1 - mix;
        wet.gain.value = mix;

        input.connect(dry);
        input.connect(delayNode);
        delayNode.connect(wet);
        dry.connect(output);
        wet.connect(output);

        // Expose composite ends for graph connections
        output._input = input;   // when connecting TO this effect, use _input
        output._output = output; // when connecting FROM this effect, use node itself
        
        // Add feedback if specified
        if (feedback > 0) {
            const feedbackGain = this.audioContext.createGain();
            feedbackGain.gain.value = feedback;
            delayNode.connect(feedbackGain);
            feedbackGain.connect(delayNode);
        }
        
        return output;
    }
    
    /**
     * Create reverb node using ConvolverNode with generated impulse response.
     * Supported params:
     * - length (seconds) or size: overall reverb length
     * - decay: exponential decay factor (higher = longer tail emphasis)
     * - mix: 0..1 dry/wet balance (default 0.5)
     */
    createReverbNode(parameters) {
        const duration = (parameters.length ?? parameters.size ?? 2.0);
        const decay = (parameters.decay ?? 0.5);
        const mix = Math.max(0, Math.min(1, parameters.mix ?? 0.5));

        // Build composite: input -> [dry, convolver->wet] -> output
        const input = this.audioContext.createGain();
        const output = this.audioContext.createGain();
        const dry = this.audioContext.createGain();
        const wet = this.audioContext.createGain();
        const convolver = this.audioContext.createConvolver();
        convolver.buffer = this.generateImpulseResponse(duration, decay);

        dry.gain.value = 1 - mix;
        wet.gain.value = mix;

        input.connect(dry);
        input.connect(convolver);
        convolver.connect(wet);
        dry.connect(output);
        wet.connect(output);

        // Expose composite ends for graph connections
        output._input = input;   // when connecting TO this effect, use _input
        output._output = output; // when connecting FROM this effect, use node itself
        return output;
    }

    /**
     * Generate an AudioBuffer impulse response for the convolver.
     */
    generateImpulseResponse(duration, decay) {
        const sampleRate = this.audioContext.sampleRate;
        const length = Math.max(1, Math.floor(sampleRate * Math.max(0.01, duration)));
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const env = Math.pow(1 - (t / Math.max(0.01, duration)), Math.max(0.001, decay) * 3);
                // Add a hint of early reflections in first 100ms
                let sample = (Math.random() * 2 - 1) * env;
                if (i < sampleRate * 0.1) {
                    const early = Math.sin(i * 0.01) * env * 0.5;
                    sample += early;
                }
                channelData[i] = sample;
            }
        }
        return impulse;
    }

    /**
     * Create filter node
     */
    createFilterNode(type, parameters) {
        const filter = this.audioContext.createBiquadFilter();
        
        switch (type) {
            case 'lowpass':
                filter.type = 'lowpass';
                filter.frequency.value = parameters.frequency ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
            case 'highpass':
                filter.type = 'highpass';
                filter.frequency.value = parameters.frequency ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
            case 'bandpass':
                filter.type = 'bandpass';
                filter.frequency.value = parameters.frequency ?? 1000;
                filter.Q.value = parameters.q ?? 1.0;
                break;
        }
        // For consistency with composite effects, expose _input/_output
        // so routing code can treat all effects uniformly.
        filter._input = filter;
        filter._output = filter;
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
        sampleGain._sampleName = parameters.name;
        sampleGain._buffer = null;
        sampleGain._isLoading = false;
        sampleGain._rawParams = { ...parameters };
        sampleGain._paramModulations = {};
        
        // 1) Prefer in-memory buffer by name if provided
        if (parameters.name && this.sampleRegistry && this.sampleRegistry.has(parameters.name)) {
            sampleGain._buffer = this.sampleRegistry.get(parameters.name);
        } else if (parameters.url) {
            // 2) Fallback to loading from URL
            const p = this.loadSampleBuffer(sampleGain, parameters.url);
            this.sampleLoadPromises.push(p);
        } else if (parameters.name) {
            console.warn(`Sample named "${parameters.name}" not found in registry and no URL provided.`);
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
                const src = sourceNode._output || sourceNode;
                src.connect(this.outputNode);
                console.log(`Connected ${connection.from} -> OUT`);
            } else {
                const targetNode = this.nodeMap.get(connection.to);
                if (targetNode) {
                    if (connection.toParam) {
                        // Handle AudioParam connections
                        this.connectToParam(sourceNode, targetNode, connection.toParam);
                        console.log(`Connected ${connection.from} -> ${connection.to}.${connection.toParam}`);
                    } else {
                        const src = sourceNode._output || sourceNode;
                        const dst = targetNode._input || targetNode;
                        src.connect(dst);
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
     * Resolve an AudioParam on a target node by name.
     * Handles common synonyms and checks both node and its _output/_input wrappers.
     */
    getAudioParam(targetNode, paramName) {
        if (!targetNode) return null;
        // Normalize common synonyms
        let key = paramName;
        if (key === 'cutoff') key = 'frequency';
        if (key === 'resonance') key = 'Q';
        if (key === 'q') key = 'Q';

        const candidates = [
            targetNode,
            targetNode._output || null,
            targetNode._input || null,
        ];
        for (const obj of candidates) {
            if (!obj) continue;
            const p = obj[key];
            if (p && typeof p.setValueAtTime === 'function') return p;
        }
        return null;
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
        osc.frequency.value = (typeof rp.frequency === 'number') ? rp.frequency : 2.0;
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
        const targetParam = this.getAudioParam(targetNode, paramName);
        if (targetParam) {
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
    playNote(instrumentNode, frequency, duration = 1.0, time = 0, velocity = 1.0) {
        if (!instrumentNode._instrumentType) {
            console.warn('Trying to play note on non-instrument node', instrumentNode);
            return;
        }

        // 'time' is expected to be an absolute AudioContext time. If not provided, use now.
        let startTime = (typeof time === 'number' && time > 0) ? time : this.audioContext.currentTime;
        // Clamp to a tiny bit in the future to avoid past-start edge cases
        const now = this.audioContext.currentTime;
        startTime = Math.max(startTime, now + 0.005);

        // Handle sample playback
        if (instrumentNode._instrumentType === 'sample') {
            return this.playSample(instrumentNode, frequency, duration, startTime, velocity);
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
        const minGain = 0.01;
        const t0 = startTime - eps;
        envelope.gain.cancelScheduledValues(t0);
        envelope.gain.setValueAtTime(0, t0);
        envelope.gain.exponentialRampToValueAtTime(Math.max(minGain, velocity), startTime + attack);
        envelope.gain.exponentialRampToValueAtTime(Math.max(minGain, sustain * velocity), startTime + attack + decay);
        // Hold sustain until the end of the step, then start release
        envelope.gain.setValueAtTime(sustain * velocity, endTime);
        envelope.gain.exponentialRampToValueAtTime(minGain, endTime + release);
        envelope.gain.setValueAtTime(0, endTime + release + eps);

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
        oscillator.stop(endTime + release);

        return { oscillator, envelope };
    }

    /**
     * Play a sample buffer
     */
    playSample(sampleNode, frequency, duration, startTime, velocity = 1.0) {
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
        envelope.gain.linearRampToValueAtTime(velocity, startTime + fadeIn);

        // Hold until step end, then apply release
        const sampleDuration = sampleNode._buffer.duration / (bufferSource.playbackRate.value || 1);
        const actualDuration = Math.max(0.01, Math.min(duration, sampleDuration));
        const params = sampleNode._instrumentParams || {};
        const release = Math.max(0, params.release ?? 0.1);
        envelope.gain.setValueAtTime(velocity, startTime + actualDuration);
        envelope.gain.linearRampToValueAtTime(0, startTime + actualDuration + release);

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
        
        // Stop after duration + release (or when sample ends)
        bufferSource.stop(startTime + actualDuration + release);

        return { bufferSource, envelope };
    }
}
