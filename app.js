// Main application logic for JSON to SQLite converter

let selectedFile = null;
let worker = null;
let startTime = null;
let timerInterval = null;

// DOM elements
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const optionsSection = document.getElementById('optionsSection');
const progressSection = document.getElementById('progressSection');
const downloadSection = document.getElementById('downloadSection');
const startBtn = document.getElementById('startBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const tableName = document.getElementById('tableName');
const sampleSize = document.getElementById('sampleSize');
const batchSize = document.getElementById('batchSize');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const rowCount = document.getElementById('rowCount');
const timeElapsed = document.getElementById('timeElapsed');
const logOutput = document.getElementById('logOutput');

// Event listeners
fileInput.addEventListener('change', handleFileSelect);
startBtn.addEventListener('click', startConversion);
downloadBtn.addEventListener('click', downloadDatabase);
resetBtn.addEventListener('click', resetApp);

/**
 * Handle file selection
 */
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedFile = file;
    
    // Display file information
    const fileSize = formatBytes(file.size);
    fileInfo.innerHTML = `
        <strong>Selected File:</strong> ${file.name}<br>
        <strong>Size:</strong> ${fileSize}<br>
        <strong>Type:</strong> ${file.type || 'application/json'}
    `;
    fileInfo.classList.remove('hidden');
    optionsSection.classList.remove('hidden');
}

/**
 * Start the conversion process
 */
async function startConversion() {
    if (!selectedFile) {
        alert('Please select a JSON file first');
        return;
    }

    // Validate inputs
    const table = tableName.value.trim() || 'data';
    const sample = parseInt(sampleSize.value) || 100;
    const batch = parseInt(batchSize.value) || 1000;

    // Hide options and show progress
    optionsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    
    // Reset progress
    progressBar.style.width = '0%';
    progressBar.textContent = '';
    rowCount.textContent = '0';
    logOutput.innerHTML = '';
    
    // Start timer
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);

    try {
        // Initialize worker
        log('Initializing database worker...');
        worker = new Worker('db-worker.js');
        
        // Setup worker message handler
        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;

        // Send initialization message
        worker.postMessage({
            type: 'init',
            tableName: table,
            sampleSize: sample,
            batchSize: batch
        });

        // Start streaming the file
        log('Starting to stream JSON file...');
        await streamJsonFile(selectedFile);

    } catch (error) {
        console.error('Conversion error:', error);
        log(`Error: ${error.message}`, 'error');
        statusText.textContent = 'Error occurred';
        stopTimer();
    }
}

/**
 * Stream JSON file to worker
 */
async function streamJsonFile(file) {
    statusText.textContent = 'Streaming file...';
    
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;
    const fileSize = file.size;

    while (offset < fileSize) {
        const chunk = file.slice(offset, offset + chunkSize);
        const arrayBuffer = await chunk.arrayBuffer();
        const text = new TextDecoder().decode(arrayBuffer);
        
        // Send chunk to worker
        worker.postMessage({
            type: 'chunk',
            data: text
        });

        offset += chunkSize;
        
        // Update progress bar based on file reading progress
        const readProgress = Math.min((offset / fileSize) * 50, 50); // First 50% is reading
        progressBar.style.width = readProgress + '%';
        
        // Small delay to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Notify worker that all chunks have been sent
    worker.postMessage({
        type: 'end'
    });
    
    log('File streaming complete, processing data...');
    statusText.textContent = 'Processing data...';
}

/**
 * Handle messages from worker
 */
function handleWorkerMessage(event) {
    const { type, data } = event.data;

    switch (type) {
        case 'log':
            log(data.message, data.level);
            break;
            
        case 'status':
            statusText.textContent = data.message;
            break;
            
        case 'progress':
            rowCount.textContent = data.rowsProcessed.toLocaleString();
            // Second 50% of progress is for processing
            const processingProgress = 50 + (data.progress * 50);
            progressBar.style.width = processingProgress + '%';
            progressBar.textContent = Math.round(processingProgress) + '%';
            break;
            
        case 'schema':
            log(`Schema detected: ${data.columns.length} columns`);
            log(`Columns: ${data.columns.join(', ')}`);
            break;
            
        case 'complete':
            handleConversionComplete(data);
            break;
            
        case 'error':
            log(`Error: ${data.message}`, 'error');
            statusText.textContent = 'Error occurred';
            stopTimer();
            break;
    }
}

/**
 * Handle worker errors
 */
function handleWorkerError(error) {
    console.error('Worker error:', error);
    log(`Worker error: ${error.message}`, 'error');
    statusText.textContent = 'Worker error occurred';
    stopTimer();
}

/**
 * Handle conversion completion
 */
function handleConversionComplete(data) {
    stopTimer();
    
    progressBar.style.width = '100%';
    progressBar.textContent = '100%';
    statusText.textContent = 'Complete!';
    rowCount.textContent = data.totalRows.toLocaleString();
    
    log(`Conversion complete! Total rows: ${data.totalRows.toLocaleString()}`);
    log(`Database size: ${formatBytes(data.dbSize)}`);
    
    // Show download section
    progressSection.classList.add('hidden');
    downloadSection.classList.remove('hidden');
}

/**
 * Download the SQLite database
 */
function downloadDatabase() {
    if (!worker) return;
    
    log('Requesting database export...');
    
    // Request database from worker
    worker.postMessage({ type: 'export' });
    
    // Handle export response
    const exportHandler = (event) => {
        if (event.data.type === 'exported') {
            const blob = new Blob([event.data.data], { type: 'application/x-sqlite3' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${selectedFile.name.replace('.json', '')}.sqlite`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            log('Database downloaded successfully!');
            worker.removeEventListener('message', exportHandler);
        }
    };
    
    worker.addEventListener('message', exportHandler);
}

/**
 * Reset the application
 */
function resetApp() {
    // Terminate worker
    if (worker) {
        worker.terminate();
        worker = null;
    }
    
    // Reset UI
    selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    optionsSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    downloadSection.classList.add('hidden');
    logOutput.innerHTML = '';
    
    stopTimer();
}

/**
 * Update elapsed time
 */
function updateTimer() {
    if (!startTime) return;
    const elapsed = (Date.now() - startTime) / 1000;
    timeElapsed.textContent = formatTime(elapsed);
}

/**
 * Stop the timer
 */
function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

/**
 * Log message to output
 */
function log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✓';
    const line = `[${timestamp}] ${prefix} ${message}`;
    
    const logLine = document.createElement('div');
    logLine.textContent = line;
    if (level === 'error') logLine.style.color = '#ef4444';
    if (level === 'warning') logLine.style.color = '#f59e0b';
    
    logOutput.appendChild(logLine);
    logOutput.scrollTop = logOutput.scrollHeight;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format time in seconds to readable format
 */
function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}m ${secs}s`;
}
