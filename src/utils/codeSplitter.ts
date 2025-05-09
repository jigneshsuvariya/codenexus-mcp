import Parser, { SyntaxNode, Tree } from 'tree-sitter';
// Module augmentation removed - assuming types are exported directly
import TSLang from 'tree-sitter-typescript';

// Define the structure for the returned code chunks
export interface CodeChunk {
    content: string;
    type: string; // e.g., 'function_declaration', 'class_declaration'
    name?: string; // Optional name extracted (e.g., function/class name)
    startLine: number; // 1-indexed
    endLine: number; // 1-indexed
}

// Define the node types that represent logical chunks we want to extract
const LOGICAL_CHUNK_TYPES = new Set([
    'class_declaration',
    'function_declaration',
    'interface_declaration',
    'enum_declaration',
    'method_definition', // Constructors are also methods, need special handling
    // Consider adding others like 'lexical_declaration' for top-level const/let, 
    // 'expression_statement' for top-level calls, or arrow functions if needed.
]);

export class CodeSplitter {
    private parser: Parser;
    private languageGrammar: any; // Keeping as any for now for flexibility

    constructor(language: 'typescript' | 'javascript' = 'typescript') {
        this.parser = new Parser();

        if (language === 'typescript') {
            // Access grammar correctly from the imported module
            this.languageGrammar = TSLang.typescript;
        } else {
            // Placeholder - requires installation and import of tree-sitter-javascript
            // import JSLang from 'tree-sitter-javascript';
            // this.languageGrammar = JSLang.javascript;
            throw new Error(`Language '${language}' grammar not currently loaded. Requires 'tree-sitter-javascript'`);
        }

        if (!this.languageGrammar) {
             throw new Error(`Could not load grammar for language '${language}'. Is 'tree-sitter-${language}' installed?`);
        }

        try {
            this.parser.setLanguage(this.languageGrammar);
        } catch (error) {
             console.error(`Failed to set language '${language}':`, error);
             throw new Error(`Failed to set language '${language}'. Ensure the grammar object is valid.`);
        }
    }

    /**
     * Attempts to find the name identifier of a syntax node.
     *
     * @param node The SyntaxNode (e.g., function_declaration, class_declaration).
     * @param text The original source code text.
     * @returns The extracted name string or undefined.
     */
    private findNodeName(node: SyntaxNode, text: string): string | undefined {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
            return text.substring(nameNode.startIndex, nameNode.endIndex);
        }
        // Add other potential name finding logic if needed for different node types
        return undefined;
    }

    /**
     * Recursively traverses the AST to find nodes corresponding to logical code chunks.
     * If a node matches a chunk type (and isn't a constructor method), its data is extracted.
     * Traversal continues into children to find nested chunks.
     *
     * @param node The SyntaxNode to start traversal from.
     * @param text The original source code text.
     * @returns An array of CodeChunk objects.
     */
    private findLogicalChunks(node: SyntaxNode, text: string): CodeChunk[] {
        let chunks: CodeChunk[] = [];
        let processChildren = true; // By default, process children unless this node is added

        let shouldAddChunk = LOGICAL_CHUNK_TYPES.has(node.type);
        let nodeName: string | undefined;

        // Special handling: Don't add constructors as separate chunks
        if (node.type === 'method_definition') {
            nodeName = this.findNodeName(node, text);
            if (nodeName === 'constructor') {
                shouldAddChunk = false;
            }
        }

        if (shouldAddChunk) {
             // Find the name if we haven't already (e.g., for function_declaration)
            if (!nodeName) {
                nodeName = this.findNodeName(node, text);
            }

            // If the node itself is a target logical chunk, add its data.
            const chunkData: CodeChunk = {
                content: text.substring(node.startIndex, node.endIndex).trim(),
                type: node.type,
                name: nodeName,
                startLine: node.startPosition.row + 1, // Convert 0-indexed to 1-indexed
                endLine: node.endPosition.row + 1, // Convert 0-indexed to 1-indexed
            };
            chunks.push(chunkData);
            // When we add a chunk, we assume its children are part of it,
            // so we don't process them independently at this level.
            // Set processChildren to false to avoid adding nested items redundantly.
            // If nested analysis is desired later, this logic needs adjustment.
            processChildren = false;
        }

        // Recurse into children if needed
        if (processChildren) {
            for (const child of node.children) {
                chunks.push(...this.findLogicalChunks(child, text));
            }
        }

        return chunks; // No need to filter here, we return CodeChunk objects
    }

    /**
     * Checks recursively if a node or any of its descendants are error nodes.
     *
     * @param node The SyntaxNode to check.
     * @returns True if an error node is found, false otherwise.
     */
    private hasErrorRecursive(node: SyntaxNode | null): boolean {
        if (!node) {
            return false;
        }
        // Check only for the ERROR type
        if (node.type === 'ERROR') {
            return true;
        }
        for (const child of node.children) {
            if (this.hasErrorRecursive(child)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Splits the input code text into logical chunks based on AST structure.
     *
     * @param text The source code text to split.
     * @returns A list of CodeChunk objects.
     * @throws Error if the code cannot be parsed or contains significant errors.
     */
    public splitText(text: string): CodeChunk[] {
        let tree: Tree;
        try {
            tree = this.parser.parse(text);
        } catch (parseError) {
            console.error("CodeSplitter: Failed during initial parse operation:", parseError);
            throw new Error(`Failed during initial parse operation: ${parseError}`);
        }

        if (!tree.rootNode) {
             console.error("CodeSplitter: Could not parse code. No root node generated.", {text: text.substring(0, 100) + "..."});
             throw new Error(`Could not parse code. No root node generated.`);
        }

        // Use the recursive error check
        if (this.hasErrorRecursive(tree.rootNode)) {
             console.error("CodeSplitter: Could not parse code. Tree contains error nodes.", {text: text.substring(0, 100) + "..."});
             throw new Error(`Could not parse code cleanly. Tree contains error nodes.`);
        }

        // Start the chunk finding process from the root node
        const chunks = this.findLogicalChunks(tree.rootNode, text);

        return chunks;
    }
} 