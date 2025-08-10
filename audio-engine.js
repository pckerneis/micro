class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.instruments = new Map();
        this.patterns = new Map();
        this.isPlaying = false;
        this.startTime = 0;
        this.bpm = 120;
        this.beatDuration = 60 / this.bpm;
        this.scheduledEvents = [];
        this.nextEventTime = 0;
        this.scheduleAheadTime = 25.0; // 25ms ahead
        this.lookahead = 25.0;
        this.timerID = null;
    }

    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.value = 0.7;
            
            console.log('Audio engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize audio engine:', error);
            return false;
        }
    }

    createSample(url) {
        return new SampleInstrument(this.audioContext, this.masterGain, url);
    }

    createOscillator(type, options = {}) {
        return new OscillatorInstrument(this.audioContext, this.masterGain, type, options);
    }

    addPattern(name, notes, duration) {
        this.patterns.set(name, { notes, duration, currentStep: 0 });
    }

    play() {
        if (this.isPlaying) return;
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.nextEventTime = 0;
        this.scheduler();
    }

    stop() {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = null;
        }
        
        // Reset pattern positions
        this.patterns.forEach(pattern => {
            pattern.currentStep = 0;
        });
    }

    scheduler() {
        while (this.nextEventTime < this.audioContext.currentTime + this.scheduleAheadTime / 1000) {
            this.scheduleNote(this.nextEventTime);
            this.nextEventTime += this.beatDuration / 4; // 16th note resolution
        }
        
        if (this.isPlaying) {
            this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
        }
    }

    scheduleNote(time) {
        this.patterns.forEach((pattern, name) => {
            const instrument = this.instruments.get(name);
            if (!instrument) return;

            const stepTime = pattern.duration * this.beatDuration;
            const currentBeat = (time - this.startTime) % stepTime;
            
            if (Math.abs(currentBeat) < 0.01 || Math.abs(currentBeat - stepTime) < 0.01) {
                const note = pattern.notes[pattern.currentStep % pattern.notes.length];
                if (note !== '_' && note !== null) {
                    instrument.play(note, this.startTime + time);
                }
                pattern.currentStep++;
            }
        });
    }
}

class SampleInstrument {
    constructor(audioContext, destination, url) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.url = url;
        this.buffer = null;
        this.loadSample();
    }

    async loadSample() {
        try {
            // For demo purposes, create a synthetic drum sound
            this.buffer = this.createSyntheticDrum();
        } catch (error) {
            console.warn(`Could not load sample ${this.url}, using synthetic sound`);
            this.buffer = this.createSyntheticDrum();
        }
    }

    createSyntheticDrum() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 0.2; // 200ms
        const buffer = this.audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-t * 30);
            const noise = (Math.random() * 2 - 1) * 0.3;
            const tone = Math.sin(2 * Math.PI * 60 * t) * 0.7;
            data[i] = (noise + tone) * envelope;
        }

        return buffer;
    }

    play(note, time) {
        if (!this.buffer) return;

        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        
        source.buffer = this.buffer;
        source.connect(gainNode);
        gainNode.connect(this.destination);
        
        gainNode.gain.value = 0.8;
        source.start(time);
    }
}

class OscillatorInstrument {
    constructor(audioContext, destination, type, options = {}) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.type = type;
        this.options = {
            attack: options.attack || 0.01,
            decay: options.decay || 0.3,
            sustain: options.sustain || 0.3,
            release: options.release || 0.5,
            ...options
        };
        this.effects = [];
    }

    addEffect(effect) {
        this.effects.push(effect);
        return this;
    }

    delay(time) {
        return this.addEffect({ type: 'delay', time });
    }

    play(note, time) {
        // Handle chords (arrays of notes)
        if (Array.isArray(note)) {
            note.forEach(n => this.playSingleNote(n, time));
            return;
        }
        
        this.playSingleNote(note, time);
    }
    
    playSingleNote(note, time) {
        // Validate note value
        if (typeof note !== 'number' || !isFinite(note)) {
            console.warn(`Invalid note value: ${note}`);
            return;
        }
        
        const frequency = this.noteToFreq(note);
        
        // Validate frequency
        if (!isFinite(frequency) || frequency <= 0) {
            console.warn(`Invalid frequency: ${frequency} for note: ${note}`);
            return;
        }
        
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        osc.type = this.type;
        osc.frequency.value = frequency;
        
        // ADSR envelope with validation
        const { attack, decay, sustain, release } = this.options;
        const now = time || this.audioContext.currentTime;
        
        // Validate envelope values
        const validAttack = isFinite(attack) && attack >= 0 ? attack : 0.01;
        const validDecay = isFinite(decay) && decay >= 0 ? decay : 0.3;
        const validSustain = isFinite(sustain) && sustain >= 0 && sustain <= 1 ? sustain : 0.3;
        const validRelease = isFinite(release) && release >= 0 ? release : 0.5;
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.8, now + validAttack);
        gainNode.gain.linearRampToValueAtTime(validSustain, now + validAttack + validDecay);
        gainNode.gain.linearRampToValueAtTime(0, now + validAttack + validDecay + validRelease);
        
        // Connect through effects chain
        let currentNode = osc;
        this.effects.forEach(effect => {
            if (effect.type === 'delay') {
                const delay = this.audioContext.createDelay();
                const feedback = this.audioContext.createGain();
                const wetGain = this.audioContext.createGain();
                
                // Validate delay time
                const delayTime = isFinite(effect.time) && effect.time > 0 ? effect.time : 0.25;
                delay.delayTime.value = Math.min(delayTime, 1.0); // Max 1 second delay
                feedback.gain.value = 0.3;
                wetGain.gain.value = 0.3;
                
                currentNode.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(wetGain);
                wetGain.connect(gainNode);
            }
        });
        
        currentNode.connect(gainNode);
        gainNode.connect(this.destination);
        
        osc.start(now);
        osc.stop(now + validAttack + validDecay + validRelease);
    }

    noteToFreq(note) {
        // This should only handle single notes now
        if (typeof note !== 'number' || !isFinite(note)) {
            return 440; // Default to A4 if invalid
        }
        
        // Clamp note to reasonable MIDI range (0-127)
        const clampedNote = Math.max(0, Math.min(127, note));
        return 440 * Math.pow(2, (clampedNote - 69) / 12);
    }
}
