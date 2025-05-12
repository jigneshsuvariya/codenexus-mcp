import { v4 as uuidv4 } from 'uuid';
import type { IGraphManager, IFileHandler, IGraphHandler } from './interfaces.js';
import type { Entity, Relation, Observation, Metadata } from './types.js';

export class GraphManager implements IGraphManager {
  private fileHandler: IFileHandler;
  private graphHandler: IGraphHandler;
  private isLoaded: boolean = false;

  constructor(fileHandler: IFileHandler, graphHandler: IGraphHandler) {
    this.fileHandler = fileHandler;
    this.graphHandler = graphHandler;
    // console.log('[GraphManager] Initialized.');
  }

  private createMetadata(): Metadata {
    const now = new Date().toISOString();
    return {
      createdAt: now,
      updatedAt: now,
      version: '1', // Simple versioning for now
    };
  }

  private updateMetadata(existingMetadata: Metadata): Metadata {
    return {
      ...existingMetadata,
      updatedAt: new Date().toISOString(),
      version: (parseInt(existingMetadata.version, 10) + 1).toString(),
    };
  }

  async loadGraphFromStore(): Promise<void> {
    // console.log('[GraphManager] Loading graph from store...');
    const lines = await this.fileHandler.loadData();
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    lines.forEach(line => {
      try {
        const item = JSON.parse(line);
        // Basic type inference, could be more robust (e.g. based on a 'type' field in the JSON)
        if (item.from && item.to && item.relationType) {
          relations.push(item as Relation);
        } else if (item.name && item.entityType) {
          entities.push(item as Entity);
        }
      } catch (error) {
        // console.warn(`[GraphManager] Error parsing line during load: ${line.substring(0,100)}...`, error);
      }
    });

    this.graphHandler.initializeGraph(entities, relations);
    this.isLoaded = true;
    // console.log('[GraphManager] Graph loaded into memory.');
  }

  async saveGraphToStore(): Promise<void> {
    if (!this.isLoaded) {
        // console.warn('[GraphManager] Graph not loaded, skipping save.');
        return;
    }
    // console.log('[GraphManager] Saving graph to store...');
    const { entities, relations } = this.graphHandler.exportGraphNodesAndEdges();
    const lines: string[] = [];
    entities.forEach(e => lines.push(JSON.stringify(e)));
    relations.forEach(r => lines.push(JSON.stringify(r)));
    
    await this.fileHandler.saveData(lines);
    // console.log('[GraphManager] Graph saved to store.');
  }

  async createEntities(entityDataArray: Array<Omit<Entity, 'id' | 'metadata'>>): Promise<Entity[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const createdEntities: Entity[] = [];
    for (const entityData of entityDataArray) {
      const metadata = this.createMetadata();
      const newEntity: Entity = {
        ...entityData,
        id: uuidv4(),
        metadata,
        observations: entityData.observations || [], // Ensure observations array exists
      };
      this.graphHandler.addEntityNode(newEntity);
      createdEntities.push(newEntity);
    }
    await this.saveGraphToStore();
    return createdEntities.map(e => ({...e})); // Return copies
  }

  async createRelations(relationDataArray: Array<Omit<Relation, 'id' | 'metadata'>>): Promise<Relation[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const createdRelations: Relation[] = [];
    for (const relationData of relationDataArray) {
      // Basic validation: ensure from/to entities exist? For now, GraphHandler might not enforce this.
      // Advanced: Check if this.graphHandler.getEntityNodeById(relationData.from) exists.
      const metadata = this.createMetadata();
      const newRelation: Relation = {
        ...relationData,
        id: uuidv4(),
        metadata,
      };
      this.graphHandler.addRelationEdge(newRelation);
      createdRelations.push(newRelation);
    }
    await this.saveGraphToStore();
    return createdRelations.map(r => ({...r})); // Return copies
  }

  async addObservations(entityId: string, observationsData: Array<Omit<Observation, 'id' | 'metadata'>>): Promise<Entity | null> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const entity = this.graphHandler.getEntityNodeById(entityId);
    if (!entity) {
      // console.warn(`[GraphManager] addObservations: Entity with ID ${entityId} not found.`);
      return null;
    }

    const newObservations: Observation[] = observationsData.map(obsData => ({
      ...obsData,
      id: uuidv4(),
      metadata: this.createMetadata(),
      entityName: entity.name, // Or entityId, depending on desired semantics
    }));

    const updatedEntity = this.graphHandler.addObservationsToEntityNode(entityId, newObservations);
    if (updatedEntity) {
        // Update the main entity's metadata as well
        const finalUpdatedEntity = this.graphHandler.updateEntityNodeAttributes(entityId, {
            metadata: this.updateMetadata(updatedEntity.metadata)
        });
        await this.saveGraphToStore();
        return finalUpdatedEntity ? {...finalUpdatedEntity} : null; // Return copy
    }
    return null;
  }

  async deleteEntities(entityIds: string[]): Promise<string[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const deletedIds: string[] = [];
    for (const id of entityIds) {
      if (this.graphHandler.deleteEntityNode(id)) {
        deletedIds.push(id);
      }
    }
    if (deletedIds.length > 0) {
      await this.saveGraphToStore();
    }
    return deletedIds;
  }

  async deleteObservations(entityId: string, observationIds: string[]): Promise<Entity | null> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const entity = this.graphHandler.getEntityNodeById(entityId);
    if (!entity) {
      // console.warn(`[GraphManager] deleteObservations: Entity with ID ${entityId} not found.`);
      return null;
    }
    const updatedEntity = this.graphHandler.deleteObservationsFromEntityNode(entityId, observationIds);
    if (updatedEntity) {
        // Check if observations actually changed to decide if metadata update + save is needed
        // This simplistic check might not be perfect if observationIds contained non-existent IDs
        const originalObservationCount = entity.observations?.length || 0;
        const newObservationCount = updatedEntity.observations?.length || 0;

        if (originalObservationCount !== newObservationCount) {
            const finalUpdatedEntity = this.graphHandler.updateEntityNodeAttributes(entityId, {
                metadata: this.updateMetadata(updatedEntity.metadata)
            });
            await this.saveGraphToStore();
            return finalUpdatedEntity ? {...finalUpdatedEntity} : null;
        }
        return {...updatedEntity}; // No change in observation count, return current state copy
    }
    return null;
  }

  async deleteRelations(relationIds: string[]): Promise<string[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const deletedIds: string[] = [];
    for (const id of relationIds) {
      if (this.graphHandler.deleteRelationEdge(id)) {
        deletedIds.push(id);
      }
    }
    if (deletedIds.length > 0) {
      await this.saveGraphToStore();
    }
    return deletedIds;
  }

  async searchNodes(query: string): Promise<Entity[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    return this.graphHandler.searchNodesInGraph(query); // GraphHandler returns copies
  }

  async getEntitiesByIds(entityIds: string[]): Promise<Entity[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const foundEntities: Entity[] = [];
    for (const id of entityIds) {
      const entity = this.graphHandler.getEntityNodeById(id);
      if (entity) {
        foundEntities.push(entity); // GraphHandler returns copies
      }
    }
    return foundEntities;
  }

  async getRelationsByIds(relationIds: string[]): Promise<Relation[]> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const foundRelations: Relation[] = [];
    for (const id of relationIds) {
      const relation = this.graphHandler.getRelationEdgeById(id);
      if (relation) {
        foundRelations.push(relation); // GraphHandler returns copies
      }
    }
    return foundRelations;
  }

  async updateEntity(entityId: string, updates: Partial<Omit<Entity, 'id' | 'metadata' | 'observations'>>): Promise<Entity | null> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const existingEntity = this.graphHandler.getEntityNodeById(entityId);
    if (!existingEntity) return null;

    const updatedAttributes: Partial<Omit<Entity, 'id' | 'observations'>> = {
        ...updates,
        metadata: this.updateMetadata(existingEntity.metadata),
    };

    const updatedEntity = this.graphHandler.updateEntityNodeAttributes(entityId, updatedAttributes);
    if (updatedEntity) {
        await this.saveGraphToStore();
        return {...updatedEntity}; // Return copy
    }
    return null;
  }

  async updateRelation(relationId: string, updates: Partial<Omit<Relation, 'id' | 'metadata'>>): Promise<Relation | null> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    const existingRelation = this.graphHandler.getRelationEdgeById(relationId);
    if (!existingRelation) return null;

    const updatedAttributes: Partial<Omit<Relation, 'id'>> = {
        ...(updates as Partial<Omit<Relation, 'id' | 'metadata'>>), // Cast to satisfy Omit
        metadata: this.updateMetadata(existingRelation.metadata),
    };

    const updatedRelation = this.graphHandler.updateRelationEdgeAttributes(relationId, updatedAttributes);
    if (updatedRelation) {
        await this.saveGraphToStore();
        return {...updatedRelation}; // Return copy
    }
    return null;
  }

  async getNeighborhood(startNodeId: string, maxDepth: number, direction: 'outbound' | 'inbound' | 'all'): Promise<{ entities: Entity[], relations: Relation[] } | null> {
    if (!this.isLoaded) await this.loadGraphFromStore();
    
    const result = this.graphHandler.getNeighborhood(startNodeId, maxDepth, direction);
    
    if (result) {
      // GraphHandler methods already return copies, so no need to map here if that holds true
      return result;
    }
    return null;
  }
} 