import { DelayNode } from './delay-node.js';
import { GainNode } from './gain-node.js';
import { LowpassNode } from './lowpass-node.js';

/**
 * Factory for creating audio effect nodes
 * Centralizes effect creation and eliminates code duplication
 */
export class EffectFactory {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.effectTypes = new Map([
            ['delay', DelayNode],
            ['gain', GainNode],
            ['lowpass', LowpassNode]
        ]);
    }
    
    /**
     * Create an effect node by type
     * @param {string} type - Effect type ('delay', 'gain', 'lowpass', etc.)
     * @param {Object} params - Effect parameters
     * @returns {BaseAudioNode} The created effect node
     */
    createEffect(type, params = {}) {
        const EffectClass = this.effectTypes.get(type);
        
        if (!EffectClass) {
            throw new Error(`Unknown effect type: ${type}`);
        }
        
        return new EffectClass(this.audioContext, params);
    }
    
    /**
     * Create an effect from a parsed effect object
     * @param {Object} effect - Parsed effect object with type and parameters
     * @returns {BaseAudioNode} The created effect node
     */
    createFromEffect(effect) {
        return this.createEffect(effect.type, effect);
    }
    
    /**
     * Register a new effect type
     * @param {string} type - Effect type name
     * @param {Class} EffectClass - Effect class constructor
     */
    registerEffect(type, EffectClass) {
        this.effectTypes.set(type, EffectClass);
    }
    
    /**
     * Get all available effect types
     * @returns {string[]} Array of effect type names
     */
    getAvailableEffects() {
        return Array.from(this.effectTypes.keys());
    }
    
    /**
     * Check if an effect type is supported
     * @param {string} type - Effect type to check
     * @returns {boolean} True if supported
     */
    isSupported(type) {
        return this.effectTypes.has(type);
    }
    
    /**
     * Create a chain of effects
     * @param {Array} effects - Array of effect objects
     * @returns {Array} Array of connected effect nodes
     */
    createEffectChain(effects) {
        const nodes = effects.map(effect => this.createFromEffect(effect));
        
        // Connect the chain
        for (let i = 0; i < nodes.length - 1; i++) {
            nodes[i].connectTo(nodes[i + 1]);
        }
        
        return nodes;
    }
}
