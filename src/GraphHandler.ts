import Graphology, { type MultiGraph } from 'graphology'; // Default for namespace, named for type
// import type { Graph as Graph_Type } from 'graphology-types'; // Named import for the Graph type - REMOVE THIS
// We use IGraphHandler which uses GraphType from graphology-types for return types - THIS IS NOW Graph from graphology
import type { IGraphHandler } from './interfaces.js';
import type { Entity, Relation, Observation, Metadata } from './types.js';
// TODO: Replace 'any' with 'Graph' from 'graphology' in IGraphHandler and here when installed.
// import type Graph from 'graphology'; 

export class GraphHandler implements IGraphHandler {
  private actualGraphInstance: MultiGraph | null = null; // Use the imported MultiGraph type

  constructor() {
    // console.log('[GraphHandler] Initialized.');
    this.actualGraphInstance = new Graphology.MultiGraph({ allowSelfLoops: true, multi: true, type: 'mixed' }); // Construct using the namespace and ensure it's a multi graph
  }

  initializeGraph(entities: Entity[], relations: Relation[]): void {
    if (!this.actualGraphInstance) {
      this.actualGraphInstance = new Graphology.MultiGraph({ allowSelfLoops: true, multi: true, type: 'mixed' });
    } else {
      this.actualGraphInstance.clear();
    }

    entities.forEach(entity => {
      this.actualGraphInstance!.addNode(entity.id, { ...entity });
    });

    relations.forEach(relation => {
      if (relation.undirected) {
        this.actualGraphInstance!.addUndirectedEdgeWithKey(relation.id, relation.from, relation.to, { ...relation });
      } else {
        this.actualGraphInstance!.addDirectedEdgeWithKey(relation.id, relation.from, relation.to, { ...relation });
      }
    });
    // console.log(`[GraphHandler] Graph initialized with ${this.actualGraphInstance.order} nodes and ${this.actualGraphInstance.size} edges.`);
  }

  exportGraphNodesAndEdges(): { entities: Entity[]; relations: Relation[] } {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    if (this.actualGraphInstance) {
      this.actualGraphInstance.forEachNode((_nodeKey, attributes) => {
        entities.push({ ...(attributes as Entity) });
      });

      this.actualGraphInstance.forEachEdge((_edgeKey, attributes, _source, _target, _sourceAttributes, _targetAttributes, undirectedEdgeFlag) => {
        const relationObject = { ...(attributes as Relation) };
        if (this.actualGraphInstance!.type === 'mixed') {
          relationObject.undirected = undirectedEdgeFlag;
        }
        relations.push(relationObject);
      });
    }
    // console.log(`[GraphHandler] Exporting graph with ${entities.length} entities and ${relations.length} relations.`);
    return { entities, relations };
  }

  addEntityNode(entity: Entity): void {
    if (!this.actualGraphInstance) return;
    const { id } = entity;
    if (!this.actualGraphInstance.hasNode(id)) {
      this.actualGraphInstance.addNode(id, { ...entity });
    }
  }

  addRelationEdge(relation: Relation): void {
    if (!this.actualGraphInstance) return;
    if (!this.actualGraphInstance.hasEdge(relation.id)) {
         if (relation.undirected) {
            this.actualGraphInstance.addUndirectedEdgeWithKey(relation.id, relation.from, relation.to, { ...relation });
         } else {
            this.actualGraphInstance.addDirectedEdgeWithKey(relation.id, relation.from, relation.to, { ...relation });
         }
    }
  }

  getEntityNodeById(id: string): Entity | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(id)) {
      return undefined;
    }
    const attributes = this.actualGraphInstance.getNodeAttributes(id);
    return { ...(attributes as Entity) };
  }

  getRelationEdgeById(id: string): Relation | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasEdge(id)) {
      return undefined;
    }
    const attributes = this.actualGraphInstance.getEdgeAttributes(id);
    const relationObject = { ...(attributes as Relation) };
    if (this.actualGraphInstance.type === 'mixed' && this.actualGraphInstance.hasEdge(id)) {
        relationObject.undirected = this.actualGraphInstance.isUndirected(id);
    }
    return relationObject;
  }

  updateEntityNodeAttributes(entityId: string, attributesToUpdate: Partial<Omit<Entity, 'id' | 'observations'>>): Entity | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(entityId)) {
      return undefined;
    }
    
    const existingAttributes = this.actualGraphInstance.getNodeAttributes(entityId) as Entity;
    let newMetadata = existingAttributes.metadata;
    if (attributesToUpdate.metadata) {
        newMetadata = { ...existingAttributes.metadata, ...attributesToUpdate.metadata };
    }

    const finalAttributesToUpdate = {
        ...attributesToUpdate,
        metadata: newMetadata
    };
    
    for (const key in finalAttributesToUpdate) {
        if (key !== 'id' && key !== 'observations' && Object.prototype.hasOwnProperty.call(finalAttributesToUpdate, key)) {
            const K = key as keyof typeof finalAttributesToUpdate;
            this.actualGraphInstance.setNodeAttribute(entityId, K, finalAttributesToUpdate[K]);
        }
    }
    
    const updatedAttributes = this.actualGraphInstance.getNodeAttributes(entityId);
    return { ...(updatedAttributes as Entity) };
  }

  updateRelationEdgeAttributes(relationId: string, attributesToUpdate: Partial<Omit<Relation, 'id'>>): Relation | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasEdge(relationId)) {
      return undefined;
    }

    const existingAttributes = this.actualGraphInstance.getEdgeAttributes(relationId) as Relation;
    let newMetadata = existingAttributes.metadata;
    if (attributesToUpdate.metadata) {
        newMetadata = { ...existingAttributes.metadata, ...attributesToUpdate.metadata };
    }
    
    const finalAttributesToUpdate = {
        ...attributesToUpdate,
        metadata: newMetadata
    };

    for (const key in finalAttributesToUpdate) {
        if (key !== 'id' && Object.prototype.hasOwnProperty.call(finalAttributesToUpdate, key)) {
             const K = key as keyof typeof finalAttributesToUpdate;
            this.actualGraphInstance.setEdgeAttribute(relationId, K, finalAttributesToUpdate[K]);
        }
    }

    const updatedAttributes = this.actualGraphInstance.getEdgeAttributes(relationId);
    return { ...(updatedAttributes as Relation) };
  }

  deleteEntityNode(id: string): boolean {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(id)) {
      return false;
    }
    this.actualGraphInstance.dropNode(id); // dropNode returns void
    return true; // Assume success if no error and node existed
  }

  deleteRelationEdge(id: string): boolean {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasEdge(id)) {
      return false;
    }
    this.actualGraphInstance.dropEdge(id); // dropEdge returns void
    return true; // Assume success if no error and edge existed
  }

  addObservationsToEntityNode(entityId: string, newObservations: Observation[]): Entity | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(entityId)) {
        return undefined;
    }
    const currentEntity = this.actualGraphInstance.getNodeAttributes(entityId) as Entity;
    const updatedObservations = [...(currentEntity.observations || []), ...newObservations];
    this.actualGraphInstance.setNodeAttribute(entityId, 'observations', updatedObservations);
    
    const updatedMetadata: Metadata = {
        ...(currentEntity.metadata || { createdAt: new Date().toISOString(), version: "0" }), // Provide default if metadata is undefined
        updatedAt: new Date().toISOString(),
        version: ((parseInt(currentEntity.metadata?.version || "0", 10)) + 1).toString()
    };
    this.actualGraphInstance.setNodeAttribute(entityId, 'metadata', updatedMetadata);

    const updatedAttributes = this.actualGraphInstance.getNodeAttributes(entityId);
    return { ...(updatedAttributes as Entity) };
  }

  deleteObservationsFromEntityNode(entityId: string, observationIds: string[]): Entity | undefined {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(entityId)) {
        return undefined;
    }
    const currentEntity = this.actualGraphInstance.getNodeAttributes(entityId) as Entity;
    if (!currentEntity.observations || currentEntity.observations.length === 0) {
      return { ...currentEntity };
    }
    const obsIdsSet = new Set(observationIds);
    const updatedObservations = currentEntity.observations.filter(obs => !obsIdsSet.has(obs.id));
    
    if (updatedObservations.length !== currentEntity.observations.length) {
        this.actualGraphInstance.setNodeAttribute(entityId, 'observations', updatedObservations);
        const updatedMetadata: Metadata = {
            ...(currentEntity.metadata || { createdAt: new Date().toISOString(), version: "0" }),
            updatedAt: new Date().toISOString(),
            version: ((parseInt(currentEntity.metadata?.version || "0", 10)) + 1).toString()
        };
        this.actualGraphInstance.setNodeAttribute(entityId, 'metadata', updatedMetadata);
    }
    
    const updatedAttributes = this.actualGraphInstance.getNodeAttributes(entityId);
    return { ...(updatedAttributes as Entity) };
  }

  searchNodesInGraph(query: string): Entity[] {
    const results: Entity[] = [];
    if (!this.actualGraphInstance) return results;

    const lowerCaseQuery = query.toLowerCase().trim();
    if (!lowerCaseQuery) return this.getAllEntityNodes();

    this.actualGraphInstance.forEachNode((_nodeKey, attributes) => {
      const entity = attributes as Entity;
      if (
        entity.name?.toLowerCase().includes(lowerCaseQuery) ||
        entity.entityType?.toLowerCase().includes(lowerCaseQuery) ||
        entity.description?.toLowerCase().includes(lowerCaseQuery) ||
        (entity.tags && entity.tags.some(tag => tag.toLowerCase().includes(lowerCaseQuery))) ||
        (entity.observations && entity.observations.some(obs =>
            obs.contents?.toLowerCase().includes(lowerCaseQuery) ||
            obs.description?.toLowerCase().includes(lowerCaseQuery)
        ))
      ) {
        results.push({ ...entity });
      }
    });
    return results;
  }

  getAllEntityNodes(): Entity[] {
    const entities: Entity[] = [];
    if (this.actualGraphInstance) {
      this.actualGraphInstance.forEachNode((_nodeKey, attributes) => {
        entities.push({ ...(attributes as Entity) });
      });
    }
    return entities;
  }

  getAllRelationEdges(): Relation[] {
    const relations: Relation[] = [];
    if (this.actualGraphInstance) {
      this.actualGraphInstance.forEachEdge((_edgeKey, attributes, _source, _target, _sourceAttributes, _targetAttributes, undirected) => {
        const relationObject = { ...(attributes as Relation) };
        if (this.actualGraphInstance!.type === 'mixed') {
          relationObject.undirected = undirected;
        }
        relations.push(relationObject);
      });
    }
    return relations;
  }

  getGraphInstance(): MultiGraph | null { 
    return this.actualGraphInstance;
  }

  getNeighborhood(startNodeId: string, maxDepth: number, direction: 'outbound' | 'inbound' | 'all'): { entities: Entity[], relations: Relation[] } | null {
    if (!this.actualGraphInstance || !this.actualGraphInstance.hasNode(startNodeId)) {
      return null;
    }

    const graph = this.actualGraphInstance;
    const nodesInNeighborhood = new Set<string>();
    const edgesInNeighborhood = new Set<string>();
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Use graphology-traversal's bfsFromNode
    // Note: graphology-traversal bfs does not directly return edges or a subgraph easily.
    // We'll collect nodes and then induce the subgraph for edges.

    const queue: Array<{node: string, depth: number}> = [{node: startNodeId, depth: 0}];
    const visitedDepths: Map<string, number> = new Map();
    visitedDepths.set(startNodeId, 0);
    nodesInNeighborhood.add(startNodeId);

    let head = 0;
    while(head < queue.length) {
      const currentItem = queue[head++];
      if (!currentItem) continue; // Should not happen due to loop condition, but satisfies linter
      const {node, depth} = currentItem;

      if (depth >= maxDepth) continue;

      const neighborGetter = direction === 'inbound' ? graph.forEachInNeighbor.bind(graph) :
                             direction === 'outbound' ? graph.forEachOutNeighbor.bind(graph) :
                             graph.forEachNeighbor.bind(graph);
      
      neighborGetter(node, (neighbor: string) => {
        if (!visitedDepths.has(neighbor) || visitedDepths.get(neighbor)! > depth + 1) {
          visitedDepths.set(neighbor, depth + 1);
          nodesInNeighborhood.add(neighbor);
          queue.push({node: neighbor, depth: depth + 1});
        }
      });
    }

    // Collect entities
    nodesInNeighborhood.forEach(nodeId => {
      const attrs = graph.getNodeAttributes(nodeId);
      entities.push({ ...(attrs as Entity) });
    });

    // Collect edges within the neighborhood
    nodesInNeighborhood.forEach(nodeId => {
      graph.forEachEdge(nodeId, (edgeKey, edgeAttrs, source, target, _sa, _ta, undirected) => {
        if (nodesInNeighborhood.has(source) && nodesInNeighborhood.has(target) && !edgesInNeighborhood.has(edgeKey)) {
          const relationObject = { ...(edgeAttrs as Relation) };
          if (graph.type === 'mixed') {
            relationObject.undirected = undirected;
          }
          relations.push(relationObject);
          edgesInNeighborhood.add(edgeKey);
        }
      });
    });

    return { entities, relations };
  }
} 