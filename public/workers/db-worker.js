// Database worker: Uses streaming JSON parser for robust parsing
// This runs in a separate thread to prevent UI blocking

// Import SQL.js from CDN using classic worker syntax
importScripts('https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js');

let db = null;
let tableName = 'data';
let sampleSize = 100;
let batchSize = 1000;
let schema = null;
let objectCount = 0;
let rowsProcessed = 0;
let currentBatch = [];
let existingColumnsSet = new Set();
let pendingColumns = [];
let parser = null;
let parserWriter = null;
let JSONParser = null;

/**
 * Initialize the Stream Parser
 * 
 * Note: This uses dynamic ES module loading because:
 * 1. The @streamparser/json-whatwg library is ESM-only
 * 2. Classic workers (needed for importScripts) don't support ES modules natively
 * 3. The library is loaded from esm.sh CDN which properly handles ESM module resolution
 * 
 * The @streamparser/json-whatwg library uses WHATWG Streams API:
 * - parser.writable is a WritableStream
 * - We need to get a writer from it to write chunks
 * 
 * For production deployments with strict security requirements, consider:
 * - Hosting the library locally
 * - Using Subresource Integrity (SRI) hashes
 * - Implementing Content Security Policy (CSP) headers
 */
async function initParser() {
    try {
        // Dynamically load the JSON parser library using esm.sh CDN
        // esm.sh properly handles ESM module resolution unlike blob URLs
        const module = await import('https://esm.sh/@streamparser/json-whatwg@0.0.22');
        JSONParser = module.JSONParser;
        
        // paths: ['$[*]'] means "Give me every item inside the root array"
        // keepStack: false keeps memory usage low
        parser = new JSONParser({ paths: ['$[*]'], keepStack: false });
        
        // Get a writer from the parser's writable stream
        parserWriter = parser.writable.getWriter();
        
        // Set up the readable stream to consume parsed values
        const reader = parser.readable.getReader();
        
        // Read parsed values in the background
        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    // Process each parsed object
                    if (value) {
                        processObject(value);
                    }
                }
            } catch (err) {
                console.error('[DB Worker] JSON Parse Error:', err);
                postMessage({ 
                    type: 'error', 
                    data: { message: `JSON Parse Error: ${err.message}` }
                });
            }
        })();
        
    } catch (error) {
        console.error('[DB Worker] Failed to initialize parser:', error);
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to initialize parser: ${error.message}` }
        });
    }
}

/**
 * Initialize SQL.js and database
 */
async function initDatabase() {
    try {
        console.log('[DB Worker] Initializing SQL.js database...');
        postMessage({ type: 'log', data: { message: 'Loading SQL.js WASM...' } });
        
        const SQL = await initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
        });
        
        console.log('[DB Worker] SQL.js WASM loaded successfully');
        
        db = new SQL.Database();
        
        console.log('[DB Worker] Initializing JSON parser...');
        await initParser();
        
        console.log('[DB Worker] Database and parser created successfully');
        postMessage({ type: 'log', data: { message: 'Database & Parser initialized' } });
        
        // Send READY signal to main thread
        postMessage({ type: 'READY' });
        
    } catch (error) {
        console.error('[DB Worker] Failed to initialize database:', error);
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to initialize database: ${error.message}` }
        });
    }
}

/**
 * Process incoming messages from main thread
 */
self.onmessage = async function(event) {
    const { type, data } = event.data;

    console.log(`[DB Worker] Received message: ${type}`);

    switch (type) {
        case 'init':
            tableName = data.tableName || 'data';
            sampleSize = data.sampleSize || 100;
            batchSize = data.batchSize || 1000;
            console.log('[DB Worker] Configuration:', { tableName, sampleSize, batchSize });
            await initDatabase();
            break;

        case 'chunk':
            // Write the chunk to the parser using the WHATWG Streams API
            // The parser's writable stream will handle partial JSON and buffer management
            if (parserWriter) {
                try {
                    await parserWriter.write(data);
                } catch (e) {
                    console.error('[DB Worker] Parser Write Error:', e);
                    postMessage({ 
                        type: 'error', 
                        data: { message: `Parser error: ${e.message}` }
                    });
                }
            } else {
                console.warn('[DB Worker] Received chunk before initialization');
            }
            break;

        case 'end':
            if (parserWriter) {
                console.log('[DB Worker] End of stream received, closing parser...');
                try {
                    await parserWriter.close();
                    console.log('[DB Worker] Parser closed, finalizing...');
                    // Wait a bit for any pending parsed values to be processed
                    await new Promise(resolve => setTimeout(resolve, 100));
                    await finalizeProcessing();
                } catch (e) {
                    console.error('[DB Worker] Error closing parser:', e);
                    await finalizeProcessing();
                }
            }
            break;

        case 'export':
            console.log('[DB Worker] Export requested');
            exportDatabase();
            break;
    }
};

/**
 * Process a single JSON object (Flattens and batches it)
 */
function processObject(obj) {
    objectCount++;
    
    // Flatten nested objects
    const flatObj = flattenObject(obj);
    
    // Log first few objects for debugging
    if (objectCount <= 5) {
        console.log(`[DB Worker] Processing object #${objectCount}:`, obj);
        console.log(`[DB Worker] Flattened object #${objectCount}:`, flatObj);
        console.log(`[DB Worker] Flattened keys:`, Object.keys(flatObj));
    }
    
    // Build schema from first N objects
    if (!schema && objectCount < sampleSize) {
        buildSchema(flatObj);
    }
    
    // Create table once schema is determined
    if (!schema && objectCount >= sampleSize) {
        createTable();
    }
    
    // Add to batch
    if (schema) {
        // Check for new columns (adds to pending list)
        checkAndAddNewColumns(flatObj);
        
        currentBatch.push(flatObj);
        
        // Insert batch when full
        if (currentBatch.length >= batchSize) {
            // Apply any pending column additions before inserting
            applyPendingColumns();
            insertBatch();
        }
    }
}

/**
 * Flatten nested object into single-level object
 * converts { configs: { id: 1 } } -> { configs_id: 1 }
 * converts { tags: ["a", "b"] } -> { tags: '["a", "b"]' }
 */
function flattenObject(obj, prefix = '') {
    const flattened = {};
    
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        
        const value = obj[key];
        const newKey = prefix ? `${prefix}_${key}` : key;
        
        if (value === null || value === undefined) {
            flattened[newKey] = null;
        } else if (Array.isArray(value)) {
            // Arrays become JSON strings (SQLite doesn't support Arrays)
            flattened[newKey] = JSON.stringify(value);
        } else if (typeof value === 'object') {
            // Recurse deeper
            Object.assign(flattened, flattenObject(value, newKey));
        } else {
            flattened[newKey] = value;
        }
    }
    
    return flattened;
}

/**
 * Build schema from sample objects
 */
const schemaBuilder = {
    columns: {},
    
    add(obj) {
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            
            const value = obj[key];
            const type = detectType(value);
            
            if (!this.columns[key]) {
                this.columns[key] = { name: key, type: type };
            } else {
                // If types differ, use TEXT as fallback
                if (this.columns[key].type !== type && value !== null) {
                    this.columns[key].type = 'TEXT';
                }
            }
        }
    },
    
    getSchema() {
        return Object.values(this.columns);
    }
};

function buildSchema(obj) {
    schemaBuilder.add(obj);
}

/**
 * Detect SQLite type from JavaScript value
 */
function detectType(value) {
    if (value === null) return 'TEXT';
    
    const type = typeof value;
    
    if (type === 'number') {
        return Number.isInteger(value) ? 'INTEGER' : 'REAL';
    } else if (type === 'boolean') {
        return 'INTEGER'; // SQLite uses 0/1 for booleans
    } else {
        return 'TEXT';
    }
}

/**
 * Create table with detected schema
 */
function createTable() {
    schema = schemaBuilder.getSchema();
    
    console.log('[DB Worker] Creating table with schema:', schema);
    
    if (schema.length === 0) {
        console.error('[DB Worker] No schema detected from sample data');
        postMessage({ 
            type: 'error', 
            data: { message: 'No schema could be detected from sample data' }
        });
        return;
    }
    
    // Build CREATE TABLE statement
    const columns = schema.map(col => {
        return `"${sanitize(col.name)}" ${col.type}`;
    }).join(', ');
    
    const createTableSQL = `CREATE TABLE "${tableName}" (${columns})`;
    
    console.log('[DB Worker] CREATE TABLE SQL:', createTableSQL);
    
    try {
        db.run(createTableSQL);
        
        // Initialize the existing columns set
        existingColumnsSet = new Set(schema.map(col => col.name));
        
        console.log('[DB Worker] Table created successfully with columns:', schema.map(c => c.name));
        
        postMessage({ 
            type: 'schema', 
            data: { 
                columns: schema.map(c => c.name),
                sql: createTableSQL
            }
        });
        
        postMessage({ 
            type: 'log', 
            data: { message: `Table "${tableName}" created with ${schema.length} columns` }
        });
        
    } catch (error) {
        console.error('[DB Worker] Failed to create table:', error);
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to create table: ${error.message}` }
        });
    }
}

/**
 * Sanitize column/table names for SQL
 */
function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Check if object has new columns not in schema, and add them to pending list
 */
function checkAndAddNewColumns(obj) {
    if (!schema || !db) return;
    
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        
        if (!existingColumnsSet.has(key)) {
            const value = obj[key];
            const type = detectType(value);
            pendingColumns.push({ name: key, type: type });
            // Add to set immediately to avoid duplicates in pending list
            existingColumnsSet.add(key);
        }
    }
}

/**
 * Apply pending column additions to the database
 */
function applyPendingColumns() {
    if (pendingColumns.length === 0) return;
    
    console.log(`[DB Worker] Adding ${pendingColumns.length} new columns:`, pendingColumns);
    
    try {
        // Use transaction for atomicity
        db.run('BEGIN');
        
        for (const col of pendingColumns) {
            const alterSQL = `ALTER TABLE "${tableName}" ADD COLUMN "${sanitize(col.name)}" ${col.type}`;
            console.log('[DB Worker] ALTER TABLE SQL:', alterSQL);
            db.run(alterSQL);
            schema.push(col);
            
            postMessage({ 
                type: 'log', 
                data: { 
                    message: `Added new column: ${col.name} (${col.type})`,
                    level: 'info'
                }
            });
        }
        
        db.run('COMMIT');
        console.log('[DB Worker] New columns added successfully');
        pendingColumns = [];
    } catch (error) {
        console.error('[DB Worker] Failed to add new columns:', error);
        db.run('ROLLBACK');
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to add new columns: ${error.message}` }
        });
    }
}

/**
 * Insert a batch of rows
 */
function insertBatch() {
    if (currentBatch.length === 0) return;
    
    console.log(`[DB Worker] Inserting batch of ${currentBatch.length} rows`);
    
    // Log first row of each batch for debugging
    if (currentBatch.length > 0 && (rowsProcessed === 0 || rowsProcessed % (batchSize * 10) === 0)) {
        console.log('[DB Worker] Sample row from batch:', currentBatch[0]);
        console.log('[DB Worker] Sample row keys:', Object.keys(currentBatch[0]));
    }
    
    try {
        db.run('BEGIN');
        
        const columnNames = schema.map(col => `"${sanitize(col.name)}"`).join(', ');
        const placeholders = schema.map(() => '?').join(', ');
        const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;
        
        const stmt = db.prepare(insertSQL);
        
        for (const obj of currentBatch) {
            const values = schema.map(col => {
                const value = obj[col.name];
                
                if (value === undefined || value === null) {
                    return null;
                } else if (typeof value === 'boolean') {
                    return value ? 1 : 0;
                } else {
                    return value;
                }
            });
            
            stmt.run(values);
        }
        
        stmt.free();
        db.run('COMMIT');
        
        rowsProcessed += currentBatch.length;
        console.log(`[DB Worker] Batch inserted successfully. Total rows: ${rowsProcessed}`);
        currentBatch = [];
        
        // Report progress
        postMessage({
            type: 'progress',
            data: {
                rowsProcessed: rowsProcessed,
                progress: 0.5 // We don't know total, so report generic progress
            }
        });
        
        postMessage({
            type: 'status',
            data: { message: `Processing... ${rowsProcessed.toLocaleString()} rows` }
        });
        
    } catch (error) {
        console.error('[DB Worker] Failed to insert batch:', error);
        db.run('ROLLBACK');
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to insert batch: ${error.message}` }
        });
    }
}

/**
 * Finalize processing and insert remaining rows
 */
async function finalizeProcessing() {
    console.log('[DB Worker] Finalizing processing...');
    console.log(`[DB Worker] Total objects parsed: ${objectCount}`);
    console.log(`[DB Worker] Remaining batch size: ${currentBatch.length}`);
    
    // Create table if not created yet (for small files)
    if (!schema && objectCount > 0) {
        createTable();
    }
    
    // Apply any remaining pending columns
    applyPendingColumns();
    
    // Insert any remaining rows
    if (currentBatch.length > 0) {
        insertBatch();
    }
    
    // Get database size
    const dbData = db.export();
    const dbSize = dbData.byteLength;
    
    console.log('[DB Worker] Processing complete!');
    console.log(`[DB Worker] Final statistics - Total rows: ${rowsProcessed}, DB size: ${dbSize} bytes`);
    
    postMessage({
        type: 'complete',
        data: {
            totalRows: rowsProcessed,
            dbSize: dbSize
        }
    });
    
    postMessage({
        type: 'log',
        data: { message: `Successfully processed ${rowsProcessed.toLocaleString()} rows` }
    });
}

/**
 * Export database as binary data
 */
function exportDatabase() {
    console.log('[DB Worker] Exporting database...');
    try {
        const data = db.export();
        console.log(`[DB Worker] Database exported successfully: ${data.byteLength} bytes`);
        postMessage({
            type: 'exported',
            data: data
        }, [data.buffer]); // Transfer ownership of buffer
        
        postMessage({
            type: 'log',
            data: { message: 'Database exported successfully' }
        });
        
    } catch (error) {
        console.error('[DB Worker] Failed to export database:', error);
        postMessage({
            type: 'error',
            data: { message: `Failed to export database: ${error.message}` }
        });
    }
}
