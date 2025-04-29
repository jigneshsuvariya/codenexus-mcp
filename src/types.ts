/**
 * Represents a single observation or piece of metadata associated with an entity.
 */
export interface Observation {
  id?: string; // Optional: Will be generated if missing during addObservations
  observationType: string; // E.g., 'comment', 'todo', 'design_decision', 'change_rationale'
  content: string;
  filePath?: string;
  line?: number; // 1-indexed
  severity?: 'high' | 'medium' | 'low' | 'info';
  source?: string; // E.g., 'static_analysis', 'human_annotator', 'llm'
  timestamp?: string; // ISO 8601 format
  author?: string;
  relatedEntities?: string[]; // Names/IDs of related entities
  metadata?: Record<string, any>; // Flexible key-value pairs
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
  observations?: Observation[]; // Project-level observations
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
  observations: Observation[]; // Changed from optional to required array based on usage
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
 * Represents the entire knowledge graph structure.
 */
export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

/**
 * Input structure for the addObservations method.
 */
export interface AddObservationInput {
  entityName: string;
  observationsToAdd: Partial<Observation>[]; // Allow partial observations as input
}

/**
 * Result structure for the addObservations method.
 */
export interface AddObservationResult {
  entityName: string;
  addedObservations: Observation[];
}

/**
 * Input structure for the deleteObservations method.
 */
export interface DeleteObservationInput {
  entityName: string;
  observationIds: string[];
} 