# Codebase Knowledge Graph MCP Server

This server provides a Model Context Protocol (MCP) interface specifically designed to interact with a **knowledge graph representing a software codebase**. It allows storing and retrieving rich, structured information about code entities (classes, functions, files, etc.), their relationships (calls, imports, implements, etc.), and associated qualitative observations (such as design decisions, pattern usage, change rationale, comments, and more).

The goal is to build a comprehensive, queryable representation of the codebase that goes beyond static analysis, capturing architectural insights and development context.

## Server Components

- `server.js`: The main Node.js script that runs the MCP server.
- `memory.json`: The default file used to persist the knowledge graph data.

## Setup and Configuration

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Run the Server:**
    ```bash
    node server.js
    ```
    The server will listen for MCP requests on standard input/output.

3.  **Persistence Configuration:**
    -   The knowledge graph is persisted in a file named `memory.json` by default, located in the same directory as `server.js`.
    -   The file uses the **JSON Lines (JSONL)** format, where each line is a separate JSON object representing either an entity or a relation.
    -   You can specify a custom path for the persistence file by setting the `MEMORY_FILE_PATH` environment variable before running the server:
      ```bash
      # Example using a custom path (Linux/macOS)
      export MEMORY_FILE_PATH=/path/to/your/custom-graph.jsonl
      node server.js

      # Example using a custom path (Windows PowerShell)
      $env:MEMORY_FILE_PATH = "C:\path\to\your\custom-graph.jsonl"
      node server.js
      ```

## Knowledge Graph Schema

The graph stored and managed by this server consists of three primary components: Entities, Relations, and Observations. Entities represent the core elements (code constructs, project), Relations define connections between them, and Observations attach qualitative information or metadata.

The detailed structure of these components, as defined in `server.js`, is as follows:

### `Entity`

Represents a distinct element within the codebase or project.

-   `name` (string, required): Unique identifier (e.g., function name, class name, file path).
-   `entityType` (string, required): Type of entity (e.g., 'class', 'function', 'module', 'variable', 'file', 'project').
-   `language` (string, optional): Programming language (e.g., 'javascript', 'python').
-   `filePath` (string, optional): Relative path to the file containing the entity.
-   `startLine` (number, optional): Starting line number (1-indexed).
-   `endLine` (number, optional): Ending line number (1-indexed).
-   `signature` (string, optional): For functions/methods: parameter list, return type.
-   `summary` (string, optional): Brief description (e.g., from docstring).
-   `accessModifier` ('public' | 'private' | 'protected', optional): Language-specific access control.
-   `isStatic` (boolean, optional): Language-specific static indicator.
-   `isAsync` (boolean, optional): Language-specific async indicator.
-   `namespace` (string, optional): Module or namespace.
-   `tags` (string[], optional): User-defined tags for categorization.
-   `observations` (Observation[], required): Array of Observation objects associated with this entity (initialized as empty array if not provided).
-   `metadata` (Record<string, any>, optional): Other custom or tool-specific data.

### `ProjectEntity`

A specific type of `Entity` (`entityType: 'project'`) used to store high-level information about the project itself.

-   `name` (string, required): Unique name/identifier for the project (e.g., 'my-web-app').
-   `entityType` ('project', required): Must be 'project'.
-   `description` (string, optional): High-level description of the project.
-   `technologies` (string[], optional): List of key technologies used (e.g., ['React', 'Node.js', 'PostgreSQL']).
-   `architectureStyle` (string, optional): Overall architecture (e.g., 'Microservices', 'Monolith', 'Serverless').
-   `repositoryUrl` (string, optional): URL of the code repository.
-   `observations` (Observation[], required): Relevant observations for the project itself (e.g., high-level design decisions, roadmap links).
-   `metadata` (Record<string, any>, optional): Other custom project-specific data.

### `Relation`

Represents a directed relationship between two Entities.

-   `from` (string, required): Name of the source entity.
-   `to` (string, required): Name of the target entity.
-   `relationType` (string, required): Type of relationship (e.g., 'CALLS', 'IMPLEMENTS', 'IMPORTS', 'CONTAINS').
-   `filePath` (string, optional): File where the relation occurs/is defined.
-   `line` (number, optional): Line number where the relation occurs (1-indexed).
-   `contextSnippet` (string, optional): Small code snippet illustrating the relation.
-   `metadata` (Record<string, any>, optional): Other custom or tool-specific data.

### `Observation`

Represents a piece of qualitative information or metadata attached to an Entity.

-   `id` (string, required): Unique ID for the observation (automatically generated UUID if not provided).
-   `observationType` (string, required): Type of observation. Standard types include:
    -   `'design_pattern_use'`: Describes the use of a design pattern. Recommended `metadata`: `{ patternName: string, role?: string }`.
    -   `'design_decision'`: Documents a specific design choice. Recommended `metadata`: `{ rationale?: string, alternativesConsidered?: string[], decisionMaker?: string, relatedIssue?: string }`.
    -   `'change_rationale'`: Explains the reason for a code change. Recommended `metadata`: `{ commitHash?: string, author?: string, relatedIssue?: string, summaryOfChange?: string }`.
    -   `'project_meta'`: Stores project-level metadata (usually attached to a 'Project' entity). Recommended `metadata` depends on the specific info (e.g., `{ repositoryUrl: string, primaryTechnology: string }`).
    -   Other common types: `'comment'`, `'todo'`, `'fixme'`, `'security_note'`, `'performance_note'`.
-   `content` (string, required): The main text/content of the observation.
-   `filePath` (string, optional): File relevant to the observation.
-   `line` (number, optional): Line number relevant to the observation (1-indexed).
-   `severity` ('high' | 'medium' | 'low' | 'info', optional): Severity level.
-   `source` (string, optional): Origin (e.g., 'static_analysis', 'human_annotator', 'llm', 'code_comment').
-   `timestamp` (string, optional): ISO 8601 timestamp (e.g., `new Date().toISOString()`).
-   `author` (string, optional): Who/what created the observation.
-   `relatedEntities` (string[], optional): Names of other related entities.
-   `metadata` (Record<string, any>, optional): Other custom data. See recommended fields under `observationType` for standard types.

## API Tools Reference

The server exposes the following tools via the Model Context Protocol (MCP). The input for each tool corresponds to the `arguments` field within an MCP `CallToolRequest`.

### `create_entities`

-   **Purpose:** Creates one or more new entities in the knowledge graph. If an entity with the same `name` already exists, it is ignored.
-   **Arguments:**
    ```json
    {
      "entities": [ ]
    }
    ```
-   **Output:** Returns a JSON string representation of the array of entities that were successfully created.

### `create_relations`

-   **Purpose:** Creates one or more new relations between existing entities. Duplicate relations are ignored.
-   **Arguments:**
    ```json
    {
      "relations": [ ]
    }
    ```
-   **Output:** Returns a JSON string representation of the array of relations that were successfully created.

### `add_observations`

-   **Purpose:** Adds observations to existing entities. Fails if the target entity doesn't exist. Assigns unique IDs if missing. Ignores observations with duplicate IDs for the same entity.
-   **Arguments:**
    ```json
    {
      "observationsInput": [
        {
          "entityName": "string", 
          "observationsToAdd": [ ]
        }
      ]
    }
    ```
-   **Output:** Returns a JSON string representation of results, showing added observations per entity.

### `delete_entities`

-   **Purpose:** Removes entities and connected relations.
-   **Arguments:**
    ```json
    {
      "entityNames": [ "string" ]
    }
    ```
-   **Output:** Confirmation message.

### `delete_observations`

-   **Purpose:** Removes specific observations by ID from entities.
-   **Arguments:**
    ```json
    {
      "deletions": [
        {
          "entityName": "string",
          "observationIds": [ "string"]
        }

      ]
    }
    ```
-   **Output:** Confirmation message.

### `delete_relations`

-   **Purpose:** Removes specific relations.
-   **Arguments:**
    ```json
    {
      "relations": [ 
        { "from": "string", "to": "string", "relationType": "string" }, 
       ]
    }
    ```
-   **Output:** Confirmation message.

### `read_graph`

-   **Purpose:** Retrieves the entire graph.
-   **Arguments:** None (or `{}`).
-   **Output:** JSON string of the graph: `{ "entities": [...], "relations": [...] }`.

### `search_nodes`

-   **Purpose:** Searches entities based on a query string (checks names, types, observations, metadata, etc.).
-   **Arguments:**
    ```json
    {
      "query": "string"
    }
    ```
-   **Output:** JSON string of the filtered graph (matching entities and relations between them).

### `open_nodes`

-   **Purpose:** Retrieves specific entities by name and relations between them.
-   **Arguments:**
    ```json
    {
      "names": [ "string"]
    }
    ```
-   **Output:** JSON string of the filtered graph (requested entities and relations between them).

## Usage Examples

Here are examples showing the `arguments` part of an MCP `CallToolRequest` for common operations:

### 1. Creating a Project Entity

Use `create_entities` with `entityType: 'project'`:

```json
{
  "entities": [
    {
      "name": "my-awesome-library",
      "entityType": "project",
      "description": "A library for doing awesome things.",
      "technologies": ["TypeScript", "Node.js"],
      "architectureStyle": "Monolith",
      "repositoryUrl": "https://github.com/user/my-awesome-library",
      "observations": [] 
    }
  ]
}
```

### 2. Creating a Function Entity

Use `create_entities` with `entityType: 'function'`:

```json
{
  "entities": [
    {
        "name": "calculateTotalAmount(items)",
        "entityType": "function",
        "language": "javascript",
        "filePath": "src/utils/calculations.js",
        "startLine": 25,
        "endLine": 40,
        "signature": "(items: Item[]): number",
        "summary": "Calculates the total amount based on a list of items.",
        "accessModifier": "public",
        "isAsync": false,
        "observations": [],
        "tags": ["core-logic", "billing"]
    }
  ]
}
```

### 3. Adding a Design Decision Observation

Use `add_observations`. Note the structure: `observationsInput` is an array, containing objects for each entity being updated. Each object specifies `entityName` and an `observationsToAdd` array.

```json
{
  "observationsInput": [
    {
      "entityName": "MyCoreClass", 
      "observationsToAdd": [
        {
          "observationType": "design_decision",
          "content": "Decided to use Strategy pattern for handling different output formats.",
          "source": "architect_meeting_notes_2023-10-27",
          "author": "Alice",
          "timestamp": "2023-10-27T10:00:00Z",
          "metadata": {
            "rationale": "Provides flexibility to add new formats without modifying the core class.",
            "alternativesConsidered": ["Factory Method", "Simple if/else"],
            "decisionMaker": "Bob",
            "relatedIssue": "PROJ-123"
          }
        }
      ]
    }
  ]
}
```

### 4. Adding a Design Pattern Usage Observation

Use `add_observations`:

```json
{
  "observationsInput": [
    {
      "entityName": "ConfigurationManager", 
      "observationsToAdd": [
        {
          "observationType": "design_pattern_use",
          "content": "Implemented as a Singleton to ensure single point of access to configuration.",
          "source": "code_review_comment_456",
          "author": "Charlie",
          "metadata": {
            "patternName": "Singleton",
            "role": "unique_instance"
          }
        }
      ]
    }
  ]
}
```

### 5. Adding a Change Rationale Observation

Use `add_observations`:

```json
{
  "observationsInput": [
    {
      "entityName": "calculateTotalAmount(items)", 
      "observationsToAdd": [
        {
          "observationType": "change_rationale",
          "content": "Refactored calculation logic for improved performance.",
          "source": "git_commit_a1b2c3d4", 
          "author": "David",
          "timestamp": "2023-10-26T15:30:00Z",
          "metadata": {
            "commitHash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            "relatedIssue": "PERF-45",
            "summaryOfChange": "Replaced loop with vectorized operation."
          }
        }
      ]
    }
  ]
}
```

### 6. Creating a Relation

Use `create_relations` to link two existing entities (e.g., `OrderProcessor` calls `calculateTotalAmount`):

```json
{
  "relations": [
    {
        "from": "OrderProcessor.process()", 
        "to": "calculateTotalAmount(items)", 
        "relationType": "CALLS",
        "filePath": "src/services/OrderProcessor.js",
        "line": 88
    }
  ]
}
```

## Usage with NPX / Client Integration

### NPX

This command downloads and runs the latest version of the server:

```json
{
  "mcpServers": {
    "codenexus-knowledge-graph": { 
      "command": "npx",
      "args": [
        "-y",
        "codenexus-mcp" 
      ]
    }
  }
}
```

_(Note: VS Code uses a slightly different structure in `settings.json` or `.vscode/mcp.json`)_

```json

"mcp": {
  "servers": {
    "codenexus-knowledge-graph": { 
      "command": "npx",
      "args": [
        "-y",
        "codenexus-mcp" 
      ]
    }
  }
}
```

### NPX with custom setting

The server can be configured using the `MEMORY_FILE_PATH` environment variable to specify a custom location for the knowledge graph data file.

```json
{
  "mcpServers": {
    "codenexus-knowledge-graph": { 
      "command": "npx",
      "args": [
        "-y",
        "codenexus-mcp"
      ],
      "env": {
        "MEMORY_FILE_PATH": "/path/to/your/custom-graph.jsonl"
      }
    }
  }
}
```

_(Note: Example for VS Code settings.json below)_

```json

"mcp": {
  "servers": {
    "codenexus-knowledge-graph": { 
      "command": "npx",
      "args": [
        "-y",
        "codenexus-mcp"
      ],
      "env": {
        "MEMORY_FILE_PATH": "/path/to/your/custom-graph.jsonl"
      }
    }
  }
}
```

## License

This project is currently unlicensed. Please add appropriate license information here (e.g., MIT License) and include a `LICENSE` file if applicable.
