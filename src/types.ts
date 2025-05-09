import { Attributes } from 'graphology-types';

/**
 * Represents a single observation or piece of metadata.
 * In the graph, this will likely be represented as a node with type 'observation'.
 */
export interface ObservationInput {
    // Input for creating an observation node
    id: string; // Unique ID for the observation node
    content: string;
    relatedEntityIds: string[]; // IDs of entities this observation relates to
    tags?: string[];
    attributes?: Record<string, any>; // Additional attributes beyond standard ones
}

/**
 * Represents attributes for a generic node in the graph.
 */
export interface NodeAttributes extends Attributes {
    type: string;       // e.g., 'file', 'class', 'function', 'observation', 'concept'
    name?: string;      // A human-readable name, ID is the primary identifier
    filePath?: string;
    startLine?: number;
    endLine?: number;
    content?: string;   // For code chunks or observation details
    tags?: string[];
    identifier?: string;
    // Other relevant attributes...
}

/**
 * Represents attributes for a generic edge in the graph.
 */
export interface EdgeAttributes extends Attributes {
    type: string;       // e.g., 'contains', 'calls', 'imports', 'relates_to'
    // Other relevant attributes...
}


/**
 * Represents the input structure for creating/updating an entity (node).
 */
export interface EntityInput {
    id: string;          // Unique ID for the node
    type: string;        // Type of the entity (e.g., 'class', 'function', 'file')
    attributes?: Partial<NodeAttributes>; // Attributes to set/merge (excluding id and type)
}

/**
 * Represents the input structure for creating a relation (edge).
 */
export interface RelationInput {
    id: string;          // Unique ID for the edge
    source: string;      // ID of the source node
    target: string;      // ID of the target node
    type: string;        // Type of the relation (e.g., 'calls', 'contains')
    attributes?: Partial<EdgeAttributes>; // Attributes to set/merge (excluding id, source, target, type)
}

/**
 * Represents the structure of the graph when exported/imported (compatible with graphology).
 * This replaces the old Entity[]/Relation[] based KnowledgeGraph interface.
 */
export interface GraphData {
    attributes?: Record<string, any>; // Graph-level attributes
    nodes: { key: string; attributes: NodeAttributes }[];
    edges?: { key: string; source: string; target: string; attributes: EdgeAttributes; undirected?: boolean }[];
    options?: {
        type: string; // e.g., 'mixed', 'directed', 'undirected'
        multi: boolean;
        allowSelfLoops: boolean;
    };
}

/**
 * Represents the overall project.
 * (Note: This type is defined but not explicitly used in the current KnowledgeGraphManager logic,
 * could be used for a top-level project entity in the future).
 */
export interface ProjectEntity {
  name: string; // Unique project identifier
  entityType: 'project';
  description?: string;
  technologies?: string[];
  architectureStyle?: string;
  repositoryUrl?: string;
  observations?: ObservationInput[]; // Project-level observations
  metadata?: Record<string, any>;
}

/**
 * Represents a code entity (class, function, module, file, etc.) within the knowledge graph.
 */
export interface Entity {
  type: 'entity'; // Added explicitly during save/load
  name: string; // Unique identifier (e.g., function name, class name, file path)
  entityType: string; // E.g., 'class', 'function', 'module', 'variable', 'file'
  language?: string;
  filePath?: string;
  startLine?: number; // 1-indexed
  endLine?: number; // 1-indexed
  signature?: string; // Function/method signature
  summary?: string; // Docstring summary
  accessModifier?: 'public' | 'private' | 'protected';
  isStatic?: boolean;
  isAsync?: boolean;
  namespace?: string;
  tags?: string[];
  observations: ObservationInput[]; // Changed from optional to required array based on usage
  metadata?: Record<string, any>;
}

/**
 * Represents a relationship between two entities.
 */
export interface Relation {
  type: 'relation'; // Added explicitly during save/load
  from: string; // Name of the source entity
  to: string; // Name of the target entity
  relationType: string; // E.g., 'CALLS', 'IMPLEMENTS', 'IMPORTS'
  filePath?: string;
  line?: number; // 1-indexed
  contextSnippet?: string;
  metadata?: Record<string, any>;
}

/**
 * Input structure for the addObservations method.
 */
export interface AddObservationInput {
  entityName: string;
  observationsToAdd: Partial<ObservationInput>[]; // Allow partial observations as input
}

/**
 * Result structure for the addObservations method.
 */
export interface AddObservationResult {
  entityName: string;
  addedObservations: ObservationInput[];
}

/**
 * Input structure for the deleteObservations method.
 */
export interface DeleteObservationInput {
  entityName: string;
  observationIds: string[];
}

// --- Deprecated / Old Types (kept for reference during transition, maybe remove later) ---

/** @deprecated Use ObservationInput or NodeAttributes with type='observation' */
export interface OldObservation {
  id?: string;
  observationType: string;
  content: string;
  filePath?: string;
  line?: number;
  severity?: 'high' | 'medium' | 'low' | 'info';
  source?: string;
  timestamp?: string;
  author?: string;
  relatedEntities?: string[];
  metadata?: Record<string, any>;
}

/** @deprecated Use EntityInput or NodeAttributes */
export interface OldEntity {
  type: 'entity';
  name: string;
  entityType: string;
  language?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  summary?: string;
  accessModifier?: 'public' | 'private' | 'protected';
  isStatic?: boolean;
  isAsync?: boolean;
  namespace?: string;
  tags?: string[];
  observations: OldObservation[];
  metadata?: Record<string, any>;
}

/** @deprecated Use RelationInput or EdgeAttributes */
export interface OldRelation {
  type: 'relation';
  from: string;
  to: string;
  relationType: string;
  filePath?: string;
  line?: number;
  contextSnippet?: string;
  metadata?: Record<string, any>;
}

/** @deprecated Use GraphData */
export interface OldKnowledgeGraph {
  entities: OldEntity[];
  relations: OldRelation[];
}

/** @deprecated Logic moved to createObservations tool / GraphologyManager */
export interface OldAddObservationInput {
  entityName: string;
  observationsToAdd: Partial<OldObservation>[];
}

/** @deprecated Logic moved to createObservations tool / GraphologyManager */
export interface OldAddObservationResult {
  entityName: string;
  addedObservations: OldObservation[];
}

/** @deprecated Logic handled by deleteEntities tool / GraphologyManager */
export interface OldDeleteObservationInput {
  entityName: string;
  observationIds: string[];
} 