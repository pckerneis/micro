/* CodeMirror 5 simple mode for Micro DSL */
(function() {
  if (typeof CodeMirror === 'undefined') return;

  // Ensure defineSimpleMode exists (addon required)
  if (!CodeMirror.defineSimpleMode) {
    console.warn('CodeMirror simple mode addon not loaded. Include addon/mode/simple.min.js');
    return;
  }

  CodeMirror.defineSimpleMode('micro', {
    // Default state
    start: [
      { regex: /#.*/, token: 'comment' },
      { regex: /"(?:[^\\]|\\.)*?"|'(?:[^\\]|\\.)*?'/, token: 'string' },
      { regex: /\b(?:true|false)\b/, token: 'atom' },
      { regex: /\bOUT\b/, token: 'atom' },
      // Operators and markers
      { regex: /\+\+|->|=/, token: 'keyword' },
      { regex: /@(?=[A-Za-z_]\w*)/, token: 'keyword' },
      { regex: /\{/, token: 'bracket', push: 'params' },
      { regex: /\[/, token: 'bracket', push: 'seq' },
      { regex: /\(/, token: 'bracket', push: 'chord' },
      { regex: /[\]\)\}],?/, token: 'bracket' },
      // Numbers, fractions, units
      { regex: /[+\-]?\d+(?:\.\d+)?\s*dB\b/i, token: 'number' },
      { regex: /(?:\d+\/\d+)/, token: 'number' },
      { regex: /\b\d+(?:\.\d+)?(?:Hz)?\b/, token: 'number' },
      // Special tokens
      { regex: /[_-]/, token: 'atom' },
      // Identifiers
      { regex: /\b[a-zA-Z_]\w*\b/, token: 'variable' }
    ],

    // Inside parameters {...}
    params: [
      { regex: /\}/, token: 'bracket', pop: true },
      { regex: /#.*/, token: 'comment' },
      { regex: /,/, token: 'bracket' },
      { regex: /=/, token: 'keyword' },
      { regex: /"(?:[^\\]|\\.)*?"|'(?:[^\\]|\\.)*?'/, token: 'string' },
      { regex: /\b(?:true|false)\b/, token: 'atom' },
      { regex: /[+\-]?\d+(?:\.\d+)?\s*dB\b/i, token: 'number' },
      { regex: /\b\d+(?:\.\d+)?\b/, token: 'number' },
      { regex: /\b[a-zA-Z_]\w*\b/, token: 'property' }
    ],

    // Inside sequence [...]
    seq: [
      { regex: /\]/, token: 'bracket', pop: true },
      { regex: /#.*/, token: 'comment' },
      { regex: /\+\+|->|=/, token: 'keyword' },
      { regex: /\(/, token: 'bracket', push: 'chord' },
      { regex: /\)/, token: 'bracket' },
      { regex: /[+\-]?\d+(?:\.\d+)?\s*dB\b/i, token: 'number' },
      { regex: /(?:\d+\/\d+)/, token: 'number' },
      { regex: /\b\d+(?:\.\d+)?(?:Hz)?\b/, token: 'number' },
      { regex: /:(?:\s*)\d+(?:\/\d+|\.\d+)?\b/, token: 'number' },
      { regex: /@(?!\s*$)(?:\s*)\d+(?:\.\d+)?|@(?!\s*$)(?:\s*)\d{1,3}\b/, token: 'number' },
      { regex: /\?(?:\s*)\d+(?:\.\d+)?\b/, token: 'number' },
      { regex: /\*(?:\s*)\d+\b/, token: 'number' },
      { regex: /[_-]/, token: 'atom' },
      { regex: /\b[a-zA-Z_]\w*\b/, token: 'variable' }
    ],

    // Inside chord (...)
    chord: [
      { regex: /\)/, token: 'bracket', pop: true },
      { regex: /[+\-]?\d+(?:\.\d+)?\s*dB\b/i, token: 'number' },
      { regex: /(?:\d+\/\d+)/, token: 'number' },
      { regex: /\b\d+(?:\.\d+)?(?:Hz)?\b/, token: 'number' },
      { regex: /:(?:\s*)\d+(?:\/\d+|\.\d+)?\b/, token: 'number' },
      { regex: /@(?!\s*$)(?:\s*)\d+(?:\.\d+)?|@(?!\s*$)(?:\s*)\d{1,3}\b/, token: 'number' },
      { regex: /\?(?:\s*)\d+(?:\.\d+)?\b/, token: 'number' },
      { regex: /\*(?:\s*)\d+\b/, token: 'number' },
      { regex: /[_-]/, token: 'atom' },
      { regex: /\b[a-zA-Z_]\w*\b/, token: 'variable' }
    ],

    meta: {
      lineComment: '#'
    }
  });
})();
