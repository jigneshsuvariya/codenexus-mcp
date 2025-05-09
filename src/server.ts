#!/usr/bin/env node

// Use McpServer for higher-level abstraction
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// --- Import necessary types and server components based on filesystem example ---
// import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { fileURLToPath } from 'url';
// Removed unused imports for old KnowledgeGraph, Observation, etc.
// Import only the needed new types explicitly
import { z } from 'zod'; // Import Zod and ZodError
import { GraphologyManager } from './graphologyManager.js'; // <-- Import the new manager
import type { NodeAttributes } from './types.js';

/**
 * @typedef {Object} Observation
 * @property {string} id Unique ID for the observation (e.g., UUID)
 * @property {string} observationType Type of observation (e.g., 'comment', 'todo', 'refactoring_suggestion').
 *                                    Standard types include:
 *                                      - 'design_pattern_use': Describes the use of a design pattern. Metadata may include `patternName`, `role` (e.g., 'client', 'creator').
 *                                      - 'design_decision': Documents a specific design choice. Metadata may include `rationale`, `alternativesConsidered`, `decisionMaker`, `relatedIssue`.
 *                                      - 'change_rationale': Explains the reason for a code change. Metadata may include `commitHash`, `author`, `relatedIssue`, `summaryOfChange`.
 *                                      - 'project_meta': Stores project-level metadata (usually attached to a 'Project' entity). Metadata depends on the specific info (e.g., `repositoryUrl`, `primaryTechnology`).
 *                                      - (Other types like 'comment', 'todo', 'fixme', 'security_note', 'performance_note' are also common).
 * @property {string} content The main text of the observation
 * @property {string} [filePath] File relevant to the observation
 * @property {number} [line] Line number relevant to the observation (1-indexed)
 * @property {'high' | 'medium' | 'low' | 'info'} [severity] Severity level
 * @property {string} [source] Origin (e.g., 'static_analysis', 'human_annotator', 'llm', 'code_comment')
 * @property {string} [timestamp] ISO 8601 timestamp
 * @property {string} [author] Who/what created the observation
 * @property {string[]} [relatedEntities] Names of other related entities
 * @property {Record<string, any>} [metadata] Other custom data. See recommended fields under `observationType` for standard types.
 */

/**
 * @typedef {Object} ProjectEntity
 * @property {string} name Unique name/identifier for the project (e.g., 'my-web-app')
 * @property {'project'} entityType Must be 'project'
 * @property {string} [description] High-level description of the project
 * @property {string[]} [technologies] List of key technologies used (e.g., ['React', 'Node.js', 'PostgreSQL'])
 * @property {string} [architectureStyle] Overall architecture (e.g., 'Microservices', 'Monolith', 'Serverless')
 * @property {string} [repositoryUrl] URL of the code repository
 * @property {Observation[]} observations Relevant observations for the project itself (e.g., high-level design decisions, roadmap links)
 * @property {Record<string, any>} [metadata] Other custom project-specific data
 */

/**
 * @typedef {Object} Entity
 * @property {string} name Unique identifier (e.g., function name, class name, file path)
 * @property {string} entityType Type of entity (e.g., 'class', 'function', 'module', 'variable', 'file')
 * @property {string} [language] Programming language (e.g., 'javascript', 'python')
 * @property {string} [filePath] Relative path to the file containing the entity
 * @property {number} [startLine] Starting line number (1-indexed)
 * @property {number} [endLine] Ending line number (1-indexed)
 * @property {string} [signature] For functions/methods: parameter list, return type
 * @property {string} [summary] Brief description (e.g., from docstring)
 * @property {'public' | 'private' | 'protected'} [accessModifier] Language-specific access control
 * @property {boolean} [isStatic] Language-specific static indicator
 * @property {boolean} [isAsync] Language-specific async indicator
 * @property {string} [namespace] Module or namespace
 * @property {string[]} [tags] User-defined tags for categorization
 * @property {Observation[]} observations Structured observations associated with this entity
 * @property {Record<string, any>} [metadata] Other custom or tool-specific data
 */

/**
 * @typedef {Object} Relation
 * @property {string} from Name of the source entity
 * @property {string} to Name of the target entity
 * @property {string} relationType Type of relationship (e.g., 'CALLS', 'IMPLEMENTS', 'IMPORTS')
 * @property {string} [filePath] File where the relation occurs/is defined
 * @property {number} [line] Line number where the relation occurs (1-indexed)
 * @property {string} [contextSnippet] Small code snippet illustrating the relation
 * @property {Record<string, any>} [metadata] Other custom or tool-specific data
 */

/**
 * @typedef {Object} KnowledgeGraph
 * @property {Entity[]} entities
 * @property {Relation[]} relations
 */

// Define Zod schemas corresponding to TypeScript interfaces
// Base Observation Schema (used within Entity and for addObservations input)
const ObservationSchema = z.object({
  id: z.string().uuid().optional().describe("Unique ID for the observation (UUID format, optional)"),
  observationType: z.string().describe("Type of observation (e.g., 'comment', 'todo')"),
  content: z.string().describe("The main text of the observation"),
  filePath: z.string().optional().describe("File relevant to the observation"),
  line: z.number().int().positive().optional().describe("Line number relevant (1-indexed)"),
  severity: z.enum(['high', 'medium', 'low', 'info']).optional().describe("Severity level"),
  source: z.string().optional().describe("Origin (e.g., 'static_analysis', 'human_annotator')"),
  timestamp: z.string().datetime().optional().describe("ISO 8601 timestamp"), // Zod uses string().datetime() for ISO8601
  author: z.string().optional().describe("Who/what created the observation"),
  relatedEntities: z.array(z.string()).optional().describe("Names of other related entities"),
  metadata: z.record(z.any()).optional().describe("Other custom data (key-value pairs)"),
});

// Base Entity Schema
const EntitySchema = z.object({
  type: z.literal('entity').describe("Must be 'entity'"),
  name: z.string().describe("Unique identifier (e.g., function name, class name, file path)"),
  entityType: z.string().describe("Type of entity (e.g., 'class', 'function', 'module')"),
  language: z.string().optional().describe("Programming language"),
  filePath: z.string().optional().describe("Relative path to the file containing the entity"),
  startLine: z.number().int().positive().optional().describe("Starting line number (1-indexed)"),
  endLine: z.number().int().positive().optional().describe("Ending line number (1-indexed)"),
  signature: z.string().optional().describe("Function/method signature"),
  summary: z.string().optional().describe("Brief description (e.g., from docstring)"),
  accessModifier: z.enum(['public', 'private', 'protected']).optional().describe("Language-specific access control"),
  isStatic: z.boolean().optional().describe("Language-specific static indicator"),
  isAsync: z.boolean().optional().describe("Language-specific async indicator"),
  namespace: z.string().optional().describe("Module or namespace"),
  tags: z.array(z.string()).optional().describe("User-defined tags for categorization"),
  observations: z.array(ObservationSchema).describe("Structured observations associated with this entity"), // Use ObservationSchema here
  metadata: z.record(z.any()).optional().describe("Other custom or tool-specific data"),
});

// Base Relation Schema
const RelationSchema = z.object({
  type: z.literal('relation').describe("Must be 'relation'"),
  from: z.string().describe("Name of the source entity"),
  to: z.string().describe("Name of the target entity"),
  relationType: z.string().describe("Type of relationship (e.g., 'CALLS', 'IMPLEMENTS')"),
  filePath: z.string().optional().describe("File where the relation occurs/is defined"),
  line: z.number().int().positive().optional().describe("Line number where the relation occurs (1-indexed)"),
  contextSnippet: z.string().optional().describe("Small code snippet illustrating the relation"),
  metadata: z.record(z.any()).optional().describe("Other custom or tool-specific data"),
});

// KnowledgeGraph Schema (used for outputs)
const KnowledgeGraphSchema = z.object({
  entities: z.array(EntitySchema).describe("List of entities in the graph"),
  relations: z.array(RelationSchema).describe("List of relations in the graph"),
  // Note: Graphology export might have a different structure. Adjust if needed.
});

// Schema for generic success message output
const SuccessMessageSchema = z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })).length(1)
}).describe("Standard success message structure");

// Define Zod schemas for graphology-based operations (adjusting input/output)
// Use the imported types for better clarity if possible, though Zod defines the runtime shape.
const NodeAttributesSchema = z.record(z.any()).describe("Arbitrary attributes for a node/entity.");
const EdgeAttributesSchema = z.record(z.any()).describe("Arbitrary attributes for an edge/relation.");

// Adjusted Schemas using imported types where applicable for description/intent
// Actual validation relies on the Zod structure defined here.

const CreateEntitiesInputSchema = z.object({
    entities: z.array(z.object({
        id: z.string().describe("Unique ID for the entity node."),
        type: z.string().describe("The type of the entity (e.g., 'class', 'function', 'file')."),
        // Use Partial<NodeAttributes> equivalent in Zod
        attributes: NodeAttributesSchema.optional().describe("Additional attributes for the entity.")
    })).describe("Array of entities (EntityInput) to create or update.")
});

const CreateEntitiesOutputSchema = z.object({
    createdIds: z.array(z.string()).describe("IDs of newly created entities."),
    existingIds: z.array(z.string()).describe("IDs of entities that already existed (attributes may have been merged).")
});

const CreateRelationsInputSchema = z.object({
    relations: z.array(z.object({
        id: z.string().describe("Unique ID for the relation edge."),
        source: z.string().describe("ID of the source node."),
        target: z.string().describe("ID of the target node."),
        type: z.string().describe("The type of the relation (e.g., 'calls', 'contains')."),
        // Use Partial<EdgeAttributes> equivalent in Zod
        attributes: EdgeAttributesSchema.optional().describe("Additional attributes for the relation.")
    })).describe("Array of relations (RelationInput) to create.")
});

const CreateRelationsOutputSchema = z.object({
    createdKeys: z.array(z.string()).describe("Keys (IDs) of newly created relations."),
    errors: z.array(z.string()).describe("Error messages for relations that could not be created (e.g., missing nodes, duplicate ID)." )
});

const CreateObservationsInputSchema = z.object({
    // Changed from 'observationsInput' to 'observations' for consistency
    observations: z.array(z.object({
        id: z.string().describe("Unique ID for the observation node."),
        content: z.string().describe("The textual content of the observation."),
        relatedEntityIds: z.array(z.string()).describe("IDs of entities this observation relates to."),
        tags: z.array(z.string()).optional().describe("Optional tags for categorization."),
        // Use Partial<NodeAttributes> equivalent in Zod (Observation nodes are still nodes)
        attributes: NodeAttributesSchema.optional().describe("Additional attributes for the observation node.")
    })).describe("Array of observations (ObservationInput) to create.")
});

const CreateObservationsOutputSchema = z.object({
    createdIds: z.array(z.string()).describe("IDs of newly created observation nodes.")
});

const ReadGraphInputSchema = z.object({
    filter: z.object({
        types: z.array(z.string()).optional().describe("Filter nodes by type (e.g., ['function', 'class'])."),
        attributes: z.record(z.any()).optional().describe("Filter nodes by matching attribute key-value pairs."),
        nodeIds: z.array(z.string()).optional().describe("Return only nodes with these specific IDs (and edges between them).")
    }).optional().describe("Optional filters to apply to the graph retrieval.")
}).describe("Input for reading the graph, allows optional filtering.");

// Define ReadGraphOutputSchema directly with the expected structure
const ReadGraphOutputSchema = z.object({
    nodes: z.array(z.object({
        id: z.string(),
        attributes: NodeAttributesSchema // Use the z.record schema here
    })).describe("List of nodes matching the filter (or all nodes if no filter)."),
    edges: z.array(z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        attributes: EdgeAttributesSchema // Use the z.record schema here
    })).describe("List of edges connecting the returned nodes.")
});

const UpdateEntitiesInputSchema = z.object({
    updates: z.array(z.object({
        id: z.string().describe("ID of the entity node to update."),
        attributes: NodeAttributesSchema.describe("Attributes to merge into the existing node. Keys provided will overwrite existing values.")
    })).describe("Array of updates to apply to existing entities.")
});

const UpdateEntitiesOutputSchema = z.object({
    updatedIds: z.array(z.string()).describe("IDs of entities that were successfully updated."),
    notFoundIds: z.array(z.string()).describe("IDs of entities that were not found.")
});
const AddObservationsOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON array of results

const DeleteEntitiesInputSchema = z.object({
    ids: z.array(z.string()).describe("Array of IDs of the entity nodes to delete.")
});
// Output is SuccessMessageSchema

const DeleteEntitiesOutputSchema = z.object({
    deletedIds: z.array(z.string()).describe("IDs of entities that were successfully deleted."),
    notFoundIds: z.array(z.string()).describe("IDs of entities that were not found.")
});
// Output is SuccessMessageSchema

const DeleteRelationsInputSchema = z.object({
    keys: z.array(z.string()).describe("Array of keys (IDs) of the relation edges to delete.")
});

const DeleteRelationsOutputSchema = z.object({
    deletedKeys: z.array(z.string()).describe("Keys of relations that were successfully deleted."),
    notFoundKeys: z.array(z.string()).describe("Keys of relations that were not found.")
});

// New tool schema
const AnalyzeCodebaseInputSchema = z.object({
    filePaths: z.array(z.string()).describe("An array of file paths or glob patterns to analyze and add to the knowledge graph.")
});

const AnalyzeCodebaseOutputSchema = z.object({
    analyzedFiles: z.number().int().describe("Number of files matched and analyzed."),
    entitiesCreated: z.number().int().describe("Number of new entity nodes created in the graph."),
    relationsCreated: z.number().int().describe("Number of new relation edges created in the graph (e.g., 'contains').")
});

// Schemas for query_graph_advanced tool (Task 9d)
const QueryGraphAdvancedInputSchema = z.object({
    query_type: z.enum(["traversal", "shortest_path"]).describe("The main mode of operation."),
    start_node_ids: z.array(z.string()).optional().describe("IDs of nodes to begin traversal/search. Required for 'traversal'. First ID is source for 'shortest_path'."),
    target_node_id: z.string().optional().describe("ID of the target node. Required for 'shortest_path'."),
    traversal_options: z.object({
        algorithm: z.enum(["bfs", "dfs"]).default("bfs").describe("Traversal algorithm."),
        max_depth: z.number().int().positive().default(3).describe("Maximum traversal depth."),
        direction: z.enum(["outgoing", "incoming", "any"]).default("outgoing").describe("Edge direction to follow."),
        edge_types_filter: z.array(z.string()).optional().describe("Filter traversal by these edge types (e.g., relationType).")
    }).optional().describe("Options applicable if query_type is 'traversal'."),
    node_conditions: z.array(z.object({
        attribute: z.string().describe("Node attribute to filter on."),
        operator: z.enum(["equals", "contains", "startsWith", "regex", "in_array"]).describe("Operator for the condition."),
        value: z.any().describe("Value to compare against.")
    })).optional().describe("Conditions to filter nodes in the result set."),
    edge_conditions: z.array(z.object({
        attribute: z.string().describe("Edge attribute to filter on."),
        operator: z.enum(["equals", "contains", "startsWith", "regex", "in_array"]).describe("Operator for the condition."),
        value: z.any().describe("Value to compare against.")
    })).optional().describe("Conditions to filter edges in the result set."),
    result_options: z.object({
        composition: z.enum(["nodes_only", "nodes_and_edges", "paths"]).default("nodes_and_edges").describe("Specifies the structure of the output.")
        // include_attributes: z.array(z.string()).optional().describe("Specific attributes to return (omitted for now, returns all).")
    }).optional().describe("Options for structuring the result.")
});
// Output is SuccessMessageSchema

const QueryGraphAdvancedOutputSchema = z.object({
    query_type: z.string().describe("Echoed query_type from input."), // Echo the query type for clarity
    nodes: z.array(z.object({ id: z.string(), attributes: NodeAttributesSchema })).optional().describe("Resulting nodes."),
    edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), attributes: EdgeAttributesSchema })).optional().describe("Resulting edges."),
    paths: z.array(z.object({
        nodes: z.array(z.object({ id: z.string(), attributes: NodeAttributesSchema })),
        edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), attributes: EdgeAttributesSchema }))
        // cost: z.number().optional() // Add cost if calculating for shortest_path
    })).optional().describe("Resulting paths (e.g., for shortest_path or specific traversal results)."),
    path: z.object({
        nodes: z.array(z.object({ id: z.string(), attributes: NodeAttributesSchema })),
        edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), attributes: EdgeAttributesSchema })),
        cost: z.number().optional().describe("Cost of the shortest path, if applicable.")
    }).optional().describe("Single resulting path (primarily for shortest_path query_type).")
    // error: z.string().optional().describe("Error message if the query failed.") // Consider adding error field
});

// Keep old search/open schemas for now, might need refactoring later
const SearchNodesInputSchema = z.object({
    query: z.string().describe("The search query string.")
});
const OpenNodesInputSchema = z.object({
    names: z.array(z.string()).describe("Array of entity names to retrieve.")
});

// Define types for inferred schemas in module scope
type CreateEntitiesInputType = z.infer<typeof CreateEntitiesInputSchema>;
type CreateRelationsInputType = z.infer<typeof CreateRelationsInputSchema>;
type CreateObservationsInputType = z.infer<typeof CreateObservationsInputSchema>;
type ReadGraphInputType = z.infer<typeof ReadGraphInputSchema>;
type UpdateEntitiesInputType = z.infer<typeof UpdateEntitiesInputSchema>;
type DeleteEntitiesInputType = z.infer<typeof DeleteEntitiesInputSchema>;
type DeleteRelationsInputType = z.infer<typeof DeleteRelationsInputSchema>;
type AnalyzeCodebaseInputType = z.infer<typeof AnalyzeCodebaseInputSchema>;
type QueryGraphAdvancedInputType = z.infer<typeof QueryGraphAdvancedInputSchema>;
type SearchNodesInputType = z.infer<typeof SearchNodesInputSchema>;
type OpenNodesInputType = z.infer<typeof OpenNodesInputSchema>;

// ---------------- KnowledgeGraphManager (Moved to Module Scope) ------------------
/**
 * Manages the knowledge graph persistence and high-level operations.
 * Delegates graph manipulation and persistence to GraphologyManager.
 */
export class KnowledgeGraphManager {
    private graphManager: GraphologyManager;
    // Rename graphFilePath to memoryPath for clarity based on env var name
    private readonly memoryPath: string; 

  constructor() {
        // Determine memory path dynamically within the constructor
        const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'codenexus-knowledge-graph.json');
        const envPath = process.env.MEMORY_FILE_PATH;
        this.memoryPath = envPath
          ? path.isAbsolute(envPath)
            ? envPath
            : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', envPath) // Adjust base dir if needed
          : defaultMemoryPath;
        // Log initialization path to stderr instead of stdout
        console.error(`KnowledgeGraphManager initialized. Graph file path: ${this.memoryPath}`); 

        // Use the determined memoryPath when initializing GraphologyManager
        this.graphManager = new GraphologyManager(this.memoryPath, {
             allowSelfLoops: true,
             multi: true,
             type: 'mixed'
         });
    }

    async initialize(): Promise<void> {
        await this.graphManager.loadGraph();
    }

    // Use memoryPath internally if needed, GraphologyManager already has it.
    async persistGraph(): Promise<void> {
        // GraphologyManager already knows its path, no need to pass memoryPath here.
        await this.graphManager.saveGraph();
    }

    // --- Delegated Methods ---
    async createEntities(entities: CreateEntitiesInputType['entities']): Promise<z.infer<typeof CreateEntitiesOutputSchema>> {
        const result = this.graphManager.createEntities(entities as any);
        await this.persistGraph();
        return result;
    }
    async createRelations(relations: CreateRelationsInputType['relations']): Promise<z.infer<typeof CreateRelationsOutputSchema>> {
        const result = this.graphManager.createRelations(relations as any);
        await this.persistGraph();
        return result;
    }
    async createObservations(observations: CreateObservationsInputType['observations']): Promise<z.infer<typeof CreateObservationsOutputSchema>> {
        const result = this.graphManager.createObservations(observations as any);
        await this.persistGraph();
        return result;
    }
    async readGraph(input: ReadGraphInputType): Promise<z.infer<typeof ReadGraphOutputSchema>> {
        return this.graphManager.readGraph(input.filter);
    }
    async updateEntities(updates: UpdateEntitiesInputType['updates']): Promise<z.infer<typeof UpdateEntitiesOutputSchema>> {
        const result = this.graphManager.updateEntities(updates as { id: string; attributes: Partial<NodeAttributes> }[]);
        await this.persistGraph();
        return result;
    }
    async deleteEntities(ids: DeleteEntitiesInputType['ids']): Promise<z.infer<typeof DeleteEntitiesOutputSchema>> {
        const result = this.graphManager.deleteEntities(ids);
        await this.persistGraph();
        return result;
    }
    async deleteRelations(keys: DeleteRelationsInputType['keys']): Promise<z.infer<typeof DeleteRelationsOutputSchema>> {
        const result = this.graphManager.deleteRelations(keys);
        await this.persistGraph();
        return result;
    }
    async analyzeCodebase(filePaths: AnalyzeCodebaseInputType['filePaths']): Promise<z.infer<typeof AnalyzeCodebaseOutputSchema>> {
        const result = await this.graphManager.analyzeCodebase(filePaths);
        await this.persistGraph();
        return result;
    }

    async queryGraphAdvanced(input: QueryGraphAdvancedInputType): Promise<z.infer<typeof QueryGraphAdvancedOutputSchema>> {
        // Placeholder implementation - delegates to GraphologyManager
        console.warn("KnowledgeGraphManager.queryGraphAdvanced called, delegating to GraphologyManager. Actual implementation pending.");
        // @ts-ignore - input might not perfectly match until GraphologyManager method is defined
        return this.graphManager.queryGraphAdvanced(input);
        // TODO: Persist graph if the query modifies anything? (Likely not for queries)
    }

    // --- Methods needing review/refactoring based on Graphology --- 
    async searchNodes(query: SearchNodesInputType['query']): Promise<any> {
        console.warn("searchNodes is not fully implemented for Graphology yet.");
    const lowerCaseQuery = query.toLowerCase();
        const results = this.graphManager.getGraphInstance().filterNodes((node, attributes: NodeAttributes) => {
             return (
                 attributes.name?.toLowerCase().includes(lowerCaseQuery) ||
                 attributes.content?.toLowerCase().includes(lowerCaseQuery) ||
                 attributes.type?.toLowerCase().includes(lowerCaseQuery) ||
                 attributes.identifier?.toLowerCase().includes(lowerCaseQuery) ||
                 (Array.isArray(attributes.tags) && attributes.tags.some((tag: string) => tag.toLowerCase().includes(lowerCaseQuery)))
            );
        });
        return results.map(nodeId => ({
            id: nodeId,
            attributes: this.graphManager.getGraphInstance().getNodeAttributes(nodeId) as NodeAttributes
        }));
    }
    async openNodes(names: OpenNodesInputType['names']): Promise<any> {
        console.warn("openNodes assumes input names are valid node IDs for Graphology.");
        return this.graphManager.readGraph({ nodeIds: names });
    }
}

// ---------------- MCP Server Setup (Using McpServer) ------------------

async function main(): Promise<void> {
    console.error("[Server Log] Initializing KnowledgeGraphManager...");
    const knowledgeGraphManager = new KnowledgeGraphManager();
    await knowledgeGraphManager.initialize();
    console.error("[Server Log] KnowledgeGraphManager initialized.");

    console.error("[Server Log] Instantiating McpServer...");
    const server = new McpServer({
        name: "codenexus-mcp-knowledge-graph-server",
        version: "1.0.7",
        description: "Manages a knowledge graph of a codebase using graphology, including codebase analysis capabilities."
    });
    console.error("[Server Log] McpServer instantiated.");

    // --- Register Tools using server.tool --- 

    console.error("[Server Log] Registering tools...");

    server.tool(
        "create_entities", 
        "Creates or updates multiple entities (nodes) in the knowledge graph. If an entity ID already exists, its attributes are merged.",
        CreateEntitiesInputSchema.shape, 
        async (args: z.infer<typeof CreateEntitiesInputSchema>) => {
            const result = await knowledgeGraphManager.createEntities(args.entities);
            return { content: [{ type: "text", text: `Created: [${result.createdIds.join(', ')}]. Existing: [${result.existingIds.join(', ')}]` }] };
        }
    );

    server.tool(
        "create_relations", 
        "Creates multiple relations (edges) between existing entities in the knowledge graph.",
        CreateRelationsInputSchema.shape,
        async (args: z.infer<typeof CreateRelationsInputSchema>) => {
            const result = await knowledgeGraphManager.createRelations(args.relations);
            const errorsText = result.errors.length > 0 ? ` Errors: ${result.errors.join('; ')}` : '';
            return { content: [{ type: "text", text: `Created keys: [${result.createdKeys.join(', ')}].${errorsText}` }] };
        }
    );

    server.tool(
        "create_observations", 
        "Creates observation nodes and links them to specified related entities.",
        CreateObservationsInputSchema.shape,
        async (args: z.infer<typeof CreateObservationsInputSchema>) => {
            const result = await knowledgeGraphManager.createObservations(args.observations);
            return { content: [{ type: "text", text: `Created observation IDs: [${result.createdIds.join(', ')}]` }] };
        }
    );

    server.tool(
        "read_graph", 
        "Reads nodes and edges from the knowledge graph, with optional filtering.",
        ReadGraphInputSchema.shape,
        async (args: z.infer<typeof ReadGraphInputSchema>) => {
            const result = await knowledgeGraphManager.readGraph(args);
            // Format the complex result as text for now
            const outputText = `Found ${result.nodes.length} nodes and ${result.edges.length} edges matching filter.`; 
            // TODO: Consider returning structured data if McpServer supports richer content types for tools
            return { content: [{ type: "text", text: outputText }] }; 
        }
    );

    server.tool(
        "update_entities", 
        "Merges attributes into existing entities (nodes) in the knowledge graph.",
        UpdateEntitiesInputSchema.shape,
        async (args: z.infer<typeof UpdateEntitiesInputSchema>) => {
            const result = await knowledgeGraphManager.updateEntities(args.updates);
            return { content: [{ type: "text", text: `Updated: [${result.updatedIds.join(', ')}]. Not Found: [${result.notFoundIds.join(', ')}]` }] };
        }
    );

    server.tool(
        "delete_entities", 
        "Deletes specified entities (nodes) and their incident edges from the knowledge graph.",
        DeleteEntitiesInputSchema.shape,
        async (args: z.infer<typeof DeleteEntitiesInputSchema>) => {
            const result = await knowledgeGraphManager.deleteEntities(args.ids);
             return { content: [{ type: "text", text: `Deleted: [${result.deletedIds.join(', ')}]. Not Found: [${result.notFoundIds.join(', ')}]` }] };
       }
    );

    server.tool(
        "delete_relations", 
        "Deletes specified relations (edges) from the knowledge graph using their keys (IDs).",
        DeleteRelationsInputSchema.shape,
        async (args: z.infer<typeof DeleteRelationsInputSchema>) => {
            const result = await knowledgeGraphManager.deleteRelations(args.keys);
            return { content: [{ type: "text", text: `Deleted keys: [${result.deletedKeys.join(', ')}]. Not Found: [${result.notFoundKeys.join(', ')}]` }] };
        }
    );

    server.tool(
        "analyze_codebase", 
        "Analyzes specified files or directories using glob patterns, extracts code structure, and adds them to the knowledge graph.",
        AnalyzeCodebaseInputSchema.shape,
        async (args: z.infer<typeof AnalyzeCodebaseInputSchema>) => {
            const result = await knowledgeGraphManager.analyzeCodebase(args.filePaths);
            return { content: [{ type: "text", text: `Analyzed ${result.analyzedFiles} files. Created ${result.entitiesCreated} entities, ${result.relationsCreated} relations.` }] };
        }
    );

    server.tool(
        "query_graph_advanced", 
        "Performs advanced queries on the graph (traversal, shortest path).",
        QueryGraphAdvancedInputSchema.shape,
        async (args: z.infer<typeof QueryGraphAdvancedInputSchema>) => {
            const result = await knowledgeGraphManager.queryGraphAdvanced(args);
            // Format the complex result as text for now
            const outputText = `Query (${result.query_type}) result: ${JSON.stringify(result)}`; // Simple JSON stringify for now
            return { content: [{ type: "text", text: outputText }] };
        }
    );

    server.tool(
        "search_nodes", 
        "(Experimental) Searches graph nodes based on a query string.",
        SearchNodesInputSchema.shape,
        async (args: z.infer<typeof SearchNodesInputSchema>) => {
            const results = await knowledgeGraphManager.searchNodes(args.query);
            // This already returns the correct structure
            const textResult = results.map((node: any) => `ID: ${node.id}, Attrs: ${JSON.stringify(node.attributes)}`).join('\n');
            return { content: [{ type: "text", text: textResult || "No matching nodes found." }] };
        }
    );

    server.tool(
        "open_nodes", 
        "(Needs Verification) Retrieves specific nodes and their attributes using their IDs.",
        OpenNodesInputSchema.shape,
        async (args: z.infer<typeof OpenNodesInputSchema>) => {
            const result = await knowledgeGraphManager.openNodes(args.names);
            // Format the ReadGraphOutputSchema structure as text
             const outputText = `Opened nodes: ${JSON.stringify(result)}`; // Simple JSON stringify
            return { content: [{ type: "text", text: outputText }] };
        }
    );

    console.error("[Server Log] Tools registered.");

    // --- Connect and Run Server ---
    console.error("[Server Log] Creating StdioServerTransport...");
    const transport = new StdioServerTransport();
    console.error("[Server Log] StdioServerTransport created.");

    console.error("[Server Log] Connecting server to transport...");
    await server.connect(transport); // Use the same connect method
    console.error("[Server Log] Server connected to transport.");

    console.error("MCP server connected and listening on stdin/stdout.");
}

main().catch(error => {
    console.error("[Server Log] Fatal error starting server:", error);
    process.exit(1);
});
