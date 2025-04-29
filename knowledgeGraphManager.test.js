import assert from 'assert';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { describe, it, before, beforeEach, after } from 'node:test'; // Import test functions

// Import the class directly now that server.js is refactored
import { KnowledgeGraphManager } from './server.js';

// const modulePath = './server.js'; // No longer needed
const tempMemoryFilePath = path.join(path.dirname(import.meta.url.substring(8)), 'test_memory.json'); // Use substring(8) for file:// URL

// Helper function to safely delete the test memory file
async function cleanupTestFile() {
    try {
        await fs.unlink(tempMemoryFilePath);
    } catch (err) {
        if (err.code !== 'ENOENT') { // Ignore if file doesn't exist
            console.error('Error cleaning up test file:', err);
        }
    }
}

// --- Test Suite ---
describe('KnowledgeGraphManager', () => {
    let kgm;

    // Setup before all tests - simplified
    before(() => {
        // Set the environment variable to use the test file
        process.env.MEMORY_FILE_PATH = tempMemoryFilePath;
        // No need to dynamically import anymore
    });

    // Cleanup before each test
    beforeEach(async () => {
        await cleanupTestFile();
        kgm = new KnowledgeGraphManager(); // Create a fresh instance
    });

    // Cleanup after all tests
    after(async () => {
        await cleanupTestFile();
        delete process.env.MEMORY_FILE_PATH; // Unset the env var
    });

    it('should initialize with an empty graph if file doesn\'t exist', async () => {
        const graph = await kgm.loadGraph();
        assert.deepStrictEqual(graph, { entities: [], relations: [] });
    });

    it('should create entities with new fields and observations', async () => {
        const entitiesToCreate = [
            {
                name: 'MyClass', entityType: 'class', language: 'javascript', filePath: 'src/myClass.js',
                observations: [
                    { id: 'obs1', observationType: 'comment', content: 'Initial class comment' }
                ]
            },
            { name: 'myFunction', entityType: 'function', observations: [] }
        ];
        const created = await kgm.createEntities(entitiesToCreate);
        assert.strictEqual(created.length, 2);
        assert.strictEqual(created[0].name, 'MyClass');
        assert.strictEqual(created[0].language, 'javascript');
        assert.strictEqual(created[0].observations.length, 1);
        assert.strictEqual(created[0].observations[0].id, 'obs1');

        const graph = await kgm.loadGraph();
        assert.strictEqual(graph.entities.length, 2);
        const loadedEntity = graph.entities.find(e => e.name === 'MyClass');
        assert.ok(loadedEntity);
        assert.strictEqual(loadedEntity.language, 'javascript');
        assert.strictEqual(loadedEntity.observations[0].content, 'Initial class comment');
    });

    it('should add observations with generated IDs', async () => {
        await kgm.createEntities([{ name: 'TestEntity', entityType: 'variable', observations: [] }]);
        const observationsToAdd = [
            { entityName: 'TestEntity', observationsToAdd: [{ observationType: 'todo', content: 'Refactor this' }] },
            { entityName: 'TestEntity', observationsToAdd: [{ observationType: 'comment', content: 'Another note' }] }
        ];

        const results = await kgm.addObservations(observationsToAdd);
        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0].addedObservations.length, 1);
        assert.strictEqual(results[1].addedObservations.length, 1);
        assert.ok(results[0].addedObservations[0].id); // Check ID was generated
        assert.ok(results[1].addedObservations[0].id);

        const graph = await kgm.loadGraph();
        const entity = graph.entities.find(e => e.name === 'TestEntity');
        assert.strictEqual(entity.observations.length, 2);
        assert.strictEqual(entity.observations[0].observationType, 'todo');
        assert.strictEqual(entity.observations[1].observationType, 'comment');
    });

    it('should not add duplicate observations by ID', async () => {
        const initialObs = { id: crypto.randomUUID(), observationType: 'info', content: 'Unique info' };
        await kgm.createEntities([{ name: 'NoDupEntity', entityType: 'variable', observations: [initialObs] }]);

        const results = await kgm.addObservations([
            { entityName: 'NoDupEntity', observationsToAdd: [initialObs] } // Try adding the same observation
        ]);
        assert.strictEqual(results[0].addedObservations.length, 0); // Nothing should be added

        const graph = await kgm.loadGraph();
        const entity = graph.entities.find(e => e.name === 'NoDupEntity');
        assert.strictEqual(entity.observations.length, 1); // Should still only have 1 observation
    });

    it('should delete observations by ID', async () => {
        const obs1 = { id: crypto.randomUUID(), observationType: 'fixme', content: 'Fix 1' };
        const obs2 = { id: crypto.randomUUID(), observationType: 'comment', content: 'Comment 1' };
        await kgm.createEntities([{ name: 'DeleteObsEntity', entityType: 'variable', observations: [obs1, obs2] }]);

        await kgm.deleteObservations([{ entityName: 'DeleteObsEntity', observationIds: [obs1.id] }]);

        const graph = await kgm.loadGraph();
        const entity = graph.entities.find(e => e.name === 'DeleteObsEntity');
        assert.strictEqual(entity.observations.length, 1);
        assert.strictEqual(entity.observations[0].id, obs2.id);
        assert.strictEqual(entity.observations[0].content, 'Comment 1');
    });

    it('should search nodes based on new entity fields', async () => {
        await kgm.createEntities([
            { name: 'SearchClass', entityType: 'class', language: 'typescript', summary: 'A searchable class' },
            { name: 'OtherClass', entityType: 'class', language: 'javascript' }
        ]);
        const results = await kgm.searchNodes('typescript');
        assert.strictEqual(results.entities.length, 1);
        assert.strictEqual(results.entities[0].name, 'SearchClass');

        const results2 = await kgm.searchNodes('searchable');
        assert.strictEqual(results2.entities.length, 1);
        assert.strictEqual(results2.entities[0].name, 'SearchClass');
    });

     it('should search nodes based on observation content', async () => {
        await kgm.createEntities([
            { name: 'ObsSearchEntity', entityType: 'function', observations: [
                { id: 'o1', observationType: 'security', content: 'Possible vulnerability here' },
                { id: 'o2', observationType: 'performance', content: 'Optimize loop' }
            ]},
            { name: 'OtherEntity', entityType: 'variable', observations: [] }
        ]);
        const results = await kgm.searchNodes('vulnerability');
        assert.strictEqual(results.entities.length, 1);
        assert.strictEqual(results.entities[0].name, 'ObsSearchEntity');

        const results2 = await kgm.searchNodes('optimize');
        assert.strictEqual(results2.entities.length, 1);
        assert.strictEqual(results2.entities[0].name, 'ObsSearchEntity');
    });

    it('should create and load relations with new fields', async () => {
        await kgm.createEntities([
            { name: 'SourceEntity', entityType: 'function' },
            { name: 'TargetEntity', entityType: 'function' }
        ]);
        const relationsToCreate = [
            { from: 'SourceEntity', to: 'TargetEntity', relationType: 'CALLS', filePath: 'src/code.js', line: 42 }
        ];
        const created = await kgm.createRelations(relationsToCreate);
        assert.strictEqual(created.length, 1);
        assert.strictEqual(created[0].filePath, 'src/code.js');

        const graph = await kgm.loadGraph();
        assert.strictEqual(graph.relations.length, 1);
        assert.strictEqual(graph.relations[0].filePath, 'src/code.js');
        assert.strictEqual(graph.relations[0].line, 42);
    });

    it('should create a Project entity', async () => {
        const projectEntity = {
            name: 'test-project',
            entityType: 'project',
            description: 'A project for testing',
            technologies: ['node', 'javascript'],
            repositoryUrl: 'http://example.com/repo',
            observations: []
        };
        const created = await kgm.createEntities([projectEntity]);
        assert.strictEqual(created.length, 1);
        assert.strictEqual(created[0].name, 'test-project');
        assert.strictEqual(created[0].entityType, 'project');
        assert.deepStrictEqual(created[0].technologies, ['node', 'javascript']);

        const graph = await kgm.loadGraph();
        assert.strictEqual(graph.entities.length, 1);
        const loadedProject = graph.entities.find(e => e.entityType === 'project');
        assert.ok(loadedProject);
        assert.strictEqual(loadedProject.description, 'A project for testing');
        assert.strictEqual(loadedProject.repositoryUrl, 'http://example.com/repo');
    });

    it('should add observations with standard types and metadata', async () => {
        await kgm.createEntities([{ name: 'StandardObsEntity', entityType: 'class', observations: [] }]);
        const obsToAdd = [
            {
                entityName: 'StandardObsEntity',
                observationsToAdd: [
                    {
                        observationType: 'design_decision',
                        content: 'Using event sourcing',
                        metadata: { rationale: 'Traceability', decisionMaker: 'Team Lead' }
                    },
                    {
                        observationType: 'design_pattern_use',
                        content: 'Factory method for object creation',
                        metadata: { patternName: 'Factory Method' }
                    },
                    {
                        observationType: 'change_rationale',
                        content: 'Updated dependency X',
                        metadata: { commitHash: 'abcdef123', relatedIssue: 'BUG-42' }
                    }
                ]
            }
        ];

        const results = await kgm.addObservations(obsToAdd);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].addedObservations.length, 3);

        const graph = await kgm.loadGraph();
        const entity = graph.entities.find(e => e.name === 'StandardObsEntity');
        assert.strictEqual(entity.observations.length, 3);

        const decisionObs = entity.observations.find(o => o.observationType === 'design_decision');
        assert.ok(decisionObs);
        assert.strictEqual(decisionObs.metadata.rationale, 'Traceability');
        assert.strictEqual(decisionObs.metadata.decisionMaker, 'Team Lead');

        const patternObs = entity.observations.find(o => o.observationType === 'design_pattern_use');
        assert.ok(patternObs);
        assert.strictEqual(patternObs.metadata.patternName, 'Factory Method');

        const changeObs = entity.observations.find(o => o.observationType === 'change_rationale');
        assert.ok(changeObs);
        assert.strictEqual(changeObs.metadata.commitHash, 'abcdef123');
        assert.strictEqual(changeObs.metadata.relatedIssue, 'BUG-42');
    });

    it('should search nodes based on observation metadata (if applicable)', async () => {
        // This test depends on searchNodes checking metadata, which it does
        await kgm.createEntities([
            { name: 'MetadataSearchEntity', entityType: 'module', observations: [
                { id: 'm1', observationType: 'design_decision', content: 'Decision A', metadata: { rationale: 'Performance' } },
                { id: 'm2', observationType: 'design_pattern_use', content: 'Pattern B', metadata: { patternName: 'Observer' } }
            ]}
        ]);

        // Search by metadata value
        let results = await kgm.searchNodes('Performance');
        assert.strictEqual(results.entities.length, 1, 'Should find entity by metadata value "Performance"');
        assert.strictEqual(results.entities[0].name, 'MetadataSearchEntity');

        // Search by metadata key (less common, but supported by current implementation)
        results = await kgm.searchNodes('rationale');
        assert.strictEqual(results.entities.length, 1, 'Should find entity by metadata key "rationale"');
        assert.strictEqual(results.entities[0].name, 'MetadataSearchEntity');

        // Search by another metadata value
        results = await kgm.searchNodes('Observer');
        assert.strictEqual(results.entities.length, 1, 'Should find entity by metadata value "Observer"');
        assert.strictEqual(results.entities[0].name, 'MetadataSearchEntity');

         // Search for something not present in metadata
        results = await kgm.searchNodes('nonexistent_meta');
        assert.strictEqual(results.entities.length, 0, 'Should not find entity by non-existent metadata');

    });

}); 