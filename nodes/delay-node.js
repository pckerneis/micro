import { BaseAudioNode } from './base-node.js';

/**
 * Pure delay line effect - no feedback, no wet gain
 * Feedback and mixing should be implemented via routing
 */
export class DelayNode extends BaseAudioNode {
    constructor(audioContext, params = {}) {
        super(audioContext, params);
    }
    
    createNodes() {
        this.delayNode = this.audioContext.createDelay();
        
        // Set delay time with validation
        const delayTime = this.getDelayTime();
        this.delayNode.delayTime.value = delayTime;
        
        // Pure delay line - input and output are the same node
        this.inputNode = this.delayNode;
        this.outputNode = this.delayNode;
    }
    
    getDelayTime() {
        const time = this.params.time;
        
        // Validate and clamp delay time
        if (!isFinite(time) || time <= 0) {
            return 0.25; // Default 250ms
        }
        
        // Web Audio API delay max is typically 1 second
        return Math.min(time, 1.0);
    }
    
    applyParams() {
        if (this.delayNode) {
            const delayTime = this.getDelayTime();
            this.delayNode.delayTime.value = delayTime;
        }
    }
    
    /**
     * Get the delay time in seconds
     */
    getTime() {
        return this.delayNode ? this.delayNode.delayTime.value : 0;
    }
    
    /**
     * Set the delay time in seconds
     * @param {number} time - Delay time in seconds
     */
    setTime(time) {
        this.params.time = time;
        this.applyParams();
    }
}
