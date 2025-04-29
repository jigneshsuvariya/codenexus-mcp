#!/usr/bin/env node

import { Server, ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  McpError,
  Tool, // Import Tool type
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto'; // Import crypto for UUID generation
import { Entity, Relation, KnowledgeGraph, Observation, AddObservationInput, AddObservationResult, DeleteObservationInput } from './types.js'; // Import the new types
import { z, ZodError } from 'zod'; // Import Zod and ZodError

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
});

// Schema for generic success message output
const SuccessMessageSchema = z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })).length(1)
}).describe("Standard success message structure");

// Schemas for tool inputs/outputs

const CreateEntitiesInputSchema = z.object({
    entities: z.array(EntitySchema.omit({ type: true, observations: true }).partial().merge(z.object({
        name: z.string(),
        entityType: z.string(),
        observations: z.array(
            ObservationSchema.omit({ id: true }).partial().merge(z.object({
                observationType: z.string(),
                content: z.string()
            }))
        ).optional()
    })))
        .describe("Array of partial entity objects to create. 'name' and 'entityType' are required. Nested 'observations' require 'observationType' and 'content'.")
});
const CreateEntitiesOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) });

const CreateRelationsInputSchema = z.object({
    relations: z.array(RelationSchema.omit({ type: true }).partial().merge(z.object({ from: z.string(), to: z.string(), relationType: z.string() })))
        .describe("Array of partial relation objects to create. 'from', 'to', and 'relationType' are required.")
});
const CreateRelationsOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON array of created relations

const AddObservationsInputSchema = z.object({
    observationsInput: z.array(z.object({
        entityName: z.string().describe("Name of the entity to add observations to"),
        observationsToAdd: z.array(ObservationSchema.omit({ id: true }).partial().merge(z.object({ observationType: z.string(), content: z.string()})))
            .describe("Array of partial observation objects to add. 'observationType' and 'content' are required. 'id' is ignored/generated.")
    }))
});
const AddObservationsOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON array of results

const DeleteEntitiesInputSchema = z.object({
    entityNames: z.array(z.string()).describe("Array of names of the entities to delete.")
});
// Output is SuccessMessageSchema

const DeleteObservationsInputSchema = z.object({
    deletions: z.array(z.object({
        entityName: z.string().describe("Name of the entity to delete observations from."),
        observationIds: z.array(z.string().uuid()).describe("Array of UUIDs of the observations to delete.")
    }))
});
// Output is SuccessMessageSchema

const DeleteRelationsInputSchema = z.object({
    relations: z.array(RelationSchema.omit({ type: true }).partial().merge(z.object({ from: z.string(), to: z.string(), relationType: z.string() })))
        .describe("Array of partial relation objects identifying relations to delete. 'from', 'to', and 'relationType' are required.")
});
// Output is SuccessMessageSchema

const ReadGraphInputSchema = z.object({}).describe("No input arguments required.");
const ReadGraphOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON KnowledgeGraph

const SearchNodesInputSchema = z.object({
    query: z.string().describe("The search query string.")
});
const SearchNodesOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON KnowledgeGraph

const OpenNodesInputSchema = z.object({
    names: z.array(z.string()).describe("Array of entity names to retrieve.")
});
const OpenNodesOutputSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }); // Output is stringified JSON KnowledgeGraph

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  memoryPath: string; // Declare memoryPath property

  constructor() {
    // Determine memory path dynamically within the constructor
    const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');
    const envPath = process.env.MEMORY_FILE_PATH;
    this.memoryPath = envPath
      ? path.isAbsolute(envPath)
        ? envPath
        : path.join(path.dirname(fileURLToPath(import.meta.url)), envPath)
      : defaultMemoryPath;
    // console.error(`KnowledgeGraphManager using memory path: ${this.memoryPath}`); // Optional debug log
  }

  // Type the return value
  async loadGraph(): Promise<KnowledgeGraph> {
    try {
      // Use instance memory path
      const data = await fs.readFile(this.memoryPath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      // Initialize with specific types
      const graph: KnowledgeGraph = { entities: [], relations: [] };
      lines.forEach(line => {
        // Give item an initial type, refine inside conditional
        const item: any = JSON.parse(line);
        // Add type field explicitly when loading if it's missing (for potential backward compat)
        // These checks are for loading potentially old data, keep them.
        if (!item.type && item.name && item.entityType) item.type = 'entity';
        else if (!item.type && item.from && item.to && item.relationType) item.type = 'relation';

        if (item.type === "entity") {
          // Cast to Entity after ensuring observations/metadata
          const entityItem = item as Entity; 
          entityItem.observations = Array.isArray(entityItem.observations) ? entityItem.observations : [];
          entityItem.metadata = entityItem.metadata || {};
          graph.entities.push(entityItem);
        } else if (item.type === "relation") {
           // Cast to Relation after ensuring metadata
          const relationItem = item as Relation;
          relationItem.metadata = relationItem.metadata || {};
          graph.relations.push(relationItem);
        }
      });
      return graph;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
        // Return empty graph conforming to KnowledgeGraph type
        return { entities: [], relations: [] };
      }
      // Log other errors for better debugging
      console.error(`Error loading graph from ${this.memoryPath}:`, error);
      throw error; // Re-throw other errors
    }
  }

  // Use specific types for graph parameter and within map
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
     // Ensure entities and relations are arrays before mapping (redundant with TS type, but safe)
    const entitiesToSave = Array.isArray(graph.entities) ? graph.entities : [];
    const relationsToSave = Array.isArray(graph.relations) ? graph.relations : [];

    const lines = [
      // Add type explicitly when saving
      ...entitiesToSave.map((e: Entity) => JSON.stringify({ ...e, type: "entity" })), // Spread entity props
      ...relationsToSave.map((r: Relation) => JSON.stringify({ ...r, type: "relation" })), // Spread relation props
    ];
    try {
        // Use instance memory path
      await fs.writeFile(this.memoryPath, lines.join("\n"));
    } catch (error) {
        console.error(`Error saving graph to ${this.memoryPath}:`, error);
        throw error;
    }
  }

  // Use specific types for entities parameter and return value
  async createEntities(entities: Partial<Entity>[]): Promise<Entity[]> { // Allow partial entities as input
    const graph = await this.loadGraph();
    const newEntities: Entity[] = []; // Use Entity type
    entities.forEach((entityInput: Partial<Entity>) => {
      // Check if entity with the same name already exists
      if (!graph.entities.some(existingEntity => existingEntity.name === entityInput.name)) {
        // Ensure required fields are present or provide defaults
        if (!entityInput.name || !entityInput.entityType) {
           console.warn('Skipping entity creation: Missing required fields name or entityType', entityInput);
           return; // Skip this entity if required fields missing
        }
        // Create a full Entity object, providing defaults where needed
        const fullEntity: Entity = {
            type: 'entity', // Ensure type is set
            name: entityInput.name,
            entityType: entityInput.entityType,
            observations: Array.isArray(entityInput.observations) ? entityInput.observations : [], // Default observations
            // Add other properties from entityInput or defaults
            language: entityInput.language,
            filePath: entityInput.filePath,
            startLine: entityInput.startLine,
            endLine: entityInput.endLine,
            signature: entityInput.signature,
            summary: entityInput.summary,
            accessModifier: entityInput.accessModifier,
            isStatic: entityInput.isStatic,
            isAsync: entityInput.isAsync,
            namespace: entityInput.namespace,
            tags: entityInput.tags,
            metadata: entityInput.metadata || {},
        };
        newEntities.push(fullEntity);
        graph.entities.push(fullEntity); // Add the validated entity to the graph
      }
    });
    // Removed redundant push of newEntities, already pushed inside loop
    // graph.entities.push(...newEntities); 
    await this.saveGraph(graph);
    return newEntities;
  }

  // Use specific types for relations parameter and return value
  async createRelations(relations: Partial<Relation>[]): Promise<Relation[]> { // Allow partial relations
    const graph = await this.loadGraph();
    const newRelations: Relation[] = []; // Use Relation type
    const existingRelationKeys = new Set(
        graph.relations.map(r => `${r.from}::${r.to}::${r.relationType}`)
    );

    relations.forEach((relationInput: Partial<Relation>) => {
      // Ensure required fields are present
      if (!relationInput.from || !relationInput.to || !relationInput.relationType) {
          console.warn('Skipping relation creation: Missing required fields from, to, or relationType', relationInput);
          return; // Skip this relation
      }
      const relationKey = `${relationInput.from}::${relationInput.to}::${relationInput.relationType}`;
      if (!existingRelationKeys.has(relationKey)) {
         // Create a full Relation object
          const fullRelation: Relation = {
              type: 'relation', // Ensure type is set
              from: relationInput.from,
              to: relationInput.to,
              relationType: relationInput.relationType,
              // Add other optional properties
              filePath: relationInput.filePath,
              line: relationInput.line,
              contextSnippet: relationInput.contextSnippet,
              metadata: relationInput.metadata || {},
          };
        newRelations.push(fullRelation);
        graph.relations.push(fullRelation); // Add to graph
        existingRelationKeys.add(relationKey); // Add key to set to prevent duplicates in same batch
      }
    });
    // Removed redundant push
    // graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  // Use the defined types (imported from types.ts)
  async addObservations(observationsInput: AddObservationInput[]): Promise<AddObservationResult[]> {
    const graph = await this.loadGraph();
    const results: AddObservationResult[] = [];

    for (const input of observationsInput) {
      const entity = graph.entities.find(e => e.name === input.entityName);
      if (!entity) {
        console.warn(`Entity with name ${input.entityName} not found during addObservations`);
        // Optionally add an error entry to results?
        // results.push({ entityName: input.entityName, addedObservations: [], error: 'Entity not found' });
        continue; // Skip this input if entity not found
      }

      // No need to initialize entity.observations, Entity interface requires it
      // entity.observations = Array.isArray(entity.observations) ? entity.observations : [];
      const addedObservations: Observation[] = [];

      // Check observationsToAdd exists and is iterable
      if (input.observationsToAdd && Array.isArray(input.observationsToAdd)) {
          for (const obsToAddPartial of input.observationsToAdd) {
              // Ensure required fields are present
              if (!obsToAddPartial.observationType || !obsToAddPartial.content) {
                   console.warn('Skipping observation add: Missing required fields observationType or content', obsToAddPartial);
                   continue; // Skip this observation
              }

              // Assign a unique ID if one is not provided
              const obsId = obsToAddPartial.id || crypto.randomUUID();

              // Check if observation with the same ID already exists
              if (!entity.observations.some(existingObs => existingObs.id === obsId)) {
                  // Create a full Observation object
                  const fullObservation: Observation = {
                      id: obsId,
                      observationType: obsToAddPartial.observationType,
                      content: obsToAddPartial.content,
                      // Add other optional fields
                      filePath: obsToAddPartial.filePath,
                      line: obsToAddPartial.line,
                      severity: obsToAddPartial.severity,
                      source: obsToAddPartial.source,
                      timestamp: obsToAddPartial.timestamp,
                      author: obsToAddPartial.author,
                      relatedEntities: obsToAddPartial.relatedEntities,
                      metadata: obsToAddPartial.metadata || {},
                  };
                  entity.observations.push(fullObservation);
                  addedObservations.push(fullObservation);
              }
          }
      }
      results.push({ entityName: input.entityName, addedObservations });
    }

    await this.saveGraph(graph);
    return results;
  }

  // Use the defined type (imported from types.ts)
  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    // Filter entities based on names
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    // Filter relations involving the deleted entities
    const entityNameSet = new Set(entityNames);
    graph.relations = graph.relations.filter(r => !entityNameSet.has(r.from) && !entityNameSet.has(r.to));
    // Removed temporary checks, types handle this
    await this.saveGraph(graph);
  }

  // Use the defined type (imported from types.ts)
  async deleteObservations(deletions: DeleteObservationInput[]): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach((d: DeleteObservationInput) => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      // Check if entity exists and observations is an array (guaranteed by Entity type)
      if (entity && Array.isArray(d.observationIds)) { 
        const idsToDelete = new Set(d.observationIds);
        // Filter observations based on ID, ensuring o.id is defined
        entity.observations = entity.observations.filter(o => typeof o.id === 'string' && !idsToDelete.has(o.id));
      }
    });
    // Removed temporary checks
    await this.saveGraph(graph);
  }

  // Use Relation type, allow partial for input flexibility
  async deleteRelations(relations: Partial<Relation>[]): Promise<void> {
    const graph = await this.loadGraph();
    // Create a set of keys for relations to delete for efficient lookup
    const relationsToDeleteKeys = new Set(
        relations
            .filter(dr => dr.from && dr.to && dr.relationType) // Ensure required fields are present
            .map(dr => `${dr.from}::${dr.to}::${dr.relationType}`)
    );
    
    // Filter out relations whose keys are in the set
    graph.relations = graph.relations.filter(r => {
        const relationKey = `${r.from}::${r.to}::${r.relationType}`;
        return !relationsToDeleteKeys.has(relationKey);
    });
    // Removed temporary checks
    await this.saveGraph(graph);
  }

  // Return type is KnowledgeGraph
  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  // Return type is KnowledgeGraph, query is string
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const lowerCaseQuery = query.toLowerCase();

    const filteredEntities = graph.entities.filter(e => { // e is now type Entity
      // Check standard fields
      if (e.name?.toLowerCase().includes(lowerCaseQuery) ||
          e.entityType?.toLowerCase().includes(lowerCaseQuery) ||
          e.language?.toLowerCase().includes(lowerCaseQuery) ||
          e.filePath?.toLowerCase().includes(lowerCaseQuery) ||
          e.signature?.toLowerCase().includes(lowerCaseQuery) ||
          e.summary?.toLowerCase().includes(lowerCaseQuery) ||
          e.namespace?.toLowerCase().includes(lowerCaseQuery)) {
        return true;
      }
      // Check tags (tag is string based on Entity type)
      if (e.tags?.some(tag => tag.toLowerCase().includes(lowerCaseQuery))) {
        return true;
      }
      // Check observations content AND metadata (o is Observation)
      if (e.observations?.some(o => { 
        // Check standard observation fields
        if (o.content?.toLowerCase().includes(lowerCaseQuery) || 
            o.observationType?.toLowerCase().includes(lowerCaseQuery) ||
            o.source?.toLowerCase().includes(lowerCaseQuery) ||
            o.author?.toLowerCase().includes(lowerCaseQuery)) {
              return true;
            }
        // Check observation metadata (value is any)
        if (o.metadata && Object.entries(o.metadata).some(([key, value]) => 
            key.toLowerCase().includes(lowerCaseQuery) ||
            (typeof value === 'string' && value.toLowerCase().includes(lowerCaseQuery)) ||
             // Handle potential numbers/booleans in metadata, convert to string for search
            (typeof value === 'number' && value.toString().toLowerCase().includes(lowerCaseQuery)) ||
            (typeof value === 'boolean' && value.toString().toLowerCase().includes(lowerCaseQuery))
        )) {
          return true;
        }
        return false;
      })) {
        return true;
      }

      // Check entity metadata (value is any)
      if (e.metadata && Object.entries(e.metadata).some(([key, value]) => 
          key.toLowerCase().includes(lowerCaseQuery) ||
          (typeof value === 'string' && value.toLowerCase().includes(lowerCaseQuery)) ||
          (typeof value === 'number' && value.toString().toLowerCase().includes(lowerCaseQuery)) ||
          (typeof value === 'boolean' && value.toString().toLowerCase().includes(lowerCaseQuery))
      )) {
        return true;
      }

      return false;
    });

    // Create a Set of filtered entity names for quick lookup (e is Entity)
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    // Filter relations to only include those between filtered entities (r is Relation)
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
    return filteredGraph;
  }

  // Return type is KnowledgeGraph, names is string[]
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    // Filter entities (e is Entity)
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
    // Create a Set of filtered entity names for quick lookup (e is Entity)
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    // Filter relations to only include those between filtered entities (r is Relation)
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
    return filteredGraph;
  }
}

export { KnowledgeGraphManager }; // Export the class for import

// const knowledgeGraphManager = new KnowledgeGraphManager(); // Keep instance creation local to where needed (e.g., main)

// The server instance and tools exposed will be created in main()
// const server = new Server(...); 

// Move server setup and request handlers into the main function

async function main(): Promise<void> {
  const knowledgeGraphManager: KnowledgeGraphManager = new KnowledgeGraphManager();
  
  // Re-add capabilities definition
  const server: Server = new Server({
    name: "knowledge-graph-mcp",
    version: "1.1.0",
  }, {
    // Explicitly declare tool capability
    capabilities: {
      tools: {}
    }
  });

  // Define tools with direct JSON Schema objects
  const tools: Tool[] = [
      {
          name: "create_entities",
          description: "Create multiple new entities in the knowledge graph.",
          inputSchema: {
              type: "object",
              properties: {
                  entities: {
                      type: "array",
                      items: {
                          type: "object",
                          properties: {
                              name: { type: "string", description: "Unique identifier" },
                              entityType: { type: "string", description: "Type of entity (e.g., 'class', 'function')" },
                              language: { type: "string", description: "Programming language" },
                              filePath: { type: "string", description: "Relative path to the file" },
                              startLine: { type: "integer", minimum: 1, description: "Starting line number (1-indexed)" },
                              endLine: { type: "integer", minimum: 1, description: "Ending line number (1-indexed)" },
                              signature: { type: "string", description: "Function/method signature" },
                              summary: { type: "string", description: "Brief description" },
                              accessModifier: { type: "string", enum: ['public', 'private', 'protected'] },
                              isStatic: { type: "boolean" },
                              isAsync: { type: "boolean" },
                              namespace: { type: "string" },
                              tags: { type: "array", items: { type: "string" } },
                              observations: {
                                  type: "array",
                                  items: {
                                      type: "object",
                                      properties: {
                                          observationType: { type: "string" },
                                          content: { type: "string" },
                                          // Add other optional Observation properties here if needed for input schema
                                          filePath: { type: "string" },
                                          line: { type: "integer", minimum: 1 },
                                          severity: { type: "string", enum: ['high', 'medium', 'low', 'info'] },
                                          source: { type: "string" },
                                          timestamp: { type: "string", format: "date-time" },
                                          author: { type: "string" },
                                          relatedEntities: { type: "array", items: { type: "string" } },
                                          metadata: { type: "object" }
                                      },
                                      required: ["observationType", "content"],
                                      additionalProperties: false
                                  }
                              },
                              metadata: { type: "object" }
                          },
                          required: ["name", "entityType"],
                          additionalProperties: false // Usually good practice for input schemas
                      },
                      description: "Array of partial entity objects to create. 'name' and 'entityType' are required. Nested 'observations' require 'observationType' and 'content'."
                  }
              },
              required: ["entities"],
              additionalProperties: false
          },
          outputSchema: {
              type: "object",
              properties: {
                  content: {
                      type: "array",
                      items: {
                          type: "object",
                          properties: {
                              type: { type: "string", const: "text" },
                              text: { type: "string", description: "Stringified JSON array of created entities" }
                          },
                          required: ["type", "text"]
                      },
                      minItems: 1,
                      maxItems: 1
                  }
              },
              required: ["content"]
          }
      },
      {
          name: "create_relations",
          description: "Create multiple new relations between existing entities.",
          inputSchema: {
              type: "object",
              properties: {
                  relations: {
                      type: "array",
                      items: {
                          type: "object",
                          properties: {
                              from: { type: "string", description: "Name of the source entity" },
                              to: { type: "string", description: "Name of the target entity" },
                              relationType: { type: "string", description: "Type of relationship (e.g., 'CALLS')" },
                              filePath: { type: "string" },
                              line: { type: "integer", minimum: 1 },
                              contextSnippet: { type: "string" },
                              metadata: { type: "object" }
                          },
                          required: ["from", "to", "relationType"],
                          additionalProperties: false
                      },
                      description: "Array of partial relation objects to create. 'from', 'to', and 'relationType' are required."
                  }
              },
              required: ["relations"],
              additionalProperties: false
          },
          outputSchema: { // Assuming output is similar to create_entities (stringified relation array)
              type: "object",
              properties: {
                  content: {
                      type: "array",
                      items: {
                          type: "object",
                          properties: {
                              type: { type: "string", const: "text" },
                              text: { type: "string", description: "Stringified JSON array of created relations" }
                          },
                          required: ["type", "text"]
                      },
                      minItems: 1,
                      maxItems: 1
                  }
              },
              required: ["content"]
          }
      },
       {
            name: "add_observations",
            description: "Add observations to existing entities.",
            inputSchema: {
                type: "object",
                properties: {
                    observationsInput: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                entityName: { type: "string", description: "Name of the entity to add observations to" },
                                observationsToAdd: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            observationType: { type: "string" },
                                            content: { type: "string" },
                                            filePath: { type: "string" },
                                            line: { type: "integer", minimum: 1 },
                                            severity: { type: "string", enum: ['high', 'medium', 'low', 'info'] },
                                            source: { type: "string" },
                                            timestamp: { type: "string", format: "date-time" },
                                            author: { type: "string" },
                                            relatedEntities: { type: "array", items: { type: "string" } },
                                            metadata: { type: "object" }
                                            // id is omitted as it's generated/ignored on input
                                        },
                                        required: ["observationType", "content"],
                                        additionalProperties: false
                                    },
                                    description: "Array of partial observation objects to add. 'observationType' and 'content' are required."
                                }
                            },
                            required: ["entityName", "observationsToAdd"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["observationsInput"],
                additionalProperties: false
            },
            outputSchema: { // Assuming output is stringified AddObservationResult array
                type: "object",
                properties: {
                    content: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { type: "string", const: "text" },
                                text: { type: "string", description: "Stringified JSON array of results (added observations per entity)" }
                            },
                            required: ["type", "text"]
                        },
                        minItems: 1,
                        maxItems: 1
                    }
                },
                required: ["content"]
            }
       },
       {
           name: "delete_entities",
           description: "Delete entities and their associated relations/observations by name.",
           inputSchema: {
               type: "object",
               properties: {
                   entityNames: {
                       type: "array",
                       items: { type: "string" },
                       description: "Array of names of the entities to delete."
                   }
               },
               required: ["entityNames"],
               additionalProperties: false
           },
           outputSchema: { // Generic success message
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
       {
           name: "delete_observations",
           description: "Delete specific observations from entities.",
           inputSchema: {
               type: "object",
               properties: {
                   deletions: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               entityName: { type: "string", description: "Name of the entity" },
                               observationIds: {
                                   type: "array",
                                   items: { type: "string", format: "uuid" },
                                   description: "Array of UUIDs of the observations to delete."
                               }
                           },
                           required: ["entityName", "observationIds"],
                           additionalProperties: false
                       }
                   }
               },
               required: ["deletions"],
               additionalProperties: false
           },
           outputSchema: { // Generic success message
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
       {
           name: "delete_relations",
           description: "Delete specific relations between entities.",
           inputSchema: {
               type: "object",
               properties: {
                   relations: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               from: { type: "string" },
                               to: { type: "string" },
                               relationType: { type: "string" }
                               // Only include required fields to identify the relation
                           },
                           required: ["from", "to", "relationType"],
                           additionalProperties: false // Keep this strict for identification
                       },
                       description: "Array of partial relation objects identifying relations to delete. 'from', 'to', and 'relationType' are required."
                   }
               },
               required: ["relations"],
               additionalProperties: false
           },
           outputSchema: { // Generic success message
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
       {
           name: "read_graph",
           description: "Read the entire current knowledge graph.",
           inputSchema: { // Empty object schema
               type: "object",
               properties: {},
               additionalProperties: false
           },
           outputSchema: { // Output is stringified KnowledgeGraph
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string", description: "Stringified JSON KnowledgeGraph" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
       {
           name: "search_nodes",
           description: "Search for nodes (entities) based on a query string across various fields.",
           inputSchema: {
               type: "object",
               properties: {
                   query: { type: "string", description: "The search query string." }
               },
               required: ["query"],
               additionalProperties: false
           },
           outputSchema: { // Output is stringified KnowledgeGraph
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string", description: "Stringified JSON KnowledgeGraph of matching nodes" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
       {
           name: "open_nodes",
           description: "Retrieve specific entities by name and their direct relations.",
           inputSchema: {
               type: "object",
               properties: {
                   names: {
                       type: "array",
                       items: { type: "string" },
                       description: "Array of entity names to retrieve."
                   }
               },
               required: ["names"],
               additionalProperties: false
           },
           outputSchema: { // Output is stringified KnowledgeGraph
               type: "object",
               properties: {
                   content: {
                       type: "array",
                       items: {
                           type: "object",
                           properties: {
                               type: { type: "string", const: "text" },
                               text: { type: "string", description: "Stringified JSON KnowledgeGraph of specified nodes and their relations" }
                           },
                           required: ["type", "text"]
                       },
                       minItems: 1,
                       maxItems: 1
                   }
               },
               required: ["content"]
           }
       },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Directly return the array of tool definitions with JSON Schemas
    return { tools }; // No need for 'as any' cast anymore
  });

  // Use original CallToolRequest type, remove explicit handler/return types
  // Keep Zod parsing here for validation
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    const toolName = name;

    if (args === undefined || args === null) {
        console.error(`Error executing tool '${toolName}': No arguments provided.`);
        return { error: { code: 'invalid_request', message: `No arguments provided for tool: ${toolName}` } };
    }

    try {
        switch (toolName) {
        case "create_entities": {
            const parsedArgs = CreateEntitiesInputSchema.parse(args); // Keep Zod parsing
            const createdEntities = await knowledgeGraphManager.createEntities(parsedArgs.entities);
            return { content: [{ type: "text", text: JSON.stringify(createdEntities, null, 2) }] };
        }
        case "create_relations": {
            const parsedArgs = CreateRelationsInputSchema.parse(args); // Keep Zod parsing
            const createdRelations = await knowledgeGraphManager.createRelations(parsedArgs.relations);
            return { content: [{ type: "text", text: JSON.stringify(createdRelations, null, 2) }] };
        }
        case "add_observations": {
            const parsedArgs = AddObservationsInputSchema.parse(args); // Keep Zod parsing
            const results = await knowledgeGraphManager.addObservations(parsedArgs.observationsInput);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }
        case "delete_entities": {
            const parsedArgs = DeleteEntitiesInputSchema.parse(args); // Keep Zod parsing
            await knowledgeGraphManager.deleteEntities(parsedArgs.entityNames);
            return { content: [{ type: "text", text: "Entities deleted successfully" }] };
        }
        case "delete_observations": {
            const parsedArgs = DeleteObservationsInputSchema.parse(args); // Keep Zod parsing
            await knowledgeGraphManager.deleteObservations(parsedArgs.deletions);
            return { content: [{ type: "text", text: "Observations deleted successfully" }] };
        }
        case "delete_relations": {
            const parsedArgs = DeleteRelationsInputSchema.parse(args); // Keep Zod parsing
            await knowledgeGraphManager.deleteRelations(parsedArgs.relations);
            return { content: [{ type: "text", text: "Relations deleted successfully" }] };
        }
        case "read_graph": {
            ReadGraphInputSchema.parse(args); // Keep Zod parsing (for empty object check)
            const graph = await knowledgeGraphManager.readGraph();
            return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
        }
        case "search_nodes": {
            const parsedArgs = SearchNodesInputSchema.parse(args); // Keep Zod parsing
            const results = await knowledgeGraphManager.searchNodes(parsedArgs.query);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }
        case "open_nodes": {
            const parsedArgs = OpenNodesInputSchema.parse(args); // Keep Zod parsing
            const results = await knowledgeGraphManager.openNodes(parsedArgs.names);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }
        default:
            console.error(`Error executing tool: Unknown tool name '${toolName}'`);
            return { error: { code: 'invalid_request', message: `Unknown tool: ${toolName}` } };
        }
    } catch (error) {
        console.error(`Error executing tool '${toolName}':`, error);
        if (error instanceof ZodError) {
            return { error: { code: 'invalid_params', message: `Invalid arguments for tool ${toolName}: ${error.errors.map(e => `${e.path.join('.')} (${e.code}): ${e.message}`).join(', ')}` } };
        }
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during tool execution';
        return { error: { code: 'internal_error', message: `Tool execution failed for ${toolName}: ${errorMessage}` } };
    }
  });

  // Connect transport inside main
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

// Check if the script is being run directly before calling main()
// This prevents main() from running when the file is imported.
// Need to adjust path check for TS -> JS compilation
// A common pattern is to check process.mainModule, but that's CJS specific.
// For ESM, the original check might be okay if run via `node dist/server.js`
// Let's keep the original logic for now and test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
      console.error("Fatal error in main():", error);
      process.exit(1);
    });
}