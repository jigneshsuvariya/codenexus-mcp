# Codebase Knowledge Graph MCP Server

This server provides a Model Context Protocol (MCP) interface specifically designed to interact with a **knowledge graph representing a software codebase**. It allows storing and retrieving rich, structured information about code entities (classes, functions, files, etc.), their relationships (calls, imports, implements, etc.), and associated qualitative observations (such as design decisions, pattern usage, change rationale, comments, and more).

The goal is to build a comprehensive, queryable representation of the codebase that goes beyond static analysis, capturing architectural insights and development context.

## Server Components

- `server.js`: The main Node.js script that runs the MCP server.
- `server.ts`: The main TypeScript script that compiles to `dist/server.js` (which then runs as the MCP server).
- `memory.json`: The default file used to persist the knowledge graph data.

## Setup and Configuration

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Run the Server:**
    ```bash
    npm run build # To compile TypeScript to JavaScript in dist/
    node dist/server.js
    ```
    The server will listen for MCP requests on standard input/output.

3.  **Persistence Configuration:**
    -   The knowledge graph is persisted in a file named `memory.json` by default. When running the compiled `dist/server.js`, this file will be created in/read from the `dist` directory. If running `src/server.ts` directly (e.g., with `ts-node`), it will be relative to the `src` directory.
    -   The file uses the **JSON Lines (JSONL)** format, where each line is a separate JSON object representing either an entity or a relation.
    -   You can specify a custom path for the persistence file by setting the `MEMORY_FILE_PATH` environment variable before running the server:
      ```bash
      # Example using a custom path (Linux/macOS)
      export MEMORY_FILE_PATH=/path/to/your/custom-graph.jsonl
      node dist/server.js

      # Example using a custom path (Windows PowerShell)
      $env:MEMORY_FILE_PATH = "C:\path\to\your\custom-graph.jsonl"
      node dist/server.js
      ```

## Knowledge Graph Schema

The graph stored and managed by this server consists of three primary components: Entities, Relations, and Observations. Entities represent the core elements (code constructs, project), Relations define connections between them, and Observations attach qualitative information or metadata.

The detailed structure of these components, as implemented in `src/server.ts`, is as follows:

### `Entity`

Represents a distinct element within the codebase or project.

-   `name` (string, required): Unique identifier for the entity.
-   `entityType` (string, required): The type of the entity (e.g., 'class', 'function', 'file', 'project').
-   `observations` (string[], required): An array of plain string observations associated with this entity.

### `Relation`

Represents a directed relationship between two Entities.

-   `from` (string, required): Name of the source entity.
-   `to` (string, required): Name of the target entity.
-   `relationType` (string, required): Type of relationship (e.g., 'CALLS', 'IMPLEMENTS', 'REFERENCES').

### `Observation`

Represents a piece of qualitative information or metadata attached to an Entity.

-   `entityName` (string, required): Name of entity.
-   `contents`(string[], required): observations about entity

## API Tools Reference

The server exposes the following tools via the Model Context Protocol (MCP). The input for each tool corresponds to the `arguments` field within an MCP `CallToolRequest`.

### `create_entities`

-   **Purpose:** Creates one or more new entities in the knowledge graph, adhering to the simplified `Entity` schema (name, entityType, array of string observations) defined in `src/server.ts`. If an entity with the same `name` already exists, the `KnowledgeGraphManager` will not create a duplicate.
-   **Arguments:** (Matches the `inputSchema` in `src/server.ts`)
    ```json
    {
      "entities": [
        {
          "name": "string",
          "entityType": "string",
          "observations": ["string", "another observation"]
        }
        // ... more entities
      ]
    }
    ```
-   **Output:** Returns a JSON string representation of the array of entities that were newly created. (Existing entities with the same name are not re-created or returned here). Example: `[{"name":"NewEntity","entityType":"Type","observations":["obs1"]}]`

### `create_relations`

-   **Purpose:** Creates one or more new relations (each defined by `from`, `to`, `relationType`) between existing entities. The `KnowledgeGraphManager` ignores attempts to create relations that are exact duplicates of existing ones.
-   **Arguments:** (Matches the `inputSchema` in `src/server.ts`)
    ```json
    {
      "relations": [
        {
          "from": "entityName1",
          "to": "entityName2",
          "relationType": "RELATES_TO"
        }
        // ... more relations
      ]
    }
    ```
-   **Output:** Returns a JSON string representation of the array of relations that were newly created. Example: `[{"from":"EntityA","to":"EntityB","relationType":"CALLS"}]`

### `add_observations`

-   **Purpose:** Adds new string observations to the `observations` array of existing entities. The tool will fail if the target entity does not exist. It only adds observation strings that are not already present in the entity's `observations` array to avoid duplicates.
-   **Arguments:** (Matches the `inputSchema` in `src/server.ts`)
    ```json
    {
      "observations": [ // Note: argument name is "observations"
        {
          "entityName": "string",
          "contents": ["string observation 1", "string observation 2"] // Note: field name is "contents"
        }
        // ... more entities to add observations to
      ]
    }
    ```
-   **Output:** Returns a JSON string representation of an array, where each element indicates the entity and the specific string observations that were successfully added to it. Example: `[{"entityName":"MyEntity","addedObservations":["new observation string"]}]`

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

-   **Purpose:** Removes specific string observations from an entity's `observations` array. It matches based on the exact string content.
-   **Arguments:** (Matches the `inputSchema` in `src/server.ts`)
    ```json
    {
      "deletions": [
        {
          "entityName": "string",
          "observations": ["string content to delete", "another string to delete"] // Note: field name is "observations"
        }
        // ... more entities to delete observations from
      ]
    }
    ```
-   **Output:** Returns a confirmation message like: `"Observations deleted successfully"`.

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

-   **Purpose:** Searches entities based on a query string. The current implementation in `src/server.ts` performs a case-insensitive search that checks the entity's `name`, `entityType`, and the content of its string `observations`. It does not search metadata fields, as these are not part of the core `Entity` structure.
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

Here are examples showing the `arguments` part of an MCP `CallToolRequest` for common operations, updated to reflect the `src/server.ts` implementation:

### 1. Creating a Project Entity

Use `create_entities`. Project-specific details are stored as strings in the `observations` array.

```json
{
  "entities": [
    {
      "name": "my-awesome-library",
      "entityType": "project",
      "observations": [
        "description: A library for doing awesome things.",
        "technology: TypeScript",
        "technology: Node.js",
        "architectureStyle: Monolith",
        "repositoryUrl: https://github.com/user/my-awesome-library"
      ]
    }
  ]
}
```

### 2. Creating a Function Entity

Use `create_entities`. Function-specific details are stored as strings in the `observations` array.

```json
{
  "entities": [
    {
        "name": "calculateTotalAmount(items)",
        "entityType": "function",
        "observations": [
          "language: javascript",
          "filePath: src/utils/calculations.js",
          "startLine: 25",
          "endLine: 40",
          "signature: (items: Item[]): number",
          "summary: Calculates the total amount based on a list of items.",
          "accessModifier: public",
          "isAsync: false",
          "tag: core-logic",
          "tag: billing"
        ]
    }
  ]
}
```

### 3. Adding String Observations

Use the `add_observations` tool. Remember the argument is `observations` (an array of objects), and each object has `entityName` and `contents` (an array of strings to add).

```json
{
  "observations": [
    {
      "entityName": "MyCoreClass",
      "contents": [
        "Design Decision: Use Strategy pattern for output formats. Rationale: Flexibility. Alternatives: Factory Method, if/else. By: Bob. Ref: PROJ-123. (Source: architect_meeting_notes_2023-10-27, Alice, 2023-10-27T10:00:00Z)",
        "Another observation for MyCoreClass"
      ]
    }
  ]
}
```

### 4. Creating a Relation

Use `create_relations` to link two existing entities. The relation structure is simple (`from`, `to`, `relationType`).

```json
{
  "relations": [
    {
        "from": "OrderProcessor.process()", 
        "to": "calculateTotalAmount(items)", 
        "relationType": "CALLS"
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
