import { BaseAudioNode } from './base-node.js';

/**
 * Lowpass filter effect node
 * Attenuates frequencies above the cutoff frequency
 */
export class LowpassNode extends BaseAudioNode {
    constructor(audioContext, params = {}) {
        super(audioContext, params);
    }
    
    createNodes() {
        this.filterNode = this.audioContext.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        
        // Set filter parameters with validation
        const cutoff = this.getCutoffFrequency();
        const q = this.getQFactor();
        
        this.filterNode.frequency.value = cutoff;
        this.filterNode.Q.value = q;
        
        // Input and output are the same node
        this.inputNode = this.filterNode;
        this.outputNode = this.filterNode;
    }
    
    getCutoffFrequency() {
        const cutoff = this.params.cutoff;
        
        // Validate cutoff frequency
        if (!isFinite(cutoff) || cutoff <= 0) {
            return 1000; // Default 1kHz
        }
        
        // Clamp to Nyquist frequency
        const nyquist = this.audioContext.sampleRate / 2;
        return Math.min(cutoff, nyquist);
    }
    
    getQFactor() {
        const q = this.params.q || this.params.resonance;
        
        // Validate Q factor
        if (!isFinite(q) || q <= 0) {
            return 1.0; // Default Q
        }
        
        // Reasonable Q range for musical applications
        return Math.max(0.1, Math.min(q, 30));
    }
    
    applyParams() {
        if (this.filterNode) {
            const cutoff = this.getCutoffFrequency();
            const q = this.getQFactor();
            
            this.filterNode.frequency.value = cutoff;
            this.filterNode.Q.value = q;
        }
    }
    
    /**
     * Get the current cutoff frequency
     */
    getCutoff() {
        return this.filterNode ? this.filterNode.frequency.value : 1000;
    }
    
    /**
     * Set the cutoff frequency
     * @param {number} frequency - Cutoff frequency in Hz
     */
    setCutoff(frequency) {
        this.params.cutoff = frequency;
        this.applyParams();
    }
    
    /**
     * Get the current Q factor (resonance)
     */
    getQ() {
        return this.filterNode ? this.filterNode.Q.value : 1.0;
    }
    
    /**
     * Set the Q factor (resonance)
     * @param {number} q - Q factor (higher = more resonant)
     */
    setQ(q) {
        this.params.q = q;
        this.applyParams();
    }
    
    /**
     * Sweep the cutoff frequency over time
     * @param {number} targetFreq - Target frequency in Hz
     * @param {number} duration - Sweep duration in seconds
     * @param {number} startTime - When to start the sweep
     */
    sweepTo(targetFreq, duration, startTime = null) {
        if (!this.filterNode) return;
        
        const when = startTime || this.audioContext.currentTime;
        this.filterNode.frequency.setValueAtTime(this.filterNode.frequency.value, when);
        this.filterNode.frequency.exponentialRampToValueAtTime(targetFreq, when + duration);
        
        // Update params to reflect the target
        this.params.cutoff = targetFreq;
    }
}
