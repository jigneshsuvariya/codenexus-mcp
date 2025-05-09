import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Import the class to be tested (from compiled JS)
import { GraphologyManager } from '../dist/graphologyManager.js';
// Import types just for reference in comments if needed, not for runtime
// import type { EntityInput, RelationInput, ObservationInput, NodeAttributes, EdgeAttributes } from '../src/types.js';
// import type { CodeChunk } from '../src/utils/codeSplitter.js';

describe('GraphologyManager', () => {
    let tempDir;
    let graphFilePath;
    let graphManager;

    // Setup temp directory for test graph file
    before(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graphology-manager-test-'));
        graphFilePath = path.join(tempDir, 'test_graph.json');
        console.log(`Test graph file path: ${graphFilePath}`);
    });

    // Clean up temp directory
    after(async () => {
        if (tempDir) {
            try {
                 await fs.rm(tempDir, { recursive: true, force: true });
                 console.log(`Cleaned up temp directory: ${tempDir}`);
            } catch (err) {
                 console.error(`Error cleaning up temp directory ${tempDir}:`, err);
            }
        }
    });

    // Create a new manager instance before each test
    beforeEach(() => {
        graphManager = new GraphologyManager(graphFilePath);
    });

    // Clean up graph file after each test
    afterEach(async () => {
        try {
             await fs.unlink(graphFilePath);
        } catch (error /* : any */) { // Removed type annotation
             if (error && error.code !== 'ENOENT') { // Ignore if file doesn't exist
                 console.error("Error cleaning up graph file:", error);
             }
        }
    });

    // --- Tests --- 

    describe('constructor', () => {
        it('should initialize an empty multi-graph', () => {
            const graph = graphManager.getGraphInstance();
            assert.strictEqual(graph.order, 0, 'Graph should have 0 nodes initially');
            assert.strictEqual(graph.size, 0, 'Graph should have 0 edges initially');
            assert.strictEqual(graph.type, 'mixed', 'Graph type should be mixed');
            assert.strictEqual(graph.multi, true, 'Graph should be multi');
        });
    });

    describe('loadGraph / saveGraph', () => {
        it('should save and load the graph to/from JSON file', async () => {
            // Add data
            graphManager.createEntities([{ id: 'n1', type: 'test', attributes: { value: 1 } }]);
            graphManager.createRelations([{ id: 'e1', source: 'n1', target: 'n1', type: 'loop' }]); // Allow self loop
            await graphManager.saveGraph();

            // Create new manager to load
            const newManager = new GraphologyManager(graphFilePath);
            await newManager.loadGraph();

            // Verify
            const graph = newManager.getGraphInstance();
            assert.strictEqual(graph.order, 1);
            assert.strictEqual(graph.size, 1);
            assert.ok(graph.hasNode('n1'));
            assert.ok(graph.hasEdge('e1'));
            // Use plain objects for assertion comparison in JS
            assert.deepStrictEqual(graph.getNodeAttributes('n1'), { type: 'test', value: 1, name: 'n1' });
            assert.deepStrictEqual(graph.getEdgeAttributes('e1'), { type: 'loop' });
        });

        it('should handle loading when file does not exist', async () => {
            try { await fs.unlink(graphFilePath); } catch (e /* : any */) { if (e && e.code !== 'ENOENT') throw e; }
            await graphManager.loadGraph(); // Should not throw
            const graph = graphManager.getGraphInstance();
            assert.strictEqual(graph.order, 0);
        });

         it('should overwrite existing file on save', async () => {
             // Save initial state
             graphManager.createEntities([{ id: 'node_old', type: 'old' }]);
             await graphManager.saveGraph();

             // Create new manager, add different data, save again
             const newManager = new GraphologyManager(graphFilePath);
             newManager.createEntities([{ id: 'node_new', type: 'new' }]);
             await newManager.saveGraph();

             // Load into a third manager to verify content
             const verifyManager = new GraphologyManager(graphFilePath);
             await verifyManager.loadGraph();
             const graph = verifyManager.getGraphInstance();

             assert.strictEqual(graph.order, 1);
             assert.ok(graph.hasNode('node_new'));
             assert.ok(!graph.hasNode('node_old'));
             assert.deepStrictEqual(graph.getNodeAttributes('node_new'), { type: 'new', name: 'node_new' });
         });
    });

    describe('createEntities', () => {
        it('should add new entities with attributes', () => {
            const entities /* : EntityInput[] */ = [
                { id: 'e1', type: 'class', attributes: { name: 'ClassA', filePath: 'a.js' } },
                { id: 'e2', type: 'function' }, // No attributes
            ];
            const result = graphManager.createEntities(entities);
            const graph = graphManager.getGraphInstance();

            assert.deepStrictEqual(result, { createdIds: ['e1', 'e2'], existingIds: [] });
            assert.strictEqual(graph.order, 2);
            assert.ok(graph.hasNode('e1'));
            assert.deepStrictEqual(graph.getNodeAttributes('e1'), { type: 'class', name: 'ClassA', filePath: 'a.js' });
            assert.ok(graph.hasNode('e2'));
            assert.deepStrictEqual(graph.getNodeAttributes('e2'), { type: 'function', name: 'e2' }); // Default name applied
        });

        it('should merge attributes if entity ID exists', () => {
            graphManager.createEntities([{ id: 'e1', type: 'class', attributes: { name: 'OldName', value: 1 } }]);
            const result = graphManager.createEntities([
                { id: 'e1', type: 'class', attributes: { name: 'NewName', filePath: 'a.ts' } },
            ]);
            const graph = graphManager.getGraphInstance();

            assert.deepStrictEqual(result, { createdIds: [], existingIds: ['e1'] });
            assert.strictEqual(graph.order, 1);
            assert.deepStrictEqual(graph.getNodeAttributes('e1'), { type: 'class', name: 'NewName', value: 1, filePath: 'a.ts' });
        });
    });

    describe('createRelations', () => {
        beforeEach(() => {
            graphManager.createEntities([
                { id: 'src', type: 'node' },
                { id: 'tgt', type: 'node' },
                { id: 'other', type: 'node' },
            ]);
        });

        it('should add new relations with attributes', () => {
            const relations /* : RelationInput[] */ = [
                { id: 'r1', source: 'src', target: 'tgt', type: 'calls', attributes: { count: 5 } },
                { id: 'r2', source: 'tgt', target: 'src', type: 'returns' }, // No attributes
            ];
            const result = graphManager.createRelations(relations);
            const graph = graphManager.getGraphInstance();

            assert.deepStrictEqual(result, { createdKeys: ['r1', 'r2'], errors: [] });
            assert.strictEqual(graph.size, 2);
            assert.ok(graph.hasEdge('r1'));
            assert.ok(graph.hasEdge('r2'));
            assert.deepStrictEqual(graph.getEdgeAttributes('r1'), { type: 'calls', count: 5 });
            assert.deepStrictEqual(graph.getEdgeAttributes('r2'), { type: 'returns' });
            assert.strictEqual(graph.source('r1'), 'src');
            assert.strictEqual(graph.target('r1'), 'tgt');
        });

        it('should return error if source or target node does not exist', () => {
            const relations /* : RelationInput[] */ = [
                { id: 'r1', source: 'src', target: 'nonexistent', type: 'calls' },
                { id: 'r2', source: 'nonexistent', target: 'tgt', type: 'calls' },
            ];
            const result = graphManager.createRelations(relations);
            const graph = graphManager.getGraphInstance();

            assert.strictEqual(graph.size, 0);
            assert.deepStrictEqual(result.createdKeys, []);
            assert.strictEqual(result.errors.length, 2);
            assert.ok(result.errors[0].includes('Target node nonexistent'));
            assert.ok(result.errors[1].includes('Source node nonexistent'));
        });

        it('should return error if relation ID already exists', () => {
            graphManager.createRelations([{ id: 'r1', source: 'src', target: 'tgt', type: 'calls' }]);
            const result = graphManager.createRelations([{ id: 'r1', source: 'src', target: 'other', type: 'points_to' }]);
            const graph = graphManager.getGraphInstance();

            assert.strictEqual(graph.size, 1);
            assert.deepStrictEqual(result.createdKeys, []);
            assert.strictEqual(result.errors.length, 1);
            assert.ok(result.errors[0].includes('Relation with ID r1 already exists'));
            assert.strictEqual(graph.target('r1'), 'tgt');
        });
    });

    describe('createObservations', () => {
         beforeEach(() => {
            graphManager.createEntities([
                { id: 'entity1', type: 'class' },
                { id: 'entity2', type: 'function' },
            ]);
        });

        it('should create observation nodes and link them to entities', () => {
            const observations /* : ObservationInput[] */ = [
                { id: 'obs1', content: 'First observation', relatedEntityIds: ['entity1'] },
                { id: 'obs2', content: 'Second observation', relatedEntityIds: ['entity1', 'entity2'], tags: ['important'], attributes: { severity: 'high' } },
            ];
            const result = graphManager.createObservations(observations);
            const graph = graphManager.getGraphInstance();

            assert.deepStrictEqual(result, { createdIds: ['obs1', 'obs2'] });
            assert.ok(graph.hasNode('obs1'));
            assert.ok(graph.hasNode('obs2'));
            assert.strictEqual(graph.getNodeAttribute('obs1', 'type'), 'observation');
            assert.strictEqual(graph.getNodeAttribute('obs1', 'content'), 'First observation');
            assert.strictEqual(graph.getNodeAttribute('obs2', 'severity'), 'high');
            assert.deepStrictEqual(graph.getNodeAttribute('obs2', 'tags'), ['important']);

            assert.ok(graph.hasEdge('obs1-relates_to->entity1'));
            assert.ok(graph.hasEdge('obs2-relates_to->entity1'));
            assert.ok(graph.hasEdge('obs2-relates_to->entity2'));
            assert.strictEqual(graph.getEdgeAttribute('obs1-relates_to->entity1', 'type'), 'relates_to');
        });

        it('should merge attributes if observation node exists', () => {
             graphManager.createObservations([{ id: 'obs1', content: 'Old content', relatedEntityIds: ['entity1'], attributes: { author: 'A' } }]);
             const result = graphManager.createObservations([
                 { id: 'obs1', content: 'New content', relatedEntityIds: ['entity2'], attributes: { status: 'done' } }
             ]);
            const graph = graphManager.getGraphInstance();

            assert.deepStrictEqual(result, { createdIds: [] });
            assert.ok(graph.hasNode('obs1'));
            assert.strictEqual(graph.getNodeAttribute('obs1', 'content'), 'New content');
            assert.strictEqual(graph.getNodeAttribute('obs1', 'author'), 'A');
            assert.strictEqual(graph.getNodeAttribute('obs1', 'status'), 'done');

             assert.ok(graph.hasEdge('obs1-relates_to->entity1'));
             assert.ok(graph.hasEdge('obs1-relates_to->entity2'));
        });

        it('should warn if related entity does not exist', () => {
             const warnMock = mock.method(console, 'warn');
             warnMock.mock.resetCalls();

             graphManager.createObservations([
                 { id: 'obs1', content: 'Test', relatedEntityIds: ['nonexistent'] }
             ]);

             assert.strictEqual(warnMock.mock.callCount(), 1);
             assert.ok(warnMock.mock.calls[0].arguments[0].includes('Related entity nonexistent not found'));
             mock.restoreAll();
        });
    });

    describe('readGraph', () => {
        beforeEach(() => {
             graphManager.createEntities([
                 { id: 'f1', type: 'function', attributes: { lang: 'ts', name: 'func1' } },
                 { id: 'f2', type: 'function', attributes: { lang: 'js', name: 'func2' } },
                 { id: 'c1', type: 'class', attributes: { lang: 'ts', name: 'Class1' } },
                 { id: 'o1', type: 'observation', attributes: { content: 'Observe C1'} },
             ]);
             graphManager.createRelations([
                 { id: 'r1', source: 'f1', target: 'c1', type: 'uses' },
                 { id: 'r2', source: 'c1', target: 'f2', type: 'contains' },
                 { id: 'r3', source: 'o1', target: 'c1', type: 'relates_to' },
             ]);
        });

        it('should return all nodes and edges if no filter provided', () => {
            const result = graphManager.readGraph();
            assert.strictEqual(result.nodes.length, 4);
            assert.strictEqual(result.edges.length, 3);
        });

        it('should filter nodes by type', () => {
             const result = graphManager.readGraph({ types: ['function'] });
             assert.strictEqual(result.nodes.length, 2);
             assert.ok(result.nodes.some(n => n.id === 'f1'));
             assert.ok(result.nodes.some(n => n.id === 'f2'));
             assert.strictEqual(result.edges.length, 0);
        });

        it('should filter nodes by attributes', () => {
            const result = graphManager.readGraph({ attributes: { lang: 'ts' } });
            assert.strictEqual(result.nodes.length, 2);
            assert.ok(result.nodes.some(n => n.id === 'f1'));
            assert.ok(result.nodes.some(n => n.id === 'c1'));
            assert.strictEqual(result.edges.length, 1);
            assert.ok(result.edges.some(e => e.id === 'r1'));
        });

        it('should filter nodes by node IDs', () => {
            const result = graphManager.readGraph({ nodeIds: ['f1', 'c1', 'o1'] });
            assert.strictEqual(result.nodes.length, 3);
            assert.ok(result.nodes.some(n => n.id === 'f1'));
            assert.ok(result.nodes.some(n => n.id === 'c1'));
            assert.ok(result.nodes.some(n => n.id === 'o1'));
            assert.strictEqual(result.edges.length, 2);
            assert.ok(result.edges.some(e => e.id === 'r1'));
            assert.ok(result.edges.some(e => e.id === 'r3'));
        });

        it('should combine filters (type and attribute)', () => {
            const result = graphManager.readGraph({ types: ['class'], attributes: { lang: 'ts' } });
            assert.strictEqual(result.nodes.length, 1);
            assert.strictEqual(result.nodes[0].id, 'c1');
            assert.strictEqual(result.edges.length, 0);
        });
    });

     describe('updateEntities', () => {
         beforeEach(() => {
             graphManager.createEntities([
                 { id: 'upd1', type: 'var', attributes: { value: 1, name: 'old' } },
                 { id: 'upd2', type: 'const', attributes: { value: 2 } },
             ]);
         });

         it('should merge attributes for existing entities', () => {
             const updates = [
                 { id: 'upd1', attributes: { value: 100, scope: 'global' } },
                 { id: 'upd2', attributes: { name: 'NEW_CONST' } }
             ];
             const result = graphManager.updateEntities(updates);
             const graph = graphManager.getGraphInstance();

             assert.deepStrictEqual(result, { updatedIds: ['upd1', 'upd2'], notFoundIds: [] });
             const attrs1 = graph.getNodeAttributes('upd1');
             const attrs2 = graph.getNodeAttributes('upd2');
             assert.strictEqual(attrs1.value, 100);
             assert.strictEqual(attrs1.scope, 'global');
             assert.strictEqual(attrs1.name, 'old');
             assert.strictEqual(attrs2.name, 'NEW_CONST');
             assert.strictEqual(attrs2.value, 2);
         });

         it('should return notFoundIds for non-existent entities', () => {
             const updates = [
                 { id: 'upd1', attributes: { value: 99 } },
                 { id: 'nonexistent', attributes: { value: -1 } }
             ];
             const result = graphManager.updateEntities(updates);
             assert.deepStrictEqual(result, { updatedIds: ['upd1'], notFoundIds: ['nonexistent'] });
             assert.strictEqual(graphManager.getGraphInstance().getNodeAttribute('upd1', 'value'), 99);
         });
     });

     describe('deleteEntities', () => {
        beforeEach(() => {
             graphManager.createEntities([
                 { id: 'del1', type: 'node' },
                 { id: 'del2', type: 'node' },
                 { id: 'keep1', type: 'node' },
             ]);
             graphManager.createRelations([
                 { id: 'edge_del1_del2', source: 'del1', target: 'del2', type: 'link' },
                 { id: 'edge_keep1_del1', source: 'keep1', target: 'del1', type: 'link' },
             ]);
         });

         it('should delete specified entities and incident edges', () => {
             const result = graphManager.deleteEntities(['del1', 'del2']);
             const graph = graphManager.getGraphInstance();

             assert.deepStrictEqual(result, { deletedIds: ['del1', 'del2'], notFoundIds: [] });
             assert.strictEqual(graph.order, 1);
             assert.ok(graph.hasNode('keep1'));
             assert.ok(!graph.hasNode('del1'));
             assert.ok(!graph.hasNode('del2'));
             assert.strictEqual(graph.size, 0);
         });

          it('should return notFoundIds for non-existent entities', () => {
             const result = graphManager.deleteEntities(['del1', 'nonexistent']);
             assert.deepStrictEqual(result, { deletedIds: ['del1'], notFoundIds: ['nonexistent'] });
             assert.strictEqual(graphManager.getGraphInstance().order, 2);
             assert.ok(!graphManager.getGraphInstance().hasNode('del1'));
         });
     });

     describe('deleteRelations', () => {
         beforeEach(() => {
             graphManager.createEntities([
                 { id: 'a', type: 'node' }, { id: 'b', type: 'node' }, { id: 'c', type: 'node' }
             ]);
             graphManager.createRelations([
                 { id: 'ab', source: 'a', target: 'b', type: 'link' },
                 { id: 'bc', source: 'b', target: 'c', type: 'link' },
                 { id: 'ca', source: 'c', target: 'a', type: 'link' },
             ]);
         });

         it('should delete specified relations by key', () => {
             const result = graphManager.deleteRelations(['ab', 'ca']);
             const graph = graphManager.getGraphInstance();

             assert.deepStrictEqual(result, { deletedKeys: ['ab', 'ca'], notFoundKeys: [] });
             assert.strictEqual(graph.order, 3);
             assert.strictEqual(graph.size, 1);
             assert.ok(graph.hasEdge('bc'));
             assert.ok(!graph.hasEdge('ab'));
             assert.ok(!graph.hasEdge('ca'));
         });

         it('should return notFoundKeys for non-existent relations', () => {
             const result = graphManager.deleteRelations(['ab', 'nonexistent']);
             assert.deepStrictEqual(result, { deletedKeys: ['ab'], notFoundKeys: ['nonexistent'] });
             assert.strictEqual(graphManager.getGraphInstance().size, 2);
         });
     });

    // TODO: Add tests for analyzeCodebase (requires mocking fs.readFile, fs.writeFile [for save], glob, and CodeSplitter)
    describe.skip('analyzeCodebase', () => {
        // ... tests would go here ...
    });

}); 