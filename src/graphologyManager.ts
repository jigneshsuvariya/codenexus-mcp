import Graphology from 'graphology';
import { MultiGraph } from 'graphology';
import { Attributes, GraphOptions } from 'graphology-types';
import * as fs from 'fs/promises';
import { CodeSplitter, CodeChunk } from './utils/codeSplitter.js';
import type { EntityInput, RelationInput, ObservationInput, NodeAttributes, EdgeAttributes } from './types.js';
import { glob } from 'glob';
import { bfsFromNode } from 'graphology-traversal';
import { dijkstra, edgePathFromNodePath } from 'graphology-shortest-path';

// Helper function to check node/edge conditions
function checkConditions(attributes: Attributes, conditions?: { attribute: string; operator: string; value: any }[]): boolean {
    if (!conditions || conditions.length === 0) {
        return true;
    }
    return conditions.every(cond => {
        const attrValue = attributes[cond.attribute];
        // Basic implementation - starting with equals
        // TODO: Implement other operators (contains, startsWith, regex, in_array)
        if (cond.operator === 'equals') {
            return attrValue === cond.value;
        }
        // Add other operators here
        return false; // Default to false if operator not implemented
    });
}

export class GraphologyManager {
    // Use MultiGraph type from named import
    private graph: MultiGraph<NodeAttributes, EdgeAttributes>;
    private readonly graphFilePath: string;
    private codeSplitter: CodeSplitter;

    constructor(graphFilePath: string, options?: GraphOptions) {
        this.graphFilePath = graphFilePath;
        // Use the constructor from the default import Graphology
        this.graph = new Graphology.MultiGraph<NodeAttributes, EdgeAttributes>({
            allowSelfLoops: options?.allowSelfLoops ?? true,
            multi: true, // Ensure multi is true
            type: options?.type ?? 'mixed',
            ...options
         });
        this.codeSplitter = new CodeSplitter();
    }

    async loadGraph(): Promise<void> {
        try {
            const data = await fs.readFile(this.graphFilePath, 'utf-8');
            const parsedData = JSON.parse(data);
            this.graph.import(parsedData);
            // Log to stderr
            console.error(`Graph loaded from ${this.graphFilePath}`); 
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // Log to stderr
                console.error(`Graph file not found at ${this.graphFilePath}, starting with an empty graph.`); 
                this.graph.clear();
            } else {
                console.error(`Error loading graph from ${this.graphFilePath}:`, error);
                throw error;
            }
        }
    }

    async saveGraph(): Promise<void> {
        try {
            const data = JSON.stringify(this.graph.export(), null, 2);
            await fs.writeFile(this.graphFilePath, data, 'utf-8');
            // Log to stderr
            console.error(`Graph saved to ${this.graphFilePath}`); 
        } catch (error) {
            console.error(`Error saving graph to ${this.graphFilePath}:`, error);
            throw error;
        }
    }

    // --- Core Graph Manipulation Methods (Updated Signatures) ---

    createEntities(entities: EntityInput[]): { createdIds: string[]; existingIds: string[] } {
        const createdIds: string[] = [];
        const existingIds: string[] = [];
        entities.forEach(entity => {
            const nodeId = entity.id;
            // Combine provided attributes with mandatory type
            const nodeAttrs: NodeAttributes = {
                 ...entity.attributes, // Spread optional attributes first
                 type: entity.type,     // Ensure type is set
                 // Set name from attributes if available, otherwise default?
                 name: entity.attributes?.name || nodeId 
            };

            if (this.graph.hasNode(nodeId)) {
                existingIds.push(nodeId);
                // Merge attributes, potentially overwriting based on input
                this.graph.mergeNodeAttributes(nodeId, nodeAttrs);
                // Log to stderr
                console.error(`Entity ${nodeId} already exists. Attributes merged.`); 
            } else {
                this.graph.addNode(nodeId, nodeAttrs);
                createdIds.push(nodeId);
            }
        });
        return { createdIds, existingIds };
    }

    createRelations(relations: RelationInput[]): { createdKeys: string[]; errors: string[] } {
        const createdKeys: string[] = [];
        const errors: string[] = [];
        relations.forEach(relation => {
            if (!this.graph.hasNode(relation.source)) {
                errors.push(`Source node ${relation.source} does not exist for relation.`);
                return;
            }
            if (!this.graph.hasNode(relation.target)) {
                errors.push(`Target node ${relation.target} does not exist for relation.`);
                return;
            }

            // Combine provided attributes with mandatory type
            const edgeAttrs: EdgeAttributes = {
                ...relation.attributes, // Spread optional attributes first
                type: relation.type,    // Ensure type is set
            };

            try {
                // Use addEdgeWithKey for explicit ID control
                const edgeKey = this.graph.addEdgeWithKey(
                    relation.id, // Use provided ID as edge key
                    relation.source,
                    relation.target,
                    edgeAttrs
                );
                createdKeys.push(edgeKey);
            } catch (e: any) {
                if (this.graph.hasEdge(relation.id)) {
                    errors.push(`Relation with ID ${relation.id} already exists.`);
                } else {
                    errors.push(`Failed to add relation ${relation.id}: ${e.message}`);
                }
            }
        });
        return { createdKeys, errors };
    }

    createObservations(observations: ObservationInput[]): { createdIds: string[] } {
        const createdIds: string[] = [];
        observations.forEach(obs => {
            const obsNodeId = obs.id;
            // Construct attributes for the observation node
            const nodeAttrs: NodeAttributes = {
                ...obs.attributes,
                type: 'observation', // Explicitly set type
                name: `Observation ${obsNodeId}`, // Default name
                content: obs.content, // Required content
                tags: obs.tags,
            };

            if (this.graph.hasNode(obsNodeId)) {
                // Log to stderr
                console.error(`Observation node ${obsNodeId} already exists. Merging attributes.`); 
                this.graph.mergeNodeAttributes(obsNodeId, nodeAttrs);
                // No need to add to createdIds if merged
            } else {
                this.graph.addNode(obsNodeId, nodeAttrs);
                createdIds.push(obsNodeId);
            }

            // Link observation to related entities
            obs.relatedEntityIds.forEach((entityId: string) => {
                if (this.graph.hasNode(entityId)) {
                    try {
                         // Use a deterministic key for relates_to edges
                         const edgeKey = `${obsNodeId}-relates_to->${entityId}`;
                         const edgeAttrs: EdgeAttributes = { type: 'relates_to' };
                         if (!this.graph.hasEdge(edgeKey)) {
                             this.graph.addEdgeWithKey(edgeKey, obsNodeId, entityId, edgeAttrs);
                         } else {
                              // Optionally merge attributes if edge exists?
                              // this.graph.mergeEdgeAttributes(edgeKey, edgeAttrs);
                         }
                    } catch (e: any) {
                        // console.error is fine here
                        console.error(`Failed to link observation ${obsNodeId} to entity ${entityId}: ${e.message}`);
                    }
                } else {
                    // console.warn usually goes to stderr, keep as is
                    console.warn(`Cannot link observation ${obsNodeId}: Related entity ${entityId} not found.`);
                }
            });
        });
        return { createdIds };
    }

     readGraph(filter?: { types?: string[]; attributes?: Record<string, any>; nodeIds?: string[] }): {
          nodes: { id: string; attributes: NodeAttributes }[];
          edges: { id: string; source: string; target: string; attributes: EdgeAttributes }[];
     } {
        let nodes: string[] = this.graph.nodes();
        let edges: string[] = [];

        if (filter?.nodeIds) {
            const nodeIdsSet = new Set(filter.nodeIds || []);
            nodes = nodes.filter((nodeId: string) => nodeIdsSet.has(nodeId));
        }
        if (filter?.types) {
            const typesSet = new Set(filter.types || []);
            nodes = nodes.filter((nodeId: string) => {
                const nodeType = this.graph.getNodeAttribute(nodeId, 'type');
                return typesSet.has(nodeType);
            });
        }
        if (filter?.attributes) {
            nodes = nodes.filter((nodeId: string) => {
                const nodeAttrs = this.graph.getNodeAttributes(nodeId);
                return Object.entries(filter.attributes || {}).every(([key, value]) => {
                    return nodeAttrs[key] === value;
                });
            });
        }
        if (nodes.length > 0) {
            const nodeSet = new Set(nodes);
             this.graph.edges().forEach((edgeKey: string) => {
                const extremities = this.graph.extremities(edgeKey);
                 if (extremities && extremities.length === 2 && nodeSet.has(extremities[0]) && nodeSet.has(extremities[1])) {
                    edges.push(edgeKey);
                }
             });
        }

        // Format output to match the required structure
        const nodesOutput = nodes.map((nodeId: string) => ({
            id: nodeId,
            attributes: this.graph.getNodeAttributes(nodeId) as NodeAttributes
        }));

        const edgesOutput = edges.map((edgeKey: string) => ({
            id: edgeKey,
            source: this.graph.source(edgeKey),
            target: this.graph.target(edgeKey),
            attributes: this.graph.getEdgeAttributes(edgeKey) as EdgeAttributes
        }));

        return { nodes: nodesOutput, edges: edgesOutput };
    }

    updateEntities(updates: { id: string; attributes: Record<string, any> }[]): { updatedIds: string[]; notFoundIds: string[] } {
        const updatedIds: string[] = [];
        const notFoundIds: string[] = [];
        updates.forEach(update => {
            if (this.graph.hasNode(update.id)) {
                this.graph.mergeNodeAttributes(update.id, update.attributes);
                updatedIds.push(update.id);
            } else {
                notFoundIds.push(update.id);
            }
        });
        return { updatedIds, notFoundIds };
    }

    deleteEntities(ids: string[]): { deletedIds: string[]; notFoundIds: string[] } {
        const deletedIds: string[] = [];
        const notFoundIds: string[] = [];
        ids.forEach(id => {
            if (this.graph.hasNode(id)) {
                this.graph.dropNode(id); // Removes node and incident edges
                deletedIds.push(id);
            } else {
                notFoundIds.push(id);
            }
        });
        return { deletedIds, notFoundIds };
    }

    deleteRelations(keys: string[]): { deletedKeys: string[]; notFoundKeys: string[] } {
        const deletedKeys: string[] = [];
        const notFoundKeys: string[] = [];
        keys.forEach(key => {
            if (this.graph.hasEdge(key)) {
                this.graph.dropEdge(key);
                deletedKeys.push(key);
            } else {
                notFoundKeys.push(key);
            }
        });
        return { deletedKeys, notFoundKeys };
    }

    async analyzeCodebase(filePaths: string[]): Promise<{ analyzedFiles: number; entitiesCreated: number, relationsCreated: number }> {
        let entitiesCreated = 0;
        let relationsCreated = 0;
        let filesAnalyzed = 0;

        for (const pattern of filePaths) {
            const files = await glob(pattern, { absolute: true, nodir: true });
            filesAnalyzed += files.length;

            for (const filePath of files) {
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const chunks = this.codeSplitter.splitText(content);

                    // Create file node if it doesn't exist
                    const fileNodeId = `file:${filePath}`;
                    if (!this.graph.hasNode(fileNodeId)) {
                        this.graph.addNode(fileNodeId, {
                            type: 'file',
                            name: filePath,
                            filePath: filePath
                        });
                        entitiesCreated++;
                    }

                    chunks.forEach((chunk: CodeChunk, index: number) => {
                        // Generate a unique ID for the chunk node
                        const chunkNodeId = `code:${filePath}#${chunk.type}_${chunk.startLine}_${chunk.endLine}`;
                         let chunkName = `${chunk.type} (${filePath}:${chunk.startLine}-${chunk.endLine})`;
                         // Check if identifier exists before using it
                         const identifier = (chunk as any).identifier; // Temporary: Cast to any to check
                         if (identifier) {
                             chunkName = `${chunk.type}:${identifier} (${filePath}:${chunk.startLine}-${chunk.endLine})`;
                         }

                        const chunkNodeAttrs: NodeAttributes = {
                             type: chunk.type,
                             name: chunkName,
                             filePath: filePath,
                             startLine: chunk.startLine,
                             endLine: chunk.endLine,
                             content: chunk.content,
                             identifier: identifier, // Add identifier if it exists
                         };

                        if (!this.graph.hasNode(chunkNodeId)) {
                            this.graph.addNode(chunkNodeId, chunkNodeAttrs);
                            entitiesCreated++;

                            // Add 'contains' relation from file to chunk
                            try {
                                const edgeKey = `${fileNodeId}->contains->${chunkNodeId}`; // Deterministic key
                                if (!this.graph.hasEdge(edgeKey)) {
                                    this.graph.addEdgeWithKey(edgeKey, fileNodeId, chunkNodeId, { type: 'contains' });
                                    relationsCreated++;
                                }
                            } catch (e:any) {
                                console.error(`Failed to add 'contains' edge for ${chunkNodeId}: ${e.message}`);
                            }
                        } else {
                            this.graph.mergeNodeAttributes(chunkNodeId, chunkNodeAttrs);
                        }
                    });
                } catch (error) {
                    console.error(`Error analyzing file ${filePath}:`, error);
                }
            }
        }
        await this.saveGraph(); // Persist changes after analysis
        return { analyzedFiles: filesAnalyzed, entitiesCreated, relationsCreated };
    }

    // Helper to get the internal graph instance if needed
    getGraphInstance(): MultiGraph<NodeAttributes, EdgeAttributes> {
        return this.graph;
    }

    // Implementation for Task 9c
    async queryGraphAdvanced(input: any): Promise<any> {
        console.warn(`GraphologyManager.queryGraphAdvanced called with input:`, input);

        const { query_type, start_node_ids, target_node_id, traversal_options, node_conditions, edge_conditions, result_options } = input;
        const effective_result_composition = result_options?.composition || "nodes_and_edges";

        const output: any = {
            query_type: query_type,
            nodes: [],
            edges: [],
            paths: [],
            path: null,
            error: null
        };

        try {
            if (query_type === "traversal") {
                if (!start_node_ids || start_node_ids.length === 0) {
                    throw new Error("Missing start_node_ids for traversal query.");
                }

                const algorithm = traversal_options?.algorithm || 'bfs';
                const maxDepth = traversal_options?.max_depth !== undefined ? traversal_options.max_depth : 3;
                const direction = traversal_options?.direction || 'outgoing';
                const edgeTypesFilter = traversal_options?.edge_types_filter ? new Set(traversal_options.edge_types_filter) : null;

                const visitedNodes = new Set<string>();
                const collectedNodes: { id: string; attributes: NodeAttributes }[] = [];
                const collectedEdges: { id: string; source: string; target: string; attributes: EdgeAttributes }[] = [];
                const collectedEdgesSet = new Set<string>();

                if (algorithm !== 'bfs') {
                    throw new Error(`Traversal algorithm '${algorithm}' not yet implemented here.`);
                }

                for (const startNodeId of start_node_ids) {
                    if (!this.graph.hasNode(startNodeId)) {
                        console.warn(`Start node ${startNodeId} not found.`);
                        continue;
                    }

                    bfsFromNode(this.graph, startNodeId, (nodeId: string, nodeAttrs: Attributes, depth: number) => {

                        if (depth > maxDepth) return true;

                        const currentNodeAttrs = nodeAttrs as NodeAttributes;
                        const shouldAddNode = !visitedNodes.has(nodeId) && checkConditions(currentNodeAttrs, node_conditions);

                        if (shouldAddNode) {
                            collectedNodes.push({ id: nodeId, attributes: { ...currentNodeAttrs } }); 
                            visitedNodes.add(nodeId);
                        }

                        let edgeIterationFn: Function;
                        if (direction === 'outgoing') edgeIterationFn = this.graph.forEachOutEdge;
                        else if (direction === 'incoming') edgeIterationFn = this.graph.forEachInEdge;
                        else edgeIterationFn = this.graph.forEachEdge;

                        edgeIterationFn.call(this.graph, nodeId, (edgeKey: string, edgeAttrs: Attributes, source: string, target: string, _sourceAttrs: Attributes, _targetAttrs: Attributes, undirected: boolean) => {
                            const neighbor = (source === nodeId) ? target : source;
                            const currentEdgeAttrs = edgeAttrs as EdgeAttributes;

                            if (edgeTypesFilter && !edgeTypesFilter.has(currentEdgeAttrs.type)) {
                                return;
                            }

                            if (!collectedEdgesSet.has(edgeKey) && checkConditions(currentEdgeAttrs, edge_conditions)) {
                                const targetNodeId = neighbor;
                                const targetNodeAttrs = this.graph.getNodeAttributes(targetNodeId) as NodeAttributes;
                                const sourceNodeId = nodeId;
                                const sourceNodeAttrs = currentNodeAttrs;

                                if (checkConditions(sourceNodeAttrs, node_conditions) && checkConditions(targetNodeAttrs, node_conditions)) {
                                    collectedEdges.push({ id: edgeKey, source: source, target: target, attributes: { ...currentEdgeAttrs } }); 
                                    collectedEdgesSet.add(edgeKey);
                                }
                            }
                        });

                        return false;

                    }, { mode: direction });
                }
                output.nodes = collectedNodes;
                output.edges = collectedEdges;

            } else if (query_type === "shortest_path") {
                if (!start_node_ids || start_node_ids.length === 0 || !target_node_id) {
                    throw new Error("Missing start_node_ids or target_node_id for shortest_path query.");
                }
                const startNodeId = start_node_ids[0];

                if (!this.graph.hasNode(startNodeId) || !this.graph.hasNode(target_node_id)) {
                    throw new Error("Start or target node not found in graph.");
                }

                const getEdgeWeight = (input.getEdgeWeight === null) ?
                                      () => 1 :
                                      typeof input.getEdgeWeight === 'function' ?
                                          input.getEdgeWeight :
                                          (_s: string, _t: string, _sa: Attributes, _ta: Attributes, _edgeKey: string, edgeAttrs: Attributes) => edgeAttrs[input.getEdgeWeight || 'weight'] || 1;

                const nodePath = dijkstra.bidirectional(this.graph, startNodeId, target_node_id, getEdgeWeight);

                if (nodePath) {
                    const edgesPath = edgePathFromNodePath(this.graph, nodePath);
                    const pathNodes: { id: string; attributes: NodeAttributes }[] = nodePath.map(nodeId => ({ 
                        id: nodeId, 
                        attributes: { ...this.graph.getNodeAttributes(nodeId) }
                    }));
                    const pathEdges: { id: string; source: string; target: string; attributes: EdgeAttributes }[] = edgesPath.map(edgeKey => ({ 
                        id: edgeKey,
                        source: this.graph.source(edgeKey),
                        target: this.graph.target(edgeKey),
                        attributes: { ...this.graph.getEdgeAttributes(edgeKey) }
                    }));

                    let cost = 0;
                    pathEdges.forEach(edge => {
                        cost += getEdgeWeight("", "", {}, {}, edge.id, edge.attributes as Attributes) || 0;
                    });

                    output.path = { nodes: pathNodes, edges: pathEdges, cost: cost };
                } else {
                    // No path found, path remains null
                }
            } else {
                 throw new Error(`Unsupported query_type: ${query_type}`);
            }

        } catch (e: any) {
            console.error(`Error during queryGraphAdvanced: ${e.message}`);
            output.error = e.message;
            output.nodes = [];
            output.edges = [];
            output.paths = [];
            output.path = null;
        }

        // Adjust final output based on composition, ensuring fields exist even if empty
        output.nodes = output.nodes || [];
        output.edges = output.edges || [];
        output.paths = output.paths || [];

        if (effective_result_composition === "nodes_only") {
            delete output.edges;
            delete output.paths;
            delete output.path;
        } else if (effective_result_composition === "nodes_and_edges") {
            delete output.paths;
            if (query_type === "shortest_path" && output.path) {
                output.nodes = output.path.nodes;
                output.edges = output.path.edges;
                delete output.path;
            }
        } else if (effective_result_composition === "paths") {
            delete output.nodes;
            delete output.edges;
            if (query_type === "shortest_path" && output.path) {
                output.paths = [output.path];
                delete output.path;
            } // else: For traversal, paths would need specific collection logic (TODO)
        }

        // Clean up fields that shouldn't be there based on composition
         if (effective_result_composition !== 'nodes_and_edges' && effective_result_composition !== 'paths') {
              delete output.edges;
         }
         if (effective_result_composition !== 'nodes_and_edges' && effective_result_composition !== 'nodes_only') {
              delete output.nodes;
         }
         if (effective_result_composition !== 'paths') {
             delete output.paths;
             if (query_type !== 'shortest_path') {
                 delete output.path;
             }
         }

        return output;
    }
} 