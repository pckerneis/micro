import { BaseAudioNode } from './base-node.js';

/**
 * Gain/volume control effect node
 * Provides amplification or attenuation of the audio signal
 */
export class GainNode extends BaseAudioNode {
    constructor(audioContext, params = {}) {
        super(audioContext, params);
    }
    
    createNodes() {
        this.gainNode = this.audioContext.createGain();
        
        // Set gain level with validation
        const gainLevel = this.getGainLevel();
        this.gainNode.gain.value = gainLevel;
        
        // Input and output are the same node
        this.inputNode = this.gainNode;
        this.outputNode = this.gainNode;
    }
    
    getGainLevel() {
        const level = this.params.level;
        
        // Validate gain level
        if (!isFinite(level) || level < 0) {
            return 1.0; // Default unity gain
        }
        
        return level;
    }
    
    applyParams() {
        if (this.gainNode) {
            const gainLevel = this.getGainLevel();
            this.gainNode.gain.value = gainLevel;
        }
    }
    
    /**
     * Get the current gain level
     */
    getLevel() {
        return this.gainNode ? this.gainNode.gain.value : 1.0;
    }
    
    /**
     * Set the gain level
     * @param {number} level - Gain level (0.0 = silence, 1.0 = unity, >1.0 = amplification)
     */
    setLevel(level) {
        this.params.level = level;
        this.applyParams();
    }
    
    /**
     * Fade to a new gain level over time
     * @param {number} targetLevel - Target gain level
     * @param {number} duration - Fade duration in seconds
     * @param {number} startTime - When to start the fade (audioContext.currentTime + offset)
     */
    fadeTo(targetLevel, duration, startTime = null) {
        if (!this.gainNode) return;
        
        const when = startTime || this.audioContext.currentTime;
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, when);
        this.gainNode.gain.linearRampToValueAtTime(targetLevel, when + duration);
        
        // Update params to reflect the target
        this.params.level = targetLevel;
    }
}
