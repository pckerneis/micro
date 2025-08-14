/**
 * New Graph-based Parser for Micro Livecoding Environment
 * Parses the enhanced curly-brace syntax and outputs an audio graph
 * Decoupled from the audio engine for better separation of concerns
 */
import {OUTPUT_KEYWORD} from './constants.mjs';

export class GraphParser {
    constructor() {
        this.nodes = new Map();           // name -> NodeDefinition
        this.connections = [];            // array of Connection objects
        this.patterns = new Map();        // name -> PatternDefinition
        this.patternVars = new Map();     // name -> { notes: any[], duration: number }
        this.namedRoutes = new Map();     // name -> RouteDefinition
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
        
        return {
            nodes: this.nodes,
            connections: this.connections,
            patterns: this.patterns,
            patternVars: this.patternVars,
            namedRoutes: this.namedRoutes,
            errors: this.errors
        };
    }

    reset() {
        this.nodes.clear();
        this.connections = [];
        this.patterns.clear();
        this.patternVars.clear();
        this.namedRoutes.clear();
        this.errors = [];
    }

    /**
     * Preprocess lines to handle multi-line parameter blocks
     * @param {string} code - Raw source code
     * @returns {string[]} Array of processed lines
     */
    preprocessLines(code) {
        const rawLines = code.split('\n')
            .map(line => {
                // Remove inline comments (everything after #)
                const commentIndex = line.indexOf('#');
                if (commentIndex !== -1) {
                    line = line.substring(0, commentIndex);
                }
                return line.trim();
            })
            .filter(line => line); // Remove empty lines
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
                // Skip pattern variable definitions of form: name = [tokens] duration
                if (this.isPatternVarDefinition(line)) {
                    continue;
                }
                const equalIndex = this.findAssignmentOperator(line);
                const name = line.substring(0, equalIndex).trim();
                const definition = line.substring(equalIndex + 1).trim();

                if (!this.isValidRouteName(name)) {
                    this.errors.push(`Invalid node name: ${name}`);
                    continue;
                }

                this.parseNamedChain(name, definition);
            }
        }
    }

    /**
     * Detects pattern variable definition lines like:
     *   name = [tokens] duration
     * (no leading @). Back-compat with optional @ is handled elsewhere.
     */
    isPatternVarDefinition(line) {
        // Heuristic: assignment whose RHS looks like a pattern chain (contains '[' or '++')
        // and does not contain '{' (node params) or '->' (routing)
        const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
        if (!m) return false;
        const rhs = m[2];
        if (rhs.includes('{') || rhs.includes('->')) return false;
        return rhs.includes('[') || rhs.includes('++');
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
     * - delayedArp -> OUT
     * - delayedArp -> gain{value=0.2} -> OUT
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
        // Pass 1: collect variable definitions, supporting chained segments with '++'
        for (const line of lines) {
            const def = line.match(/^@?(\w+)\s*=\s*(.+)$/);
            if (!def) continue;
            const [, varName, rhs] = def;
            if (!this.isPatternVarDefinition(line)) continue;
            const chained = this.parseChainedSegments(rhs.trim());
            if (!chained) {
                this.errors.push(`Invalid pattern definition for ${varName}: ${rhs}`);
                continue;
            }
            const { events, wrapCarryBeats } = chained;
            this.patternVars.set(varName, { 
                // Keep legacy fields minimally for compatibility
                notes: [], duration: 1,
                events, wrapCarryBeats
            });
        }

        // Pass 2: parse usages and inline definitions (with chaining)
        for (const line of lines) {
            if (!line.startsWith('@')) continue;
            // Skip lines that are variable definitions (handled above)
            if (/^@?\w+\s*=/.test(line)) continue;
            this.parsePattern(line);
        }
    }

    /**
     * Parse a named route definition
     * Example: route1 = lowpass{frequency=200} -> reverb{size=3.0, length=10}
     */
    parseNamedChain(name, definition) {
        const parts = definition.split('->').map(part => part.trim());
        
        if (parts.length === 0) {
            this.errors.push(`Empty route definition for: ${name}`);
            return;
        }

        const nodeNames = [];
        
        // Process each part in the chain
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const node = this.parseNodeExpression(part);
            
            if (node) {
                const nodeName = this.generateNodeName(node);
                node.name = nodeName;
                this.nodes.set(nodeName, node);
                nodeNames.push(nodeName);
            } else if (part === OUTPUT_KEYWORD) {
                // OUT is not a node, just a connection target
                nodeNames.push(OUTPUT_KEYWORD);
            } else {
                // Reference to existing node or route
                nodeNames.push(part);
            }
        }

        // Create connections between nodes, resolving route references and param targets
        for (let i = 0; i < nodeNames.length - 1; i++) {
            const rawFrom = nodeNames[i];
            const rawTo = nodeNames[i + 1];
            
            const resolvedFrom = this.resolveNodeOrRoute(rawFrom, 'source');
            const refTo = this.parseReferenceExpression(rawTo);
            if (refTo) {
                const resolvedTo = this.resolveNodeOrRouteWithIndex(refTo.name, refTo.index, 'target');
                if (refTo.param) {
                    this.connections.push({ from: resolvedFrom, to: resolvedTo, toParam: refTo.param });
                } else {
                    this.connections.push({ from: resolvedFrom, to: resolvedTo });
                }
            } else {
                const resolvedTo = this.resolveNodeOrRoute(rawTo, 'target');
                this.connections.push({ from: resolvedFrom, to: resolvedTo });
            }
        }

        // Create named route definition
        if (nodeNames.length > 0) {
            const firstNode = nodeNames[0];
            // For the last node, if it's a route reference, use the resolved node
            const lastNodeName = nodeNames[nodeNames.length - 1];
            const lastNode = this.resolveNodeOrRoute(lastNodeName, 'source');
            
            this.namedRoutes.set(name, new RouteDefinition(name, firstNode, lastNode, nodeNames));
        }
    }

    /**
     * Parse a routing line (no assignment)
     * Example: delayedArp -> gain{value=0.2} -> OUT
     */
    parseRouting(line) {
        const parts = line.split('->').map(part => part.trim());
        
        if (parts.length < 2) {
            this.errors.push(`Invalid routing line: ${line}`);
            return;
        }

        // Support indexing on the source (e.g., route[1]) but not source params
        const sourceRef = this.parseReferenceExpression(parts[0]);
        if (sourceRef && sourceRef.param) {
            this.errors.push(`Connecting FROM a parameter is not supported: ${parts[0]}`);
        }
        let currentNodeName = sourceRef
            ? this.resolveNodeOrRouteWithIndex(sourceRef.name, sourceRef.index, 'source')
            : this.resolveNodeOrRoute(parts[0], 'source');
        
        for (let i = 1; i < parts.length; i++) {
            const targetExpression = parts[i];
            const targetNode = this.parseNodeExpression(targetExpression);
            
            if (targetNode) {
                const targetName = this.generateNodeName(targetNode);
                targetNode.name = targetName;
                this.nodes.set(targetName, targetNode);
                
                // Create connection
                this.connections.push({
                    from: currentNodeName,
                    to: targetName
                });
                
                currentNodeName = targetName;
            } else if (targetExpression === OUTPUT_KEYWORD) {
                // Connection to output
                this.connections.push({
                    from: currentNodeName,
                    to: OUTPUT_KEYWORD
                });
            } else {
                // Reference to existing node/route, possibly with [index] and .param
                const ref = this.parseReferenceExpression(targetExpression);
                if (ref) {
                    const resolvedTarget = this.resolveNodeOrRouteWithIndex(ref.name, ref.index, 'target');
                    if (ref.param) {
                        this.connections.push({
                            from: currentNodeName,
                            to: resolvedTarget,
                            toParam: ref.param
                        });
                        // When targeting an AudioParam, we do not advance currentNodeName to the param
                        // Keep currentNodeName so chains like a -> b.param -> c are still valid (a -> b, then b -> c)
                    } else {
                        this.connections.push({
                            from: currentNodeName,
                            to: resolvedTarget
                        });
                        currentNodeName = resolvedTarget;
                    }
                } else {
                    // Fallback: resolve as simple node/route name
                    const resolvedTarget = this.resolveNodeOrRoute(targetExpression, 'target');
                    this.connections.push({
                        from: currentNodeName,
                        to: resolvedTarget
                    });
                    currentNodeName = resolvedTarget;
                }
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
            parameters[key] = this.parseParameterValue(valueStr);
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
        // Support decibel values like -6dB or 3.5 dB
        const dbMatch = valueStr.match(/^\s*(-?\d+(?:\.\d+)?)\s*dB\s*$/i);
        if (dbMatch) {
            const db = parseFloat(dbMatch[1]);
            return { unit: 'dB', value: db };
        }

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
        // 1) Inline form (with chaining): @target <segment> ( ++ <segment> )*
        let m = line.match(/^@(\w+)\s+(.+)$/);
        if (m) {
            const [, targetName, tail] = m;
            const trimmed = tail.trim();
            // Try chained segments first (supports var refs and bracket segments)
            const chained = this.parseChainedSegments(trimmed);
            if (chained) {
                const { events, wrapCarryBeats } = chained;
                this.addPattern(targetName, [], 1, events, wrapCarryBeats);
                return;
            }
            // Else fall through to variable usage
        }

        // 2) Variable usage: @target varName
        m = line.match(/^@(\w+)\s+(\w+)$/);
        if (m) {
            const [, targetName, varName] = m;
            if (!this.patternVars.has(varName)) {
                this.errors.push(`Unknown pattern variable: ${varName}`);
                return;
            }
            const def = this.patternVars.get(varName);
            if (def.events) {
                this.addPattern(targetName, [], 1, def.events, def.wrapCarryBeats || 0);
            } else {
                this.addPattern(targetName, def.notes, def.duration);
            }
            return;
        }

        // 3) If none matched, it's invalid
        this.errors.push(`Invalid pattern syntax: ${line}`);
    }

    /**
     * Common notes string parser used by inline and variable definitions
     */
    parseNotesString(notesStr) {
        const out = [];
        let buf = '';
        let inParen = false;
        let chordBuf = '';

        const flushToken = (t) => {
            const tok = t.trim();
            if (!tok) return;
            out.push(this.parseSingleNoteToken(tok));
        };

        for (let i = 0; i < notesStr.length; i++) {
            const ch = notesStr[i];
            if (inParen) {
                if (ch === ')') {
                    inParen = false;
                    // Build chord array from chordBuf
                    const content = chordBuf.trim();
                    chordBuf = '';
                    let chord;
                    if (!content) {
                        chord = [];
                    } else {
                        const parts = content.split(/\s+/).filter(Boolean);
                        chord = parts.map(p => this.parseSingleNoteToken(p));
                    }
                    // Parse optional trailing modifiers like @0.8?0.5 (allow whitespace)
                    let j = i + 1;
                    const rest = notesStr.slice(j);
                    const m = rest.match(/^\s*(?:@(\d+(?:\.\d+)?))?\s*(?:\?(\d+(?:\.\d+)?))?/);
                    if (m && (m[1] != null || m[2] != null)) {
                        const vel = m[1] != null ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 1.0;
                        const prob = m[2] != null ? Math.max(0, Math.min(1, parseFloat(m[2]))) : 1.0;
                        out.push({ chord, vel, prob });
                        i = j + m[0].length - 1; // advance past modifiers
                    } else {
                        out.push(chord);
                    }
                } else {
                    chordBuf += ch;
                }
            } else {
                if (ch === '(') {
                    if (buf.trim()) { flushToken(buf); buf = ''; }
                    inParen = true;
                } else if (/\s/.test(ch)) {
                    if (buf.trim()) { flushToken(buf); buf = ''; }
                } else {
                    buf += ch;
                }
            }
        }
        if (buf.trim()) flushToken(buf);
        // Ignore unclosed parenthesis silently; treat as text
        return out;
    }

    /**
     * Parse a single note token into internal representation
     */
    parseSingleNoteToken(tok) {
        if (tok === '_') return null;         // rest
        if (tok === '-') return '-';          // continuation (tie)
        // Frequency literal with Hz suffix: keep as string so engine treats as Hz
        if (/^\d+(?:\.\d+)?\s*Hz$/i.test(tok)) return tok;
        const num = Number(tok);
        return Number.isFinite(num) ? num : tok;
    }

    /** Convert notes + uniform step beats to event list and leading wrap-carry beats */
    makeEventsFromNotes(notes, stepBeats) {
        const events = [];
        let leadingCarry = 0;
        let lastSoundingIndex = -1;
        for (const tok of notes) {
            if (tok === '-') {
                if (lastSoundingIndex >= 0) {
                    events[lastSoundingIndex].beats += stepBeats;
                } else {
                    leadingCarry += stepBeats;
                }
            } else if (tok === null || tok === '_') {
                events.push({ token: null, beats: stepBeats });
                // rest does not update lastSoundingIndex
            } else {
                events.push({ token: tok, beats: stepBeats });
                lastSoundingIndex = events.length - 1;
            }
        }
        return { events, wrapCarryBeats: leadingCarry };
    }

    /**
     * Parse chained pattern segments separated by '++'.
     * Each segment has form: [tokens] duration
     * Returns { notes: any[], baseDuration: number } or null on error.
     */
    parseChainedSegments(str) {
        const s = str.trim();
        if (!s) return null;
        const chainEvents = [];
        let chainLeadingCarry = 0;
        let i = 0;
        const appendSegment = (seg) => {
            if (!seg) return false;
            const { events, wrapCarryBeats } = seg;
            if (!Array.isArray(events)) return false;
            if (chainEvents.length === 0) {
                chainLeadingCarry += wrapCarryBeats;
                for (const ev of events) chainEvents.push({ ...ev });
            } else {
                if (wrapCarryBeats > 0) {
                    // Extend last sounding event so far, otherwise accumulate to leading carry
                    let idx = chainEvents.length - 1;
                    while (idx >= 0 && chainEvents[idx].token == null) idx--;
                    if (idx >= 0) chainEvents[idx].beats += wrapCarryBeats; else chainLeadingCarry += wrapCarryBeats;
                }
                for (const ev of events) chainEvents.push({ ...ev });
            }
            return true;
        };
        while (i < s.length) {
            // Skip whitespace
            while (i < s.length && /\s/.test(s[i])) i++;
            if (i >= s.length) break;
            if (s[i] === '[') {
                // Bracket segment
                const start = i + 1; let j = start; let found = false;
                while (j < s.length) { if (s[j] === ']') { found = true; break; } j++; }
                if (!found) return null;
                const notesStr = s.slice(start, j);
                i = j + 1;
                while (i < s.length && /\s/.test(s[i])) i++;
                // Read duration until '++' or end
                let k = i; let nextDelim = -1;
                while (k < s.length) { if (s[k] === '+' && s[k+1] === '+') { nextDelim = k; break; } k++; }
                const durationStr = s.slice(i, nextDelim === -1 ? s.length : nextDelim).trim();
                const stepBeats = this.parseDuration(durationStr);
                if (stepBeats == null || stepBeats <= 0) return null;
                const notes = this.parseNotesString(notesStr);
                const seg = this.makeEventsFromNotes(notes, stepBeats);
                if (!appendSegment(seg)) return null;
                if (nextDelim === -1) { i = s.length; } else { i = nextDelim + 2; }
            } else {
                // Expect a variable name segment
                const m = s.slice(i).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (!m) return null;
                const varName = m[1];
                i += varName.length;
                // Ensure next non-space is either end or '++'
                let k = i; while (k < s.length && /\s/.test(s[k])) k++;
                let nextDelim = -1;
                if (k < s.length) {
                    if (s[k] === '+' && s[k+1] === '+') nextDelim = k;
                    else return null;
                }
                if (!this.patternVars.has(varName)) return null;
                const pv = this.patternVars.get(varName);
                let seg;
                if (pv.events) seg = { events: pv.events, wrapCarryBeats: pv.wrapCarryBeats || 0 };
                else seg = this.makeEventsFromNotes(pv.notes || [], pv.duration || 1);
                if (!appendSegment(seg)) return null;
                if (nextDelim === -1) { i = s.length; } else { i = nextDelim + 2; }
            }
        }
        if (!chainEvents.length) return null;
        return { events: chainEvents, wrapCarryBeats: chainLeadingCarry };
    }

    // Fraction helpers removed; durations are handled per-event in beats

    /**
     * Add a parsed pattern instance for a given target, generating a unique id
     */
    addPattern(targetName, notes, duration, events = null, wrapCarryBeats = 0) {
        // Resolve the target (could be a node or route)
        // For patterns, we always want the first node (source instrument)
        const resolvedTarget = this.resolveNodeOrRoute(targetName, 'target');

        // Store by a unique pattern name to allow multiple patterns per target
        const uniqueName = this.generatePatternName(targetName);
        this.patterns.set(uniqueName, {
            name: uniqueName,              // unique pattern identifier
            targetName: targetName,        // original target as written by user
            resolvedName: resolvedTarget,  // actual node/route first node
            notes: notes,
            duration: duration,
            events: events,
            wrapCarryBeats: wrapCarryBeats
        });
    }

    /**
     * Check if a node name is valid
     */
    isValidRouteName(name) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    /**
     * Resolve a node or route reference to the actual node name
     * @param {string} name - Name to resolve (could be node or route)
     * @param {string} context - 'source' or 'target' to determine which end of route to use
     * @returns {string} Resolved node name
     */
    resolveNodeOrRoute(name, context) {
        // Check if it's a named route
        if (this.namedRoutes.has(name)) {
            const route = this.namedRoutes.get(name);
            // For source context (connecting FROM route), use last node
            // For target context (connecting TO route), use first node
            return context === 'source' ? route.lastNode : route.firstNode;
        }
        
        // Not a route, return as-is (should be a node name)
        return name;
    }

    /**
     * Resolve a reference that may include an index into a route's chain.
     * If index is null, fallback to resolveNodeOrRoute.
     */
    resolveNodeOrRouteWithIndex(name, index, context) {
        if (index == null) {
            return this.resolveNodeOrRoute(name, context);
        }
        if (!this.namedRoutes.has(name)) {
            this.errors.push(`Cannot index into unknown route: ${name}[${index}]`);
            return name;
        }
        const route = this.namedRoutes.get(name);
        // Build an expanded list of node names for the route, resolving nested routes for targets to their first node
        const expanded = [];
        for (const item of route.allNodes) {
            if (item === OUTPUT_KEYWORD) continue;
            const resolved = this.resolveNodeOrRoute(item, 'target');
            expanded.push(resolved);
        }
        if (index < 0 || index >= expanded.length) {
            this.errors.push(`Route index out of range: ${name}[${index}] (length=${expanded.length})`);
            return expanded[expanded.length - 1] ?? name;
        }
        return expanded[index];
    }

    /**
     * Parse a reference expression supporting optional [index] and .param
     * Examples:
     * - fm
     * - fm[0]
     * - fm.frequency
     * - fm[1].frequency
     */
    parseReferenceExpression(expression) {
        const m = expression.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\[(\d+)\])?\s*(?:\.(\w+))?$/);
        if (!m) return null;
        return {
            name: m[1],
            index: m[2] != null ? parseInt(m[2], 10) : null,
            param: m[3] || null
        };
    }

    /**
     * Generate a unique pattern name
     */
    generatePatternName(target) {
        let counter = 0;

        while (this.patterns.has(`${target}-${counter}`)) {
            counter++;
        }

        return `${target}-${counter}`;
    }

    /**
     * Generate a unique node name
     */
    generateNodeName(node) {
        const type = node.type;
        let counter = 0;

        while (this.nodes.has(`${type}-${counter}`)) {
            counter++;
        }

        return `${type}-${counter}`;
    }
}

// Route definition structure
class RouteDefinition {
    constructor(name, firstNode, lastNode, allNodes) {
        this.name = name;           // Route name
        this.firstNode = firstNode; // First node in the route (connection target)
        this.lastNode = lastNode;   // Last node in the route (connection source)
        this.allNodes = allNodes;   // All nodes in the route
    }
}
