# Debugging Guide

## Console Logging

The JSON to SQLite converter now includes comprehensive console logging to help you understand what's happening during the conversion process.

## How to View Console Output

1. **Open Browser Console**: Press `F12` (Windows/Linux) or `Cmd+Option+J` (Mac) to open the browser developer tools
2. **Go to Console Tab**: Click on the "Console" tab
3. **Start Conversion**: Upload a JSON file and start the conversion
4. **View Debug Output**: You'll see detailed logs about every step of the process

## What Gets Logged

### Main Thread (page.tsx)
- `[Main]` prefix for all main thread logs
- File selection and configuration details
- Worker initialization
- File streaming progress (every 100 chunks)
- Worker message reception and handling
- Database download process

### Worker Thread (db-worker.js)
- `[DB Worker]` prefix for all worker logs
- Database initialization steps
- Configuration settings (table name, sample size, batch size)
- First 5 objects being processed (to see the actual data)
- Flattened object structure with all column names
- Schema detection with column names and types
- CREATE TABLE SQL statement
- Batch insertion progress
- New column additions (for dynamically discovered columns)
- Sample rows from batches (first row of every 10th batch)
- Final statistics (total rows, database size)
- Export process

## Example Console Output

```
[Main] Starting conversion...
[Main] File: sample-data.json 1234 bytes
[Main] Configuration: {tableName: "data", sampleSize: 100, batchSize: 1000}
[Main] Sending init message to worker
[DB Worker] Received message: init
[DB Worker] Configuration: {tableName: "data", sampleSize: 100, batchSize: 1000}
[DB Worker] Initializing SQL.js database...
[DB Worker] SQL.js WASM loaded successfully
[DB Worker] Database created successfully
[Main] Starting file streaming...
[Main] Streamed 100 chunks (6400000 / 10000000 bytes)
[DB Worker] Processing object #0: {id: 2503, game_id: 382, configs: {...}}
[DB Worker] Flattened object #0: {id: 2503, game_id: 382, configs_id: 1313140, ...}
[DB Worker] Flattened keys: ["id", "game_id", "configs_id", "configs_name", "configs_extraData_dxwrapper", ...]
[DB Worker] Creating table with schema: [{name: "id", type: "INTEGER"}, ...]
[DB Worker] CREATE TABLE SQL: CREATE TABLE "data" ("id" INTEGER, "game_id" INTEGER, ...)
[DB Worker] Table created successfully with columns: ["id", "game_id", "configs_id", ...]
[DB Worker] Inserting batch of 1000 rows
[DB Worker] Sample row from batch: {id: 2503, game_id: 382, ...}
[DB Worker] Batch inserted successfully. Total rows: 1000
[DB Worker] Finalizing processing...
[DB Worker] Processing complete!
[DB Worker] Final statistics - Total rows: 5000, DB size: 2048576 bytes
[Main] Worker message received: complete {totalRows: 5000, dbSize: 2048576}
```

## Debugging Nested Objects

If you're having issues with nested objects (like `configs.extraData.controllerEmulationBindings`), check the console for:

1. **Object structure**: Look for `Processing object #N` logs to see the original structure
2. **Flattened structure**: Look for `Flattened object #N` logs to see how it was flattened
3. **Column names**: Look for `Flattened keys` to see all the column names created
4. **Schema**: Look for `Creating table with schema` to see the final column definitions

### Example of Nested Object Flattening

Original object:
```json
{
  "configs": {
    "extraData": {
      "controllerEmulationBindings": {
        "A": "KEY_SPACE",
        "B": "KEY_E"
      }
    }
  }
}
```

Flattened columns:
- `configs_extraData_controllerEmulationBindings_A` → "KEY_SPACE"
- `configs_extraData_controllerEmulationBindings_B` → "KEY_E"

## Troubleshooting

### No Console Output?
- Make sure the browser console is open before starting the conversion
- Try refreshing the page and starting again
- Check that you're looking at the correct console tab (not Network, Elements, etc.)

### Missing Data in Columns?
- Check the console for the flattened object to see if the data is present
- Verify the column names in the schema match your expectations
- Look for any error messages in red

### Empty Columns?
If you see column names but empty data:
1. Check the `Sample row from batch` logs to see what data is actually being inserted
2. Look for NULL values in the logs
3. Verify the original JSON object structure in the `Processing object #N` logs

## Tips

- The first 5 objects are logged in detail, so you can see exactly how your data is being processed
- Batch insertion logs appear every time a batch is inserted (default: every 1000 rows)
- Use the browser's console filter to search for specific terms like "Flattened" or "error"
- You can export console logs for sharing:
  - **Chrome/Edge**: Right-click in console → "Save as..." 
  - **Firefox**: Use the browser's screenshot tool or copy-paste logs
  - **Safari**: Select and copy logs manually
  - Note: Methods vary by browser version and OS
