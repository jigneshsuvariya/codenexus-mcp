#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
// import { promises as fs } from 'fs'; // No longer needed directly here
// import path from 'path'; // No longer needed directly here
// import { fileURLToPath } from 'url'; // No longer needed directly here

// New imports for refactored architecture
import { FileHandler } from './FileHandler.js';
import { GraphHandler } from './GraphHandler.js';
import { GraphManager } from './GraphManager.js';

// Types are still needed for schemas, etc.
import type { Entity, Relation, Observation } from "./types.js"; // Note: KnowledgeGraph type might be removed if not used directly by server.ts anymore

// MEMORY_FILE_PATH is now handled by FileHandler, but server might need to pass it if not using env var
// const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');
// const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
//   ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
//     ? process.env.MEMORY_FILE_PATH
//     : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH)
//   : defaultMemoryPath;

// Remove old KnowledgeGraphManager class
// class KnowledgeGraphManager { ... } // (Removed - approx 130 lines)

// Instantiate new handlers and manager
// The FileHandler constructor will use process.env.MEMORY_FILE_PATH or its default.
const fileHandler = new FileHandler(); 
const graphHandler = new GraphHandler();
const graphManager = new GraphManager(fileHandler, graphHandler);


// The server instance and tools exposed
const server = new Server({
  name: "codenexus-mcp-memory-server", // Updated name
  version: "1.0.0", // Updated version for new architecture
}, {
    capabilities: {
      tools: {},
    },
  });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Initialize the graph manager (loads data from file)
  // This should ideally be done once at server startup.
  // For simplicity in this context, we might call it here or ensure it's called before any tool use.
  // A better pattern would be an async initialization block for the server.
  // await graphManager.loadGraphFromStore(); // Moved to main() for one-time init

  return {
    tools: [
      {
        name: "create_entities",
        description: "Create multiple new entities in the knowledge graph. IDs and metadata are auto-generated.",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                description: "Data for a new entity. 'id' and 'metadata' will be auto-generated.",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity (e.g., person, place, concept)" },
                  description: { type: "string", description: "A brief description of the entity" },
                  attributes: { type: "object", additionalProperties: true, description: "Key-value pairs for additional entity attributes" },
                  source: { type: "string", description: "Origin or source of this entity information" },
                  confidenceScore: { type: "number", description: "Confidence score for this entity's existence/accuracy (0.0 to 1.0)" },
                  tags: { type: "array", items: { type: "string" }, description: "Descriptive tags for categorization or search" },
                  state: { type: "string", description: "Current state or status of the entity (e.g., active, deprecated)" },
                  observations: {
                    type: "array",
                    items: {
                      type: "object",
                      description: "Data for a new observation. 'id', 'metadata', and 'entityName' will be auto-generated/set.",
                      properties: {
                        contents: { type: "string", description: "The actual content of the observation" },
                        description: { type: "string" },
                        attributes: { type: "object", additionalProperties: true },
                      },
                      required: ["contents"]
                    },
                    description: "Initial observations associated with the entity. IDs and metadata auto-generated."
                  },
                },
                required: ["name", "entityType"], // Core requirements
              },
            },
          },
          required: ["entities"],
        },
      },
      {
        name: "create_relations",
        description: "Create multiple new relations between entities. IDs and metadata are auto-generated.",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                description: "Data for a new relation. 'id' and 'metadata' will be auto-generated.",
                properties: {
                  from: { type: "string", description: "ID of the entity where the relation starts" },
                  to: { type: "string", description: "ID of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation (e.g., 'connected_to', 'owns', 'is_a')" },
                  description: { type: "string" },
                  attributes: { type: "object", additionalProperties: true },
                  source: { type: "string" },
                  confidenceScore: { type: "number" },
                  tags: { type: "array", items: { type: "string" } },
                  state: { type: "string" },
                  undirected: { type: "boolean", description: "Optional. True if the relation is undirected. Defaults to false (directed)." }
                },
                required: ["from", "to", "relationType"],
              },
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to an existing entity. Observation IDs and metadata are auto-generated.",
        inputSchema: {
          type: "object",
          properties: {
            entityId: { type: "string", description: "The ID of the entity to add observations to" },
            observations: {
              type: "array",
              items: {
                type: "object",
                description: "Data for a new observation. 'id' and 'metadata' auto-generated.",
                properties: {
                  contents: { type: "string", description: "The actual content of the observation" },
                  description: { type: "string" },
                  attributes: { type: "object", additionalProperties: true },
                  source: { type: "string" },
                  confidenceScore: { type: "number" },
                  tags: { type: "array", items: { type: "string" } },
                  state: { type: "string" }
                },
                required: ["contents"],
              },
              description: "An array of observation data to add."
            }
          },
          required: ["entityId", "observations"],
        },
      },
      {
        name: "delete_entities",
        description: "Delete entities by their IDs. Also deletes connected relations.",
        inputSchema: {
          type: "object",
          properties: {
            entityIds: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity IDs to delete",
            },
          },
          required: ["entityIds"],
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from an entity by their IDs.",
        inputSchema: {
          type: "object",
          properties: {
            entityId: { type: "string", description: "The ID of the entity from which to delete observations" },
            observationIds: {
              type: "array",
              items: { type: "string" },
              description: "An array of observation IDs to delete",
            },
          },
          required: ["entityId", "observationIds"],
        },
      },
      {
        name: "delete_relations",
        description: "Delete relations by their IDs.",
        inputSchema: {
          type: "object",
          properties: {
            relationIds: {
              type: "array",
              items: { type: "string" },
              description: "An array of relation IDs to delete",
            },
          },
          required: ["relationIds"],
        },
      },
      // read_graph tool is removed as per plan (Task 26), GraphManager provides getEntitiesByIds/searchNodes
      {
        name: "search_nodes", // Renamed from search_nodes for consistency (was searchNodes in old manager)
        description: "Search for entity nodes based on a query string. Searches name, type, description, tags, and observation contents/descriptions.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query string" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_entities_by_ids", // New name, replaces open_nodes and part of read_graph
        description: "Retrieve full entity details for a list of entity IDs.",
        inputSchema: {
          type: "object",
          properties: {
            entityIds: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity IDs to retrieve."
            }
          },
          required: ["entityIds"],
        },
      },
      {
        name: "get_relations_by_ids",
        description: "Retrieve full relation details for a list of relation IDs.",
        inputSchema: {
          type: "object",
          properties: {
            relationIds: {
              type: "array",
              items: { type: "string" },
              description: "An array of relation IDs to retrieve."
            }
          },
          required: ["relationIds"],
        },
      },
      {
        name: "update_entity",
        description: "Update attributes of an existing entity. 'id', 'metadata', and 'observations' cannot be updated with this tool.",
        inputSchema: {
            type: "object",
            properties: {
                entityId: { type: "string", description: "ID of the entity to update." },
                updates: {
                    type: "object",
                    description: "Fields to update. 'id', 'metadata', 'observations' are ignored if provided.",
                    // Define properties that can be updated, mirroring Entity structure minus restricted fields
                    properties: {
                      name: { type: "string" },
                      entityType: { type: "string" },
                      description: { type: "string" },
                      attributes: { type: "object", additionalProperties: true },
                      source: { type: "string" },
                      confidenceScore: { type: "number" },
                      tags: { type: "array", items: { type: "string" } },
                      state: { type: "string" },
                    },
                    additionalProperties: false // Disallow other properties
                }
            },
            required: ["entityId", "updates"]
        }
      },
      {
          name: "update_relation",
          description: "Update attributes of an existing relation. 'id' and 'metadata' cannot be updated with this tool.",
          inputSchema: {
              type: "object",
              properties: {
                  relationId: { type: "string", description: "ID of the relation to update." },
                  updates: {
                      type: "object",
                      description: "Fields to update. 'id' and 'metadata' are ignored if provided.",
                      properties: {
                          relationType: { type: "string" },
                          description: { type: "string" },
                          attributes: { type: "object", additionalProperties: true },
                          source: { type: "string" },
                          confidenceScore: { type: "number" },
                          tags: { type: "array", items: { type: "string" } },
                          state: { type: "string" },
                      },
                      additionalProperties: false
                  }
              },
              required: ["relationId", "updates"]
          }
      },
      {
        name: "get_neighborhood",
        description: "Retrieves nodes and edges within a specified number of hops from a start node.",
        inputSchema: {
          type: "object",
          properties: {
            startNodeId: { type: "string", description: "ID of the node to start traversal from." },
            maxDepth: { type: "number", default: 1, description: "Maximum number of hops (e.g., 1 for direct neighbors)." },
            direction: { type: "string", enum: ["outbound", "inbound", "all"], default: "outbound", description: "Direction of edges to follow." }
          },
          required: ["startNodeId"]
        }
      }
    ],
  };
});

// Type for the request object inferred from the Zod schema
type CallToolRequest = z.infer<typeof CallToolRequestSchema>;

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  // Revert to using request.params.name and request.params.arguments based on linter feedback
  const toolName = request.params.name; 
  const props = request.params.arguments as any; // This was 'args' in old code, now mapping to 'props' variable name

  // Ensure graph is loaded before any tool call, if not done globally.
  // await graphManager.loadGraphFromStore(); // Moved to main()

  try {
    switch (toolName) {
      case "create_entities":
        // Map input schema to Omit<Entity, 'id' | 'metadata'>[]
        const entitiesToCreate = props.entities.map((e: any) => ({
          name: e.name,
          entityType: e.entityType,
          description: e.description,
          attributes: e.attributes,
          source: e.source,
          confidenceScore: e.confidenceScore,
          tags: e.tags,
          state: e.state,
          // Map initial observations if provided in schema
          observations: e.observations ? e.observations.map((obs: any) => ({
            contents: obs.contents,
            description: obs.description,
            attributes: obs.attributes,
            source: obs.source,
            confidenceScore: obs.confidenceScore,
            tags: obs.tags,
            state: obs.state,
            // entityName will be set by GraphManager for new observations
          })) : [],
        }));
        const createdEntities = await graphManager.createEntities(entitiesToCreate);
        return { props: { results: createdEntities } };
      
      case "create_relations":
        const relationsToCreate = props.relations.map((r: any) => ({
          from: r.from,
          to: r.to,
          relationType: r.relationType,
          description: r.description,
          attributes: r.attributes,
          source: r.source,
          confidenceScore: r.confidenceScore,
          tags: r.tags,
          state: r.state,
          undirected: r.undirected === true // Ensure boolean, defaults to false if undefined
        }));
        const createdRelations = await graphManager.createRelations(relationsToCreate);
        return { props: { results: createdRelations } };

      case "add_observations":
        const observationsToAdd = props.observations.map((o: any) => ({
            contents: o.contents,
            description: o.description,
            attributes: o.attributes,
            source: o.source,
            confidenceScore: o.confidenceScore,
            tags: o.tags,
            state: o.state,
        }));
        const entityAfterAddObs = await graphManager.addObservations(props.entityId, observationsToAdd);
        return { props: { result: entityAfterAddObs } };
      
      case "delete_entities":
        const deletedEntityIds = await graphManager.deleteEntities(props.entityIds);
        return { props: { results: { deletedIds: deletedEntityIds } } };

      case "delete_observations":
        const entityAfterDeleteObs = await graphManager.deleteObservations(props.entityId, props.observationIds);
        return { props: { result: entityAfterDeleteObs } };

      case "delete_relations":
        const deletedRelationIds = await graphManager.deleteRelations(props.relationIds);
        return { props: { results: { deletedIds: deletedRelationIds } } };
      
      case "search_nodes":
        const searchResults = await graphManager.searchNodes(props.query);
        return { props: { results: searchResults } };

      case "get_entities_by_ids":
        const fetchedEntities = await graphManager.getEntitiesByIds(props.entityIds);
        return { props: { results: fetchedEntities } };
      
      case "get_relations_by_ids":
        const fetchedRelations = await graphManager.getRelationsByIds(props.relationIds);
        return { props: { results: fetchedRelations } };

      case "update_entity":
        const updatedEntity = await graphManager.updateEntity(props.entityId, props.updates);
        return { props: { result: updatedEntity } };
        
      case "update_relation":
        const updatedRelation = await graphManager.updateRelation(props.relationId, props.updates);
        return { props: { result: updatedRelation } };

      case "get_neighborhood":
        const neighborhoodResult = await graphManager.getNeighborhood(
          props.startNodeId,
          props.maxDepth === undefined ? 1 : props.maxDepth, // Handle default for maxDepth
          props.direction || 'outbound' // Handle default for direction
        );
        return { props: { result: neighborhoodResult } };

      default:
        throw new Error(`Tool ${toolName} not found`);
    }
  } catch (error: any) {
    // console.error(`Error executing tool ${toolName}:`, error); // This error is structured and returned, so it should be fine.
    // It's good practice to return a structured error that the MCP client can understand
    return {
      error: {
        code: "tool_execution_error",
        message: error.message || "An unexpected error occurred while executing the tool.",
        details: error.stack, // Optional: include stack trace for debugging
      },
    };
  }
});

async function main() {
  // console.log("Memory server starting...");
  try {
    await graphManager.loadGraphFromStore(); // Load graph data once at startup
    // console.log("Graph data loaded successfully.");
  } catch (error) {
    // console.error("Failed to load graph data on startup:", error); // Keep this for critical startup failure
    // For now, it will run with an empty graph if loading fails (GraphManager handles this)
  }
  
  const transport = new StdioServerTransport();
  // server.listen(transport); // Revert to connect as per original code and linter error
  await server.connect(transport); 
  // console.log("Memory server listening on stdio.");
}

main().catch(error => {
  console.error("Failed to start server:", error); // This is a critical error if the server fails to start at all.
  process.exit(1);
});