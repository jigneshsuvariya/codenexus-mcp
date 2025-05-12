export interface Metadata {
  createdAt: string; // ISO 8601 date string
  updatedAt: string; // ISO 8601 date string
  version: string;
}

export interface ObservationBase {
  description: string;
  attributes: Record<string, any>;
  metadata: Metadata;
  source: string;
  confidenceScore: number;
  tags: string[];
  state: string;
}

export interface Observation extends ObservationBase {
  id: string;
  entityName: string;
  contents: string;
}

export interface Entity extends ObservationBase {
  id: string;
  name: string;
  entityType: string;
  observations: Observation[];
}

export interface Relation extends ObservationBase {
  id: string;
  from: string;
  to: string;
  relationType: string;
  undirected?: boolean; // Optional: For mixed graphs, indicates if the edge is undirected
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
} 