#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto'; // Import crypto for UUID generation

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

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
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

  async loadGraph() {
    try {
      // Use instance memory path
      const data = await fs.readFile(this.memoryPath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      const graph = { entities: [], relations: [] };
      lines.forEach(line => {
        const item = JSON.parse(line);
        // Add type field explicitly when loading if it's missing (for potential backward compat)
        if (!item.type && item.name && item.entityType) item.type = 'entity';
        else if (!item.type && item.from && item.to && item.relationType) item.type = 'relation';

        if (item.type === "entity") {
          // Ensure observations is always an array
          item.observations = Array.isArray(item.observations) ? item.observations : [];
          // Ensure metadata exists if needed later
          item.metadata = item.metadata || {};
          graph.entities.push(item);
        } else if (item.type === "relation") {
           // Ensure metadata exists if needed later
          item.metadata = item.metadata || {};
          graph.relations.push(item);
        }
      });
      return graph;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
        return { entities: [], relations: [] }; // Return empty graph if file not found
      }
      // Log other errors for better debugging
      console.error(`Error loading graph from ${this.memoryPath}:`, error);
      throw error; // Re-throw other errors
    }
  }

  async saveGraph(graph) {
     // Ensure entities and relations are arrays before mapping
    const entitiesToSave = Array.isArray(graph.entities) ? graph.entities : [];
    const relationsToSave = Array.isArray(graph.relations) ? graph.relations : [];

    const lines = [
       // Add type explicitly when saving
      ...entitiesToSave.map(e => JSON.stringify({ type: "entity", ...e })),
      ...relationsToSave.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    try {
        // Use instance memory path
      await fs.writeFile(this.memoryPath, lines.join("\n"));
    } catch (error) {
        console.error(`Error saving graph to ${this.memoryPath}:`, error);
        throw error;
    }
  }

  async createEntities(entities) {
    const graph = await this.loadGraph();
    const newEntities = [];
    entities.forEach(entity => {
      if (!graph.entities.some(existingEntity => existingEntity.name === entity.name)) {
        // Ensure observations is initialized if not provided
        entity.observations = Array.isArray(entity.observations) ? entity.observations : [];
        newEntities.push(entity);
      }
    });
    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    return newEntities;
  }

  async createRelations(relations) {
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation => 
      existingRelation.from === r.from && 
      existingRelation.to === r.to && 
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(observationsInput) {
    const graph = await this.loadGraph();
    const results = [];

    for (const input of observationsInput) {
      const entity = graph.entities.find(e => e.name === input.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${input.entityName} not found`);
      }

      // Ensure observations is initialized as an array
      entity.observations = Array.isArray(entity.observations) ? entity.observations : [];
      const addedObservations = [];

      for (const obsToAdd of input.observationsToAdd) {
        // Assign a unique ID if one is not provided
        if (!obsToAdd.id) {
          obsToAdd.id = crypto.randomUUID();
        }

        // Check if observation with the same ID already exists
        if (!entity.observations.some(existingObs => existingObs.id === obsToAdd.id)) {
          entity.observations.push(obsToAdd);
          addedObservations.push(obsToAdd);
        }
      }
      results.push({ entityName: input.entityName, addedObservations });
    }

    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames) {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph);
  }

  async deleteObservations(deletions) {
    const graph = await this.loadGraph();
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity && Array.isArray(entity.observations) && Array.isArray(d.observationIds)) {
        const idsToDelete = new Set(d.observationIds);
        entity.observations = entity.observations.filter(o => !idsToDelete.has(o.id));
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations) {
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(r => !relations.some(delRelation => 
      r.from === delRelation.from && 
      r.to === delRelation.to && 
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph);
  }

  async readGraph() {
    return this.loadGraph();
  }

  // Very basic search function - expanded for new fields
  async searchNodes(query) {
    const graph = await this.loadGraph();
    const lowerCaseQuery = query.toLowerCase();

    const filteredEntities = graph.entities.filter(e => {
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
      // Check tags
      if (e.tags?.some(tag => tag.toLowerCase().includes(lowerCaseQuery))) {
        return true;
      }
      // Check observations content AND metadata
      if (e.observations?.some(o => {
        // Check standard observation fields
        if (o.content?.toLowerCase().includes(lowerCaseQuery) || 
            o.observationType?.toLowerCase().includes(lowerCaseQuery) ||
            o.source?.toLowerCase().includes(lowerCaseQuery) ||
            o.author?.toLowerCase().includes(lowerCaseQuery)) {
              return true;
            }
        // Check observation metadata
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

      // Check entity metadata (kept for backward compatibility or direct entity metadata)
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

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
    const filteredGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
    return filteredGraph;
  }

  async openNodes(names) {
    const graph = await this.loadGraph();
    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
    const filteredGraph = {
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

// Define Observation schema for reuse (keep this at top level as it's just a definition)
const observationSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique ID for the observation (optional, will be generated if missing)" },
    observationType: { type: "string", description: "Type of observation (e.g., 'comment', 'todo', 'refactoring_suggestion')" },
    content: { type: "string", description: "The main text of the observation" },
    filePath: { type: "string", description: "File relevant to the observation" },
    line: { type: "number", description: "Line number relevant to the observation (1-indexed)" },
    severity: { type: "string", enum: ['high', 'medium', 'low', 'info'], description: "Severity level" },
    source: { type: "string", description: "Origin (e.g., 'static_analysis', 'human_annotator', 'llm')" },
    timestamp: { type: "string", format: "date-time", description: "ISO 8601 timestamp" },
    author: { type: "string", description: "Who/what created the observation" },
    relatedEntities: { type: "array", items: { type: "string" }, description: "Names of other related entities" },
    metadata: { type: "object", description: "Other custom data" }
  },
  required: ["observationType", "content"]
};

// Move server setup and request handlers into the main function

async function main() {
  // Instantiate the manager and server inside main
  const knowledgeGraphManager = new KnowledgeGraphManager();
  const server = new Server({
      name: "memory-server",
      version: "0.6.3", // Consider updating version
    },    {
        capabilities: {
          tools: {},
        },
      },);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // ... (Keep all tool definitions as they were) ...
             {
                name: "create_entities",
                // ... properties ...
             },
             // ... other tools ...
             {
                name: "open_nodes",
                // ... properties ...
             },
            ],
        };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error(`No arguments provided for tool: ${name}`);
    }

    // Use the knowledgeGraphManager instance created in main()
    switch (name) {
      case "create_entities":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createEntities(args.entities), null, 2) }] };
      case "create_relations":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createRelations(args.relations), null, 2) }] };
      case "add_observations":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.addObservations(args.observationsInput), null, 2) }] };
      case "delete_entities":
        await knowledgeGraphManager.deleteEntities(args.entityNames);
        return { content: [{ type: "text", text: "Entities deleted successfully" }] };
      case "delete_observations":
        await knowledgeGraphManager.deleteObservations(args.deletions);
        return { content: [{ type: "text", text: "Observations deleted successfully" }] };
      case "delete_relations":
        await knowledgeGraphManager.deleteRelations(args.relations);
        return { content: [{ type: "text", text: "Relations deleted successfully" }] };
      case "read_graph":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2) }] };
      case "search_nodes":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.searchNodes(args.query), null, 2) }] };
      case "open_nodes":
        return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.openNodes(args.names), null, 2) }] };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  // Connect transport inside main
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

// Check if the script is being run directly before calling main()
// This prevents main() from running when the file is imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
      console.error("Fatal error in main():", error);
      process.exit(1);
    });
}