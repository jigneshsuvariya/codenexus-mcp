import { strict as assert } from 'node:assert';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Helper function to send request and get response from the server process
async function sendRequest(proc, request) {
    return new Promise((resolve, reject) => {
        let responseData = '';
        let errorData = ''; // Capture stderr
        let responseComplete = false;

        const onData = (data) => {
            responseData += data.toString();
            if (responseData.includes('\n')) {
                try {
                    const jsonResponse = JSON.parse(responseData.trim());
                    responseComplete = true;
                    cleanupListeners();
                    // Check for JSON-RPC error field before resolving
                    if (jsonResponse.error) {
                        console.error("Server returned JSON-RPC error:", JSON.stringify(jsonResponse.error, null, 2));
                        // Optionally reject here, or let assertions handle it
                        // reject(new Error(`Server returned JSON-RPC error: ${JSON.stringify(jsonResponse.error)}`));
                    } else if (!jsonResponse.result && request.method !== 'error') { // Simple check if result is missing for non-error tests
                         console.error("Server response missing 'result' field:", JSON.stringify(jsonResponse, null, 2));
                    }
                    resolve(jsonResponse);
                } catch (e) {
                     console.error("Failed to parse server response JSON:", responseData);
                     console.error("Stderr during request:", errorData); // Log stderr on parse failure
                     cleanupListeners();
                     reject(new Error(`Failed to parse response JSON: ${e.message}. Response chunk: ${responseData}`));
                }
            }
        };

        const onErrorData = (data) => {
            const message = data.toString();
            // Filter out the known initialization messages from general stderr logging during request
            if (!message.includes("KnowledgeGraphManager initialized") && 
                !message.includes("Graph file not found") && 
                !message.includes("Connecting MCP server") && 
                !message.includes("MCP server connected")) {
                console.error(`Server stderr: ${message}`);
            }
            errorData += message; // Append stderr messages regardless of logging
        };

        const onError = (err) => {
            console.error('Server process error event:', err);
            if (!responseComplete) {
                 responseComplete = true;
                 cleanupListeners();
                 reject(err);
            }
        };

        const onExit = (code, signal) => {
            // Don't log exit code if response was already completed successfully
             if (!responseComplete) {
                 console.error(`Server process exited with code ${code}, signal ${signal}`);
                 responseComplete = true;
                 cleanupListeners();
                 reject(new Error(`Server process exited unexpectedly with code ${code}, signal ${signal} before response completed. Stderr: ${errorData}`));
             }
        };

        const cleanupListeners = () => {
            proc.stdout?.removeListener('data', onData);
            proc.stderr?.removeListener('data', onErrorData);
            proc.removeListener('error', onError);
            proc.removeListener('exit', onExit);
        };

        // Attach listeners
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onErrorData);
        proc.on('error', onError);
        proc.on('exit', onExit);

        // console.log(`Sending request: ${JSON.stringify(request)}`); // Log the request being sent
        proc.stdin.write(JSON.stringify(request) + '\n');

        // Timeout to prevent hanging tests
        const timeoutId = setTimeout(() => {
            if (!responseComplete) {
                console.error('Request timed out after 5 seconds.');
                console.error("Stderr during request:", errorData);
                responseComplete = true;
                cleanupListeners();
                reject(new Error('Request timed out after 5 seconds'));
            }
        }, 5000); // 5 second timeout

        // Ensure timeout doesn't keep process running
        proc.on('close', () => clearTimeout(timeoutId));

    });
}


describe('MCP Server Integration Tests', () => {
    let tempDir;
    let tempGraphPath;
    let serverProcess;
    const serverScriptPath = path.resolve(process.cwd(), 'dist/server.js'); 

    beforeEach(async () => {
        // Create a temporary directory for graph file
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-server-test-'));
        tempGraphPath = path.join(tempDir, 'test-knowledge-graph.json');
        // console.log(`Using temp graph path: ${tempGraphPath}`);

        // Spawn the server process with the env var
        serverProcess = spawn('node', [serverScriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'], 
            env: {
                ...process.env, 
                MEMORY_FILE_PATH: tempGraphPath
            }
        });

        // Promise to wait for server ready message
        const serverReadyPromise = new Promise((resolve, reject) => {
            let stderrOutput = '';
            let readyTimeoutId;

            const cleanupListeners = () => {
                if (readyTimeoutId) clearTimeout(readyTimeoutId);
                serverProcess.stderr?.removeListener('data', onData);
                serverProcess?.removeListener('error', onError);
                serverProcess?.removeListener('exit', onExit);
            };

            const cleanupAndResolve = () => {
                cleanupListeners();
                resolve();
            };

            const cleanupAndReject = (err) => {
                cleanupListeners();
                reject(err);
            };

            const onData = (data) => {
                const message = data.toString();
                // Log every stderr chunk during setup
                console.error(`Server stderr (Setup): ${message}`); 
                stderrOutput += message;
                if (stderrOutput.includes("MCP server connected and listening on stdin/stdout.")) {
                    cleanupAndResolve();
                }
            };

            const onError = (err) => {
                cleanupAndReject(err);
            };

            const onExit = (code, signal) => {
                cleanupAndReject(new Error(`Server process exited prematurely during setup with code ${code}, signal ${signal}. Stderr: ${stderrOutput.slice(-500)}`));
            };
            
            serverProcess.stderr.on('data', onData);
            serverProcess.on('error', onError);
            serverProcess.on('exit', onExit);

            readyTimeoutId = setTimeout(() => {
                cleanupAndReject(new Error(`Timeout waiting for server ready message. Accumulated Stderr: ${stderrOutput.slice(-500)}`));
            }, 10000);
        });
        
        try {
            await serverReadyPromise;
            // console.log("Server is confirmed ready.");
        } catch (err) {
            if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGKILL'); 
            }
            throw new Error(`Server setup failed: ${err.message}`);
        }
        
        if (serverProcess.exitCode !== null && !serverProcess.killed) {
            throw new Error(`Server process exited immediately after setup with code ${serverProcess.exitCode}`);
        }
    });

    afterEach(async () => {
        // Kill the server process
        if (serverProcess && !serverProcess.killed) {
            const killed = serverProcess.kill('SIGTERM'); 
            // console.log(`Attempted to kill server process (PID: ${serverProcess.pid}). Success: ${killed}`);
            await new Promise(resolve => setTimeout(resolve, 100));
             if (!serverProcess.killed) {
                 serverProcess.kill('SIGKILL');
                 // console.log(`Force killing server process (PID: ${serverProcess.pid})`);
             }
        }

        // Remove the temporary directory
        if (tempDir) {
            try {
                await rm(tempDir, { recursive: true, force: true });
                // console.log(`Cleaned up temp directory: ${tempDir}`);
            } catch (err) {
                console.error(`Error removing temp directory ${tempDir}:`, err);
            }
        }
        // Ensure env var is cleaned up if necessary
        delete process.env.MEMORY_FILE_PATH;
    });

    it('should respond to list_tools request', async () => {
        const request = { jsonrpc: "2.0", id: 1, method: "list_tools" };
        const response = await sendRequest(serverProcess, request);

        assert.deepStrictEqual(response.jsonrpc, "2.0", "Response should be JSON-RPC 2.0");
        assert.strictEqual(response.id, 1, "Response ID should match request ID");
        // If the test fails here, it means the server is likely sending an error instead of a result
        assert.ok(response.result, "Response should have a result field"); 
        assert.ok(Array.isArray(response.result.tools), "Result should have a tools array");
        assert.ok(response.result.tools.length > 5, "Should list several tools");

        const toolNames = response.result.tools.map(t => t.name);
        assert.ok(toolNames.includes('create_entities'), "Tool list should include create_entities");
        assert.ok(toolNames.includes('read_graph'), "Tool list should include read_graph");
        assert.ok(toolNames.includes('analyze_codebase'), "Tool list should include analyze_codebase");
    });

    it('should handle a basic create_entities request', async () => {
         const entityId = `test_entity_${crypto.randomUUID()}`;
         const request = {
            jsonrpc: "2.0",
            id: 2,
            method: "call_tool",
            params: {
                name: "create_entities",
                arguments: {
                    entities: [
                        {
                            id: entityId,
                            type: "test_type",
                            attributes: { description: "A test entity" }
                        }
                    ]
                }
            }
        };

        const response = await sendRequest(serverProcess, request);

        assert.strictEqual(response.id, 2, "Response ID should match request ID");
        // If the test fails here, it means the server is likely sending an error instead of a result
        assert.ok(response.result, "Response should have a result field"); 
        assert.deepStrictEqual(response.result.createdIds, [entityId], "Result should list the created entity ID");
        assert.deepStrictEqual(response.result.existingIds, [], "Result should list no existing IDs for a new entity");

        // Verify the graph file content
        const graphDataRaw = await readFile(tempGraphPath, 'utf-8');
        const graphData = JSON.parse(graphDataRaw);
        assert.ok(graphData.nodes, 'Graph file should have nodes property');
        const createdNode = graphData.nodes.find(n => n.key === entityId); 
        assert.ok(createdNode, `Graph should contain the node with id ${entityId}`);
        assert.strictEqual(createdNode.attributes.type, 'test_type', "Node attribute 'type' mismatch");
        assert.strictEqual(createdNode.attributes.description, 'A test entity', "Node attribute 'description' mismatch");
    });

}); 