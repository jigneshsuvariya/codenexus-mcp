import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Import the compiled CodeSplitter class
import { CodeSplitter } from '../dist/utils/codeSplitter.js';

// Helper function to normalize whitespace for comparisons
const normalize = (str) => str.replace(/\\s+/g, ' ').trim();

describe('CodeSplitter (Logical Chunking)', () => {
    let splitter;

    // Initialize before tests
    // Note: node:test doesn't have `beforeAll` like jest/mocha, setup happens per describe or file scope.
    try {
        splitter = new CodeSplitter('typescript');
    } catch (e) {
        console.error("Failed to initialize CodeSplitter:", e);
        // If splitter fails to init, tests will fail anyway, but log the error.
    }

    it('should initialize correctly for typescript', () => {
        assert.ok(splitter instanceof CodeSplitter, 'Splitter should be an instance of CodeSplitter');
        // Maybe add a check if parser/language is set if possible/exposed
    });

    it('should split a simple function', () => {
        const code = `
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}`;
        const chunks = splitter.splitText(code);
        assert.strictEqual(chunks.length, 1, 'Should find 1 chunk (function)');
        assert.strictEqual(chunks[0].type, 'function_declaration', 'Chunk type should be function_declaration');
        assert.strictEqual(chunks[0].name, 'greet', 'Function name should be extracted');
        // Check content - use includes or normalize for robustness
        assert.ok(chunks[0].content.includes('return `Hello, ${name}!`;'), 'Function content mismatch');
        assert.strictEqual(chunks[0].startLine, 2, 'Start line mismatch');
        assert.strictEqual(chunks[0].endLine, 4, 'End line mismatch');
    });

    it('should split a simple class (but not its method separately)', () => {
        const code = `
class Greeter {
    message: string;
    constructor(message: string) {
        // Constructor is part of class declaration usually, not separate chunk type
        this.message = message;
    }
    greet() {
        return "Hello, " + this.message;
    }
}`;
        // Current implementation only extracts the class as one chunk
        // It does not extract methods separately unless LOGICAL_CHUNK_TYPES is modified
        // and findLogicalChunks logic is changed to recurse after finding a class.
        const chunks = splitter.splitText(code);
        console.log("Chunks found for simple class:", JSON.stringify(chunks, null, 2)); // Debug log
        assert.strictEqual(chunks.length, 1, 'Should find 1 chunk (class declaration only)');
        assert.strictEqual(chunks[0].type, 'class_declaration', 'Chunk type should be class_declaration');
        assert.strictEqual(chunks[0].name, 'Greeter', 'Class name should be extracted');
        assert.ok(chunks[0].content.includes('greet() {'), 'Class content should include method definition');
        assert.strictEqual(chunks[0].startLine, 2, 'Start line mismatch');
        assert.strictEqual(chunks[0].endLine, 11, 'End line mismatch');
    });

    it('should split multiple top-level functions and classes', () => {
        const code = `
function firstFunc() {
    return 1;
}

class MyClass {
    doSomething() {
        console.log('doing...');
    }
}

function secondFunc() {
    return 2;
}`;
        // Expecting 3 chunks: firstFunc, MyClass, secondFunc
        const chunks = splitter.splitText(code);
         console.log("Chunks found for multiple top-level:", JSON.stringify(chunks, null, 2)); // Debug log
        assert.strictEqual(chunks.length, 3, 'Should find 3 chunks (2 functions, 1 class)');

        assert.strictEqual(chunks[0].type, 'function_declaration');
        assert.strictEqual(chunks[0].name, 'firstFunc');
        assert.strictEqual(chunks[1].type, 'class_declaration');
        assert.strictEqual(chunks[1].name, 'MyClass');
        assert.strictEqual(chunks[2].type, 'function_declaration');
        assert.strictEqual(chunks[2].name, 'secondFunc');
    });

    it('should handle code with only non-chunk types', () => {
        const code = `
let x = 10;
const y = "hello";
console.log(x + y);`;
        const chunks = splitter.splitText(code);
        assert.strictEqual(chunks.length, 0, 'Should find 0 chunks for non-declaration code');
    });

    it('should handle empty input', () => {
        const code = ``;
        const chunks = splitter.splitText(code);
        assert.strictEqual(chunks.length, 0, 'Should find 0 chunks for empty input');
    });

    it('should handle input with only whitespace/comments', () => {
        const code = `
// This is a comment
/* Multi-line
   comment */

`;
        const chunks = splitter.splitText(code);
        assert.strictEqual(chunks.length, 0, 'Should find 0 chunks for whitespace/comments only');
    });

    it('should throw error for invalid syntax', () => {
        const code = `function invalid { console.log("bad"); }`;
        assert.throws(
            () => splitter.splitText(code),
            /Could not parse code cleanly. Tree contains error nodes./, // Check for specific error message
            'Should throw error for syntax issues'
        );
    });

    it('should throw error for unsupported language during construction', () => {
         assert.throws(
            () => new CodeSplitter('javascript'), // Assuming javascript grammar isn't loaded
            /Language 'javascript' grammar not currently loaded/,
            'Should throw error for unsupported language'
        );
    });

    it('should split interface and enum declarations', () => {
        const code = `
interface User {
    id: number;
    name: string;
}

enum Color {
    Red, Green, Blue
}`;
        const chunks = splitter.splitText(code);
        assert.strictEqual(chunks.length, 2, 'Should find 2 chunks (interface, enum)');

        assert.strictEqual(chunks[0].type, 'interface_declaration');
        assert.strictEqual(chunks[0].name, 'User');
        assert.ok(chunks[0].content.includes('id: number;'), 'Interface content mismatch');

        assert.strictEqual(chunks[1].type, 'enum_declaration');
        assert.strictEqual(chunks[1].name, 'Color');
        assert.ok(chunks[1].content.includes('Red, Green, Blue'), 'Enum content mismatch');
    });

    it('should handle nested structures correctly (only extract top-level)', () => {
        // Based on current implementation, nested functions/classes are NOT extracted separately.
        const code = `
function outer() {
    console.log('outer');
    function inner() { // Inner function
        console.log('inner');
    }
    inner();
}`;
        const chunks = splitter.splitText(code);
        console.log("Chunks found for nested function:", JSON.stringify(chunks, null, 2)); // Debug log
        assert.strictEqual(chunks.length, 1, 'Should find 1 chunk (outer function only)');
        assert.strictEqual(chunks[0].type, 'function_declaration');
        assert.strictEqual(chunks[0].name, 'outer');
        assert.ok(chunks[0].content.includes('function inner()'), 'Outer function content should contain inner function');
    });

    // Example: Test for arrow functions if added to LOGICAL_CHUNK_TYPES
    // Assuming 'lexical_declaration' is added for this
    it('should handle arrow functions assigned to variables if LOGICAL_CHUNK_TYPES includes lexical_declaration', () => {
         const tempSplitter = new CodeSplitter('typescript');
         // Hypothetical modification for the test - doesn't change the actual class
         // const originalTypes = new Set(LOGICAL_CHUNK_TYPES);
         // LOGICAL_CHUNK_TYPES.add('lexical_declaration');

        const code = `
const myArrowFunc = (a: number): number => {
    return a * 2;
};`;
        // Depending on if 'lexical_declaration' is added and how names are found,
        // this might or might not work. Current implementation likely finds 0 chunks.
        const chunks = tempSplitter.splitText(code);

        // Reset types if modified
        // LOGICAL_CHUNK_TYPES = originalTypes;

        // Assert based on whether lexical_declaration IS or IS NOT handled
         assert.strictEqual(chunks.length, 0, 'Should find 0 chunks unless lexical_declaration is added and handled');
         // If it were handled:
         // assert.strictEqual(chunks.length, 1, 'Should find 1 chunk (arrow func declaration)');
         // assert.strictEqual(chunks[0].type, 'lexical_declaration');
         // assert.strictEqual(chunks[0].name, 'myArrowFunc'); // Name finding might need adjustment for this case
    });
}); 