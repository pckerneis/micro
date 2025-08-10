/**
 * Base class for all audio nodes in the Micro livecoding environment
 * Provides common functionality for input/output connections and parameter management
 */
export class BaseAudioNode {
    constructor(audioContext, params = {}) {
        this.audioContext = audioContext;
        this.params = params;
        this.inputNode = null;
        this.outputNode = null;
        this.isConnected = false;
        
        // Create the actual audio nodes
        this.createNodes();
    }
    
    /**
     * Abstract method - must be implemented by subclasses
     * Creates the Web Audio API nodes for this effect
     */
    createNodes() {
        throw new Error('createNodes() must be implemented by subclasses');
    }
    
    /**
     * Connect this node to another node or destination
     * @param {BaseAudioNode|AudioNode|AudioDestinationNode} target 
     * @returns {BaseAudioNode} this (for chaining)
     */
    connectTo(target) {
        if (!this.outputNode) {
            throw new Error('Output node not initialized');
        }
        
        if (target instanceof BaseAudioNode) {
            this.outputNode.connect(target.inputNode);
        } else {
            // Assume it's a Web Audio API node or destination
            this.outputNode.connect(target);
        }
        
        this.isConnected = true;
        return this;
    }
    
    /**
     * Disconnect this node from all connections
     */
    disconnect() {
        if (this.outputNode) {
            this.outputNode.disconnect();
        }
        this.isConnected = false;
    }
    
    /**
     * Get the input node for connections
     */
    getInput() {
        return this.inputNode;
    }
    
    /**
     * Get the output node for connections
     */
    getOutput() {
        return this.outputNode;
    }
    
    /**
     * Update parameters dynamically
     * @param {Object} newParams 
     */
    updateParams(newParams) {
        this.params = { ...this.params, ...newParams };
        this.applyParams();
    }
    
    /**
     * Apply current parameters to the audio nodes
     * Should be implemented by subclasses if needed
     */
    applyParams() {
        // Default implementation does nothing
    }
}
