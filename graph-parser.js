/**
 * New Graph-based Parser for Micro Livecoding Environment
 * Parses the enhanced curly-brace syntax and outputs an audio graph
 * Decoupled from the audio engine for better separation of concerns
 */

class GraphParser {
    constructor() {
        this.nodes = new Map();           // name -> NodeDefinition
        this.connections = [];            // array of Connection objects
        this.patterns = new Map();        // name -> PatternDefinition
        this.errors = [];
    }

    /**
     * Parse the complete code and return an audio graph
     * @param {string} code - The livecoding source code
     * @returns {Object} Audio graph with nodes, connections, patterns, and errors
     */
    parse(code) {
        this.reset();
        
        const lines = this.preprocessLines(code);
        
        // Parse in multiple passes
        this.parseNodeDefinitions(lines);
        this.parseRoutingLines(lines);
        this.parsePatterns(lines);
        
        // Add default STEREO connections for instruments without explicit routing
        this.addDefaultStereoConnections();
        
        return {
            nodes: this.nodes,
            connections: this.connections,
            patterns: this.patterns,
            errors: this.errors
        };
    }

    reset() {
        this.nodes.clear();
        this.connections = [];
        this.patterns.clear();
        this.errors = [];
    }

    /**
     * Preprocess lines to handle multi-line parameter blocks
     * @param {string} code - Raw source code
     * @returns {string[]} Array of processed lines
     */
    preprocessLines(code) {
        const rawLines = code.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));
        const processedLines = [];
        let currentLine = '';
        let braceDepth = 0;

        for (const line of rawLines) {
            // Count braces in this line
            let lineOpenBraces = 0;
            let lineCloseBraces = 0;
            for (const char of line) {
                if (char === '{') lineOpenBraces++;
                if (char === '}') lineCloseBraces++;
            }

            // Update brace depth
            braceDepth += lineOpenBraces - lineCloseBraces;

            if (currentLine) {
                // We're continuing a multi-line statement
                currentLine += ' ' + line;
            } else {
                // Start of a new statement
                currentLine = line;
            }

            // If braces are balanced (depth = 0), we have a complete statement
            if (braceDepth === 0) {
                processedLines.push(currentLine);
                currentLine = '';
            } else if (braceDepth < 0) {
                // More closing braces than opening - syntax error
                this.errors.push(`Unmatched closing brace in line: ${line}`);
                braceDepth = 0; // Reset to continue parsing
                processedLines.push(currentLine);
                currentLine = '';
            }
        }

        // Handle case where file ends with unclosed parameter block
        if (currentLine) {
            processedLines.push(currentLine);
            if (braceDepth > 0) {
                this.errors.push('Unclosed parameter block at end of file');
            }
        }

        return processedLines;
    }

    /**
     * Parse node definitions (named lines with or without routing)
     * Examples: 
     * - delay = delay{time=0.33}
     * - lead = sine{decay=0.1} -> gain{value=0.5}
     */
    parseNodeDefinitions(lines) {
        for (const line of lines) {
            if (!line.startsWith('@') && this.isAssignmentLine(line)) {
                const equalIndex = this.findAssignmentOperator(line);
                const name = line.substring(0, equalIndex).trim();
                const definition = line.substring(equalIndex + 1).trim();

                if (!this.isValidNodeName(name)) {
                    this.errors.push(`Invalid node name: ${name}`);
                    continue;
                }

                if (definition.includes('->')) {
                    // Named line with routing: lead = sine{decay=0.1} -> gain{value=0.5}
                    this.parseNamedChain(name, definition);
                } else {
                    // Simple named node: delay = delay{time=0.33}
                    this.parseNamedNode(name, definition);
                }
            }
        }
    }

    /**
     * Check if a line is an assignment line (has = outside of parameter blocks)
     */
    isAssignmentLine(line) {
        let braceDepth = 0;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '{') braceDepth++;
            if (char === '}') braceDepth--;
            if (char === '=' && braceDepth === 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find the assignment operator (=) that's outside of parameter blocks
     */
    findAssignmentOperator(line) {
        let braceDepth = 0;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '{') braceDepth++;
            if (char === '}') braceDepth--;
            if (char === '=' && braceDepth === 0) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Parse routing lines (route-only lines without assignment)
     * Examples:
     * - delayedArp -> STEREO
     * - delayedArp -> gain{value=0.2} -> STEREO
     */
    parseRoutingLines(lines) {
        for (const line of lines) {
            if (line.includes('->') && !this.isAssignmentLine(line) && !line.startsWith('@')) {
                this.parseRouting(line);
            }
        }
    }

    /**
     * Parse pattern definitions
     * Examples: @lead [70] 1
     */
    parsePatterns(lines) {
        for (const line of lines) {
            if (line.startsWith('@')) {
                this.parsePattern(line);
            }
        }
    }

    /**
     * Parse a named node definition
     * Example: delay = delay{time=0.33}
     */
    parseNamedNode(name, definition) {
        const node = this.parseNodeExpression(definition);
        if (node) {
            node.name = name;
            this.nodes.set(name, node);
        } else {
            this.errors.push(`Failed to parse node definition: ${definition}`);
        }
    }

    /**
     * Parse a named chain definition
     * Example: lead = sine{decay=0.1} -> gain{value=0.5}
     */
    parseNamedChain(name, definition) {
        const parts = definition.split('->').map(part => part.trim());
        
        if (parts.length === 0) {
            this.errors.push(`Empty chain definition for: ${name}`);
            return;
        }

        // Create all nodes first, then assign the name to the first one (source instrument)
        const nodeNames = [];
        
        // Process each part in the chain
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const node = this.parseNodeExpression(part);
            
            if (node) {
                // Assign the chain name to the first node (source), others get anonymous names
                const nodeName = (i === 0) ? name : this.generateAnonymousName();
                node.name = nodeName;
                this.nodes.set(nodeName, node);
                nodeNames.push(nodeName);
            } else if (part === 'STEREO') {
                // STEREO is not a node, just a connection target
                nodeNames.push('STEREO');
            } else {
                // Reference to existing node
                nodeNames.push(part);
            }
        }

        // Create connections between consecutive nodes
        for (let i = 0; i < nodeNames.length - 1; i++) {
            this.connections.push({
                from: nodeNames[i],
                to: nodeNames[i + 1]
            });
        }
    }

    /**
     * Parse a routing line (no assignment)
     * Example: delayedArp -> gain{value=0.2} -> STEREO
     */
    parseRouting(line) {
        const parts = line.split('->').map(part => part.trim());
        
        if (parts.length < 2) {
            this.errors.push(`Invalid routing line: ${line}`);
            return;
        }

        let currentNodeName = parts[0];
        
        for (let i = 1; i < parts.length; i++) {
            const targetExpression = parts[i];
            const targetNode = this.parseNodeExpression(targetExpression);
            
            if (targetNode) {
                // Create anonymous node for inline definitions
                const targetName = this.generateAnonymousName();
                targetNode.name = targetName;
                this.nodes.set(targetName, targetNode);
                
                // Create connection
                this.connections.push({
                    from: currentNodeName,
                    to: targetName
                });
                
                currentNodeName = targetName;
            } else if (targetExpression === 'STEREO') {
                // Connection to output
                this.connections.push({
                    from: currentNodeName,
                    to: 'STEREO'
                });
            } else {
                // Reference to existing node
                this.connections.push({
                    from: currentNodeName,
                    to: targetExpression
                });
                currentNodeName = targetExpression;
            }
        }
    }

    /**
     * Parse a node expression (type with parameter block)
     * Examples:
     * - delay{time=0.33}
     * - sine{decay=0.1, sustain=0}
     * - gain{value=0.5}
     * - delay (reference to existing node)
     */
    parseNodeExpression(expression) {
        expression = expression.trim();
        
        // Check if it's a reference to an existing node (no parameter block)
        if (!expression.includes('{')) {
            // This is a reference, not a node definition
            return null;
        }

        const braceIndex = expression.indexOf('{');
        const nodeType = expression.substring(0, braceIndex).trim();
        const parameterBlock = expression.substring(braceIndex);

        const parameters = this.parseParameterBlock(parameterBlock);
        if (parameters === null) {
            this.errors.push(`Failed to parse parameter block: ${parameterBlock}`);
            return null;
        }

        return {
            type: nodeType,
            parameters: parameters,
            name: null // Will be set by caller if needed
        };
    }

    /**
     * Parse a parameter block with curly braces
     * Examples:
     * - {time=0.33}
     * - {decay=0.1, sustain=0}
     * - {roomSize=12 tail=3.0}
     * - {} (empty parameters)
     */
    parseParameterBlock(block) {
        block = block.trim();
        
        if (!block.startsWith('{') || !block.endsWith('}')) {
            return null;
        }

        const content = block.slice(1, -1).trim();
        
        if (!content) {
            return {}; // Empty parameter block
        }

        const parameters = {};
        
        // Split by comma or whitespace, but be careful with nested structures
        const parts = this.splitParameters(content);
        
        for (const part of parts) {
            const trimmedPart = part.trim();
            if (!trimmedPart) continue;
            
            const equalIndex = trimmedPart.indexOf('=');
            if (equalIndex === -1) {
                this.errors.push(`Invalid parameter syntax: ${trimmedPart}`);
                continue;
            }
            
            const key = trimmedPart.substring(0, equalIndex).trim();
            const valueStr = trimmedPart.substring(equalIndex + 1).trim();
            
            // Parse the value (number, string, or boolean)
            const value = this.parseParameterValue(valueStr);
            parameters[key] = value;
        }

        return parameters;
    }

    /**
     * Split parameter string by comma or whitespace, respecting nested structures
     */
    splitParameters(content) {
        const parts = [];
        let current = '';
        let depth = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if (char === '{') depth++;
            if (char === '}') depth--;
            
            if (depth === 0 && (char === ',' || char === '\n')) {
                if (current.trim()) {
                    parts.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            parts.push(current.trim());
        }
        
        return parts;
    }

    /**
     * Parse a parameter value (number, string, or boolean)
     */
    parseParameterValue(valueStr) {
        // Try to parse as number
        const num = parseFloat(valueStr);
        if (isFinite(num)) {
            return num;
        }
        
        // Try to parse as boolean
        if (valueStr === 'true') return true;
        if (valueStr === 'false') return false;
        
        // Return as string (remove quotes if present)
        if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
            (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
            return valueStr.slice(1, -1);
        }
        
        return valueStr;
    }

    /**
     * Parse duration value, supporting fractions like 1/2, 1/4, etc.
     */
    parseDuration(durationStr) {
        durationStr = durationStr.trim();
        
        // Check if it's a fraction
        if (durationStr.includes('/')) {
            const parts = durationStr.split('/');
            if (parts.length === 2) {
                const numerator = parseFloat(parts[0]);
                const denominator = parseFloat(parts[1]);
                if (isFinite(numerator) && isFinite(denominator) && denominator !== 0) {
                    return numerator / denominator;
                }
            }
            return null; // Invalid fraction
        }
        
        // Try to parse as regular number
        const num = parseFloat(durationStr);
        return isFinite(num) ? num : null;
    }

    /**
     * Parse a pattern definition
     * Example: @lead [70] 1
     */
    parsePattern(line) {
        const match = line.match(/^@(\w+)\s+\[([^\]]+)\]\s+(.+)$/);
        if (!match) {
            this.errors.push(`Invalid pattern syntax: ${line}`);
            return;
        }

        const [, instrumentName, notesStr, durationStr] = match;
        const notes = notesStr.split(/\s+/).map(note => {
            if (note === '_') return null;
            const num = parseFloat(note);
            return isFinite(num) ? num : note;
        });

        const duration = this.parseDuration(durationStr);
        if (duration === null || duration <= 0) {
            this.errors.push(`Invalid pattern duration: ${durationStr}`);
            return;
        }

        this.patterns.set(instrumentName, {
            name: instrumentName,
            notes: notes,
            duration: duration
        });
    }

    /**
     * Check if a node name is valid
     */
    isValidNodeName(name) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    /**
     * Add default STEREO connections for instruments without explicit routing
     * Per README: instruments should connect to STEREO by default unless explicitly routed
     */
    addDefaultStereoConnections() {
        // Find all instrument nodes (not effects)
        const instrumentTypes = ['sine', 'square', 'sawtooth', 'triangle', 'sample'];
        const instrumentNodes = new Set();
        
        for (const [name, node] of this.nodes) {
            if (instrumentTypes.includes(node.type)) {
                instrumentNodes.add(name);
            }
        }
        
        // Find which instruments already have explicit routing (are sources in connections)
        const routedInstruments = new Set();
        for (const connection of this.connections) {
            if (instrumentNodes.has(connection.from)) {
                routedInstruments.add(connection.from);
            }
        }
        
        // Add default STEREO connections for instruments without explicit routing
        for (const instrumentName of instrumentNodes) {
            if (!routedInstruments.has(instrumentName)) {
                this.connections.push({
                    from: instrumentName,
                    to: 'STEREO'
                });
            }
        }
    }

    /**
     * Generate a unique anonymous node name
     */
    generateAnonymousName() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        return `_anon_${timestamp}_${random}`;
    }

    /**
     * Get all errors that occurred during parsing
     */
    getErrors() {
        return [...this.errors];
    }

    /**
     * Get the parsed audio graph
     */
    getGraph() {
        return {
            nodes: this.nodes,
            connections: this.connections,
            patterns: this.patterns
        };
    }

    /**
     * Print the parsed graph for debugging
     */
    printGraph() {
        console.log('=== PARSED AUDIO GRAPH ===');
        
        console.log('\nNodes:');
        for (const [name, node] of this.nodes) {
            console.log(`  ${name}: ${node.type}`, node.parameters);
        }
        
        console.log('\nConnections:');
        for (const conn of this.connections) {
            console.log(`  ${conn.from} -> ${conn.to}`);
        }
        
        console.log('\nPatterns:');
        for (const [name, pattern] of this.patterns) {
            console.log(`  @${name} [${pattern.notes.join(' ')}] ${pattern.duration}`);
        }
        
        if (this.errors.length > 0) {
            console.log('\nErrors:');
            for (const error of this.errors) {
                console.log(`  ERROR: ${error}`);
            }
        }
    }
}

// Node definition structure
class NodeDefinition {
    constructor(type, parameters = {}, name = null) {
        this.type = type;           // 'delay', 'sine', 'gain', etc.
        this.parameters = parameters; // {time: 0.33, feedback: 0.5}
        this.name = name;           // 'fd', 'lead', etc. (null for anonymous)
    }
}

// Connection structure
class Connection {
    constructor(from, to) {
        this.from = from;  // Source node name
        this.to = to;      // Target node name (or 'STEREO')
    }
}

// Pattern definition structure
class PatternDefinition {
    constructor(name, notes, duration) {
        this.name = name;
        this.notes = notes;
        this.duration = duration;
    }
}
