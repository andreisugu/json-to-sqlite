// Database worker for handling SQL.js operations and JSON parsing
// This runs in a separate thread to prevent UI blocking

importScripts('https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js');

let db = null;
let tableName = 'data';
let sampleSize = 100;
let batchSize = 1000;
let schema = null;
let buffer = '';
let objectCount = 0;
let rowsProcessed = 0;
let currentBatch = [];
let isInitialized = false;
let bracketDepth = 0;
let inString = false;
let escapeNext = false;
let currentObject = '';

/**
 * Initialize SQL.js and database
 */
async function initDatabase() {
    try {
        postMessage({ type: 'log', data: { message: 'Loading SQL.js WASM...' } });
        
        const SQL = await initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
        });
        
        db = new SQL.Database();
        
        postMessage({ type: 'log', data: { message: 'Database initialized successfully' } });
        isInitialized = true;
        
    } catch (error) {
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

    switch (type) {
        case 'init':
            tableName = data.tableName || 'data';
            sampleSize = data.sampleSize || 100;
            batchSize = data.batchSize || 1000;
            await initDatabase();
            break;

        case 'chunk':
            if (isInitialized) {
                processChunk(data);
            }
            break;

        case 'end':
            if (isInitialized) {
                await finalizeProcessing();
            }
            break;

        case 'export':
            exportDatabase();
            break;
    }
};

/**
 * Process a chunk of JSON data
 */
function processChunk(chunk) {
    buffer += chunk;
    
    // Parse objects from buffer
    let startPos = 0;
    
    for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];
        
        // Handle string detection
        if (char === '"' && !escapeNext) {
            inString = !inString;
        }
        
        // Handle escape sequences
        if (char === '\\' && !escapeNext) {
            escapeNext = true;
            continue;
        } else {
            escapeNext = false;
        }
        
        // Track bracket depth when not in string
        if (!inString) {
            if (char === '{') {
                if (bracketDepth === 0) {
                    startPos = i;
                }
                bracketDepth++;
            } else if (char === '}') {
                bracketDepth--;
                
                // Complete object found
                if (bracketDepth === 0) {
                    const objectStr = buffer.substring(startPos, i + 1);
                    try {
                        const obj = JSON.parse(objectStr);
                        processObject(obj);
                        objectCount++;
                    } catch (e) {
                        // Invalid JSON object, skip it
                        postMessage({ 
                            type: 'log', 
                            data: { 
                                message: `Skipping invalid JSON object at position ${startPos}`,
                                level: 'warning'
                            }
                        });
                    }
                    startPos = i + 1;
                }
            }
        }
    }
    
    // Keep unprocessed data in buffer
    if (startPos > 0) {
        buffer = buffer.substring(startPos);
    }
}

/**
 * Process a single JSON object
 */
function processObject(obj) {
    // Flatten nested objects
    const flatObj = flattenObject(obj);
    
    // Build schema from first N objects
    if (!schema && objectCount < sampleSize) {
        buildSchema(flatObj);
    }
    
    // Create table once schema is determined
    if (!schema && objectCount === sampleSize) {
        createTable();
    }
    
    // Add to batch
    if (schema) {
        currentBatch.push(flatObj);
        
        // Insert batch when full
        if (currentBatch.length >= batchSize) {
            insertBatch();
        }
    }
}

/**
 * Flatten nested object into single-level object
 */
function flattenObject(obj, prefix = '') {
    const flattened = {};
    
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        
        const value = obj[key];
        const newKey = prefix ? `${prefix}_${key}` : key;
        
        if (value === null || value === undefined) {
            flattened[newKey] = null;
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            // Recursively flatten nested objects
            Object.assign(flattened, flattenObject(value, newKey));
        } else if (Array.isArray(value)) {
            // Store arrays as JSON strings
            flattened[newKey] = JSON.stringify(value);
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
            if (!obj.hasOwnProperty(key)) continue;
            
            const value = obj[key];
            const type = detectType(value);
            
            if (!this.columns[key]) {
                this.columns[key] = { name: key, type: type, nullable: false };
            } else {
                // If types differ, use TEXT as fallback
                if (this.columns[key].type !== type && value !== null) {
                    this.columns[key].type = 'TEXT';
                }
                
                // Track if column can be null
                if (value === null) {
                    this.columns[key].nullable = true;
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
        return 'INTEGER';
    } else {
        return 'TEXT';
    }
}

/**
 * Create table with detected schema
 */
function createTable() {
    schema = schemaBuilder.getSchema();
    
    if (schema.length === 0) {
        postMessage({ 
            type: 'error', 
            data: { message: 'No schema could be detected from sample data' }
        });
        return;
    }
    
    // Build CREATE TABLE statement
    const columns = schema.map(col => {
        return `"${sanitizeColumnName(col.name)}" ${col.type}`;
    }).join(', ');
    
    const createTableSQL = `CREATE TABLE "${tableName}" (${columns})`;
    
    try {
        db.run(createTableSQL);
        
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
        postMessage({ 
            type: 'error', 
            data: { message: `Failed to create table: ${error.message}` }
        });
    }
}

/**
 * Sanitize column names for SQL
 */
function sanitizeColumnName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Insert a batch of rows
 */
function insertBatch() {
    if (currentBatch.length === 0) return;
    
    try {
        db.run('BEGIN TRANSACTION');
        
        const columnNames = schema.map(col => `"${sanitizeColumnName(col.name)}"`).join(', ');
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
    // Create table if not created yet (for small files)
    if (!schema && objectCount > 0) {
        createTable();
    }
    
    // Insert any remaining rows
    if (currentBatch.length > 0) {
        insertBatch();
    }
    
    // Get database size
    const dbData = db.export();
    const dbSize = dbData.byteLength;
    
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
    try {
        const data = db.export();
        postMessage({
            type: 'exported',
            data: data
        }, [data.buffer]); // Transfer ownership of buffer
        
        postMessage({
            type: 'log',
            data: { message: 'Database exported successfully' }
        });
        
    } catch (error) {
        postMessage({
            type: 'error',
            data: { message: `Failed to export database: ${error.message}` }
        });
    }
}
