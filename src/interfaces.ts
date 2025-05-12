import { type MultiGraph } from 'graphology'; // Use named type import for MultiGraph
import type { Entity, Relation, Observation } from './types.js';

/**
 * @interface IFileHandler
 * Defines the contract for file operations related to persistence of the knowledge graph.
 * Implementations will handle reading from and writing to a storage medium (e.g., a JSON file).
 */
export interface IFileHandler {
  /**
   * Loads data from the persistence store.
   * @returns A promise that resolves to an array of strings, each representing a line (e.g., a JSON object).
   */
  loadData(): Promise<string[]>;

  /**
   * Saves data to the persistence store, typically overwriting existing data.
   * @param lines - An array of strings (e.g., JSON objects) to be saved.
   * @returns A promise that resolves when the save operation is complete.
   */
  saveData(lines: string[]): Promise<void>;

  /**
   * Appends a single line (e.g., a new JSON object) to the persistence store.
   * Useful for adding new entities or relations without rewriting the entire file.
   * @param line - The string line to append.
   * @returns A promise that resolves when the append operation is complete.
   */
  appendLine(line: string): Promise<void>;

  /**
   * Updates a specific line in the persistence store, identified by a unique ID.
   * Requires the ability to locate and replace a line based on its content (e.g., an 'id' field within a JSON string).
   * @param id - The unique identifier of the entity or relation whose line is to be updated.
   * @param newLine - The new string line to replace the old one.
   * @returns A promise that resolves when the update operation is complete.
   */
  updateLineById(id: string, newLine: string): Promise<void>;

  /**
   * Deletes a specific line from the persistence store, identified by a unique ID.
   * Requires the ability to locate and remove a line based on its content.
   * @param id - The unique identifier of the entity or relation whose line is to be deleted.
   * @returns A promise that resolves when the delete operation is complete.
   */
  deleteLineById(id: string): Promise<void>;
}

/**
 * @interface IGraphHandler
 * Defines the contract for managing the in-memory graph representation using graphology.
 * It handles operations like adding, updating, deleting, and querying graph nodes (entities) and edges (relations).
 * It also provides mechanisms to initialize the graph from structured data and export it.
 */
export interface IGraphHandler {
  /**
   * Initializes the in-memory graph with a given set of entities and relations.
   * This typically clears any existing graph data before populating.
   * @param entities - An array of Entity objects to be added as nodes.
   * @param relations - An array of Relation objects to be added as edges.
   */
  initializeGraph(entities: Entity[], relations: Relation[]): void;

  /**
   * Adds a new entity as a node to the graph.
   * @param entity - The Entity object to add.
   */
  addEntityNode(entity: Entity): void;

  /**
   * Adds a new relation as an edge to the graph.
   * @param relation - The Relation object to add.
   */
  addRelationEdge(relation: Relation): void;

  /**
   * Retrieves an entity node from the graph by its ID.
   * @param id - The unique ID of the entity to retrieve.
   * @returns The Entity object if found, otherwise undefined.
   */
  getEntityNodeById(id: string): Entity | undefined;

  /**
   * Retrieves a relation edge from the graph by its ID.
   * @param id - The unique ID of the relation to retrieve.
   * @returns The Relation object if found, otherwise undefined.
   */
  getRelationEdgeById(id: string): Relation | undefined;

  /**
   * Updates the attributes of an existing entity node in the graph.
   * @param entityId - The ID of the entity node to update.
   * @param attributes - An object containing the entity attributes to update. This should exclude the 'id'.
   * @returns The updated Entity object if found and updated, otherwise undefined.
   */
  updateEntityNodeAttributes(entityId: string, attributes: Partial<Omit<Entity, 'id' | 'observations'>>): Entity | undefined;

  /**
   * Updates the attributes of an existing relation edge in the graph.
   * @param relationId - The ID of the relation edge to update.
   * @param attributes - An object containing the relation attributes to update. This should exclude the 'id'.
   * @returns The updated Relation object if found and updated, otherwise undefined.
   */
  updateRelationEdgeAttributes(relationId: string, attributes: Partial<Omit<Relation, 'id'>>): Relation | undefined;

  /**
   * Deletes an entity node from the graph by its ID.
   * @param id - The ID of the entity node to delete.
   * @returns True if the entity node was successfully deleted, false otherwise.
   */
  deleteEntityNode(id: string): boolean;

  /**
   * Deletes a relation edge from the graph by its ID.
   * @param id - The ID of the relation edge to delete.
   * @returns True if the relation edge was successfully deleted, false otherwise.
   */
  deleteRelationEdge(id: string): boolean;

  /**
   * Adds observations to an existing entity node.
   * @param entityId The ID of the entity to add observations to.
   * @param observations The array of Observation objects to add.
   * @returns The updated Entity object with new observations, or undefined if the entity was not found.
   */
  addObservationsToEntityNode(entityId: string, observations: Observation[]): Entity | undefined;

  /**
   * Deletes observations from an existing entity node.
   * @param entityId The ID of the entity to delete observations from.
   * @param observationIds The array of IDs of observations to delete.
   * @returns The updated Entity object with observations removed, or undefined if the entity was not found.
   */
  deleteObservationsFromEntityNode(entityId: string, observationIds: string[]): Entity | undefined;
  
  /**
   * Searches for entity nodes in the graph based on a query string.
   * The exact search mechanism (e.g., matching against names, types, attributes) is implementation-dependent.
   * @param query - The search query string.
   * @returns An array of Entity objects that match the query.
   */
  searchNodesInGraph(query: string): Entity[];

  /**
   * Retrieves all entity nodes currently in the graph.
   * @returns An array of all Entity objects.
   */
  getAllEntityNodes(): Entity[];

  /**
   * Retrieves all relation edges currently in the graph.
   * @returns An array of all Relation objects.
   */
  getAllRelationEdges(): Relation[];

  /**
   * Provides direct access to the underlying graphology instance.
   * Use with caution, as direct manipulation can bypass handler logic.
   * @returns The graphology Graph instance.
   */
  getGraphInstance(): MultiGraph | null;

  /**
   * Exports the current state of the graph as structured data.
   * @returns An object containing arrays of all entities and relations in the graph.
   */
  exportGraphNodesAndEdges(): { entities: Entity[], relations: Relation[] };

  /**
   * Retrieves the neighborhood (nodes and edges) around a given node up to a specified depth.
   * @param startNodeId - The ID of the node to start the traversal from.
   * @param maxDepth - The maximum number of hops from the start node.
   * @param direction - The direction of edges to follow ('outbound', 'inbound', 'all').
   * @returns An object containing arrays of entities and relations in the neighborhood, or null if start node not found.
   */
  getNeighborhood(startNodeId: string, maxDepth: number, direction: 'outbound' | 'inbound' | 'all'): { entities: Entity[], relations: Relation[] } | null;
}

/**
 * @interface IGraphManager
 * Defines the public API for managing the knowledge graph.
 * It orchestrates operations between an IFileHandler (for persistence)
 * and an IGraphHandler (for in-memory graph operations),
 * providing a clean interface for server-side logic (e.g., MCP tools).
 */
export interface IGraphManager {
  /**
   * Loads the graph data from the persistence store into the in-memory graph representation.
   * This should be called during application startup or when a data refresh is needed.
   * @returns A promise that resolves when the graph is loaded.
   */
  loadGraphFromStore(): Promise<void>;

  /**
   * Persists the current state of the in-memory graph to the persistence store.
   * This is typically called after any operation that modifies the graph.
   * @returns A promise that resolves when the graph is saved.
   */
  saveGraphToStore(): Promise<void>;

  /**
   * Creates new entities in the knowledge graph.
   * @param entityData - An array of entity data objects. 'id' and 'metadata' fields are typically auto-generated.
   * @returns A promise that resolves to an array of the created Entity objects.
   */
  createEntities(entityData: Array<Omit<Entity, 'id' | 'metadata'>>): Promise<Entity[]>;

  /**
   * Creates new relations in the knowledge graph.
   * @param relationData - An array of relation data objects. 'id' and 'metadata' fields are typically auto-generated.
   * @returns A promise that resolves to an array of the created Relation objects.
   */
  createRelations(relationData: Array<Omit<Relation, 'id' | 'metadata'>>): Promise<Relation[]>;

  /**
   * Adds observations to a specified entity.
   * @param entityId - The ID of the entity to which observations will be added.
   * @param observationsData - An array of observation data. 'id' and 'metadata' for observations are typically auto-generated.
   * @returns A promise that resolves to the updated Entity object, or null if the entity is not found.
   */
  addObservations(entityId: string, observationsData: Array<Omit<Observation, 'id' | 'metadata'>>): Promise<Entity | null>;

  /**
   * Deletes entities from the knowledge graph by their IDs.
   * @param entityIds - An array of IDs of entities to delete.
   * @returns A promise that resolves to an array of IDs of successfully deleted entities.
   */
  deleteEntities(entityIds: string[]): Promise<string[]>;

  /**
   * Deletes observations from a specified entity by their IDs.
   * @param entityId - The ID of the entity from which observations will be deleted.
   * @param observationIds - An array of IDs of observations to delete.
   * @returns A promise that resolves to the updated Entity object, or null if the entity is not found or no observations were deleted.
   */
  deleteObservations(entityId: string, observationIds: string[]): Promise<Entity | null>;

  /**
   * Deletes relations from the knowledge graph by their IDs.
   * @param relationIds - An array of IDs of relations to delete.
   * @returns A promise that resolves to an array of IDs of successfully deleted relations.
   */
  deleteRelations(relationIds: string[]): Promise<string[]>;

  /**
   * Searches for entity nodes based on a query string.
   * @param query - The search query.
   * @returns A promise that resolves to an array of matching Entity objects.
   */
  searchNodes(query: string): Promise<Entity[]>;

  /**
   * Retrieves entities by their IDs.
   * @param entityIds - An array of entity IDs to retrieve.
   * @returns A promise that resolves to an array of found Entity objects. Entities not found will be omitted.
   */
  getEntitiesByIds(entityIds: string[]): Promise<Entity[]>;

  /**
   * Retrieves relations by their IDs.
   * @param relationIds - An array of relation IDs to retrieve.
   * @returns A promise that resolves to an array of found Relation objects. Relations not found will be omitted.
   */
  getRelationsByIds(relationIds: string[]): Promise<Relation[]>;

  /**
   * Updates an existing entity.
   * @param entityId - The ID of the entity to update.
   * @param updates - An object containing the fields to update. 'id' and 'metadata' cannot be updated directly.
   * @returns A promise that resolves to the updated Entity object, or null if the entity is not found.
   */
  updateEntity(entityId: string, updates: Partial<Omit<Entity, 'id' | 'metadata' | 'observations'>>): Promise<Entity | null>;

  /**
   * Updates an existing relation.
   * @param relationId - The ID of the relation to update.
   * @param updates - An object containing the fields to update. 'id' and 'metadata' cannot be updated directly.
   * @returns A promise that resolves to the updated Relation object, or null if the relation is not found.
   */
  updateRelation(relationId: string, updates: Partial<Omit<Relation, 'id' | 'metadata'>>): Promise<Relation | null>;

  /**
   * Retrieves the neighborhood (nodes and edges) around a given node up to a specified depth.
   * @param startNodeId - The ID of the node to start the traversal from.
   * @param maxDepth - The maximum number of hops from the start node.
   * @param direction - The direction of edges to follow ('outbound', 'inbound', 'all').
   * @returns A promise that resolves to an object containing arrays of entities and relations in the neighborhood, or null if start node not found.
   */
  getNeighborhood(startNodeId: string, maxDepth: number, direction: 'outbound' | 'inbound' | 'all'): Promise<{ entities: Entity[], relations: Relation[] } | null>;
} 