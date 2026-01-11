'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Download, RotateCcw } from 'lucide-react';

interface WorkerMessage {
  type: 'log' | 'status' | 'progress' | 'schema' | 'complete' | 'error' | 'exported';
  data: any;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warning';
  message: string;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState('data');
  const [sampleSize, setSampleSize] = useState(100);
  const [batchSize, setBatchSize] = useState(1000);
  const [showOptions, setShowOptions] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');
  const [rowsProcessed, setRowsProcessed] = useState(0);
  const [elapsedTime, setElapsedTime] = useState('0s');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  const workerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const addLog = (message: string, level: 'info' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, level, message }]);
  };

  const updateTimer = () => {
    if (!startTimeRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    setElapsedTime(formatTime(elapsed));
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}m ${secs}s`;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setShowOptions(true);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === 'application/json' || file.name.endsWith('.json')) {
        setSelectedFile(file);
        setShowOptions(true);
      } else {
        alert('Please drop a JSON file');
      }
    }
  };

  const handleWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, data } = event.data;

    switch (type) {
      case 'log':
        addLog(data.message, data.level);
        break;
      case 'status':
        setStatus(data.message);
        break;
      case 'progress':
        setRowsProcessed(data.rowsProcessed);
        const processingProgress = 50 + (data.progress * 50);
        setProgress(processingProgress);
        break;
      case 'schema':
        addLog(`Schema detected: ${data.columns.length} columns`);
        addLog(`Columns: ${data.columns.join(', ')}`);
        break;
      case 'complete':
        handleComplete(data);
        break;
      case 'error':
        addLog(`Error: ${data.message}`, 'error');
        setStatus('Error occurred');
        if (timerRef.current) clearInterval(timerRef.current);
        break;
    }
  };

  const handleComplete = (data: { totalRows: number; dbSize: number }) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setStatus('Complete!');
    setRowsProcessed(data.totalRows);
    addLog(`Conversion complete! Total rows: ${data.totalRows.toLocaleString()}`);
    addLog(`Database size: ${formatBytes(data.dbSize)}`);
    setShowProgress(false);
    setShowDownload(true);
  };

  const startConversion = async () => {
    if (!selectedFile) return;

    setShowOptions(false);
    setShowProgress(true);
    setProgress(0);
    setRowsProcessed(0);
    setLogs([]);
    
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(updateTimer, 100);

    try {
      addLog('Initializing database worker...');
      const basePath = '/json-to-sqlite';
      workerRef.current = new Worker(`${basePath}/workers/db-worker.js`);
      workerRef.current.onmessage = handleWorkerMessage;
      workerRef.current.onerror = (error) => {
        addLog(`Worker error: ${error.message}`, 'error');
        setStatus('Worker error occurred');
        if (timerRef.current) clearInterval(timerRef.current);
      };

      workerRef.current.postMessage({
        type: 'init',
        data: {
          tableName,
          sampleSize,
          batchSize
        }
      });

      addLog('Starting to stream JSON file...');
      await streamFile(selectedFile);

    } catch (error) {
      addLog(`Error: ${(error as Error).message}`, 'error');
      setStatus('Error occurred');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const streamFile = async (file: File) => {
    setStatus('Streaming file...');
    const chunkSize = 64 * 1024;
    let offset = 0;
    const fileSize = file.size;

    while (offset < fileSize) {
      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuffer);
      
      workerRef.current?.postMessage({
        type: 'chunk',
        data: text
      });

      offset += chunkSize;
      const readProgress = Math.min((offset / fileSize) * 50, 50);
      setProgress(readProgress);
      
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    workerRef.current?.postMessage({ type: 'end' });
    addLog('File streaming complete, processing data...');
    setStatus('Processing data...');
  };

  const downloadDatabase = () => {
    if (!workerRef.current || !selectedFile) return;
    
    addLog('Requesting database export...');
    
    const exportHandler = (event: MessageEvent<WorkerMessage>) => {
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
        
        addLog('Database downloaded successfully!');
        workerRef.current?.removeEventListener('message', exportHandler);
      }
    };
    
    workerRef.current.addEventListener('message', exportHandler);
    workerRef.current.postMessage({ type: 'export' });
  };

  const resetApp = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    setSelectedFile(null);
    setShowOptions(false);
    setShowProgress(false);
    setShowDownload(false);
    setProgress(0);
    setRowsProcessed(0);
    setLogs([]);
    setElapsedTime('0s');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen p-5">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-10 text-center">
          <h1 className="text-5xl font-bold mb-3">📊 JSON to SQLite Converter</h1>
          <p className="text-xl opacity-95">Convert large JSON files to SQLite databases entirely in your browser</p>
        </header>

        <main className="p-8">
          {/* File Upload Section */}
          {!showProgress && !showDownload && (
            <section className="text-center mb-8">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
                id="fileInput"
              />
              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 scale-105'
                    : 'border-gray-300 bg-gray-50'
                }`}
              >
                <label
                  htmlFor="fileInput"
                  className="inline-flex items-center gap-3 px-10 py-5 bg-blue-500 text-white rounded-lg cursor-pointer text-lg font-semibold hover:bg-blue-600 transition-all transform hover:-translate-y-0.5 shadow-lg"
                >
                  <Upload className="w-6 h-6" />
                  Choose JSON File
                </label>
                <p className="mt-4 text-gray-600">or drag and drop a JSON file here</p>
              </div>
              
              {selectedFile && (
                <div className="mt-5 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <p><strong>Selected File:</strong> {selectedFile.name}</p>
                  <p><strong>Size:</strong> {formatBytes(selectedFile.size)}</p>
                  <p><strong>Type:</strong> {selectedFile.type || 'application/json'}</p>
                </div>
              )}
            </section>
          )}

          {/* Options Section */}
          {showOptions && (
            <section className="bg-gray-50 p-6 rounded-lg mb-8">
              <h2 className="text-2xl font-bold mb-5">Options</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block font-semibold mb-2">Table Name:</label>
                  <input
                    type="text"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="data"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-2">Schema Sample Size:</label>
                  <input
                    type="number"
                    value={sampleSize}
                    onChange={(e) => setSampleSize(Number(e.target.value))}
                    min="1"
                    max="1000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <small className="text-gray-600">Number of objects to scan for schema discovery</small>
                </div>

                <div>
                  <label className="block font-semibold mb-2">Batch Size:</label>
                  <input
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    min="100"
                    max="10000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <small className="text-gray-600">Number of rows per transaction</small>
                </div>

                <button
                  onClick={startConversion}
                  className="w-full py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-all"
                >
                  Start Conversion
                </button>
              </div>
            </section>
          )}

          {/* Progress Section */}
          {showProgress && (
            <section className="mb-8">
              <h2 className="text-2xl font-bold mb-5">Progress</h2>
              
              <div className="mb-5">
                <div className="w-full h-8 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300 flex items-center justify-center text-white font-semibold"
                    style={{ width: `${progress}%` }}
                  >
                    {Math.round(progress)}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="block text-sm text-gray-600 mb-1">Status:</span>
                  <span className="block text-xl font-bold">{status}</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="block text-sm text-gray-600 mb-1">Rows Processed:</span>
                  <span className="block text-xl font-bold">{rowsProcessed.toLocaleString()}</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="block text-sm text-gray-600 mb-1">Time Elapsed:</span>
                  <span className="block text-xl font-bold">{elapsedTime}</span>
                </div>
              </div>

              {logs.length > 0 && (
                <div className="max-h-48 overflow-y-auto bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={log.level === 'error' ? 'text-red-400' : log.level === 'warning' ? 'text-yellow-400' : ''}
                    >
                      [{log.timestamp}] {log.level === 'error' ? '❌' : log.level === 'warning' ? '⚠️' : '✓'} {log.message}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Download Section */}
          {showDownload && (
            <section className="text-center p-8 bg-gray-50 rounded-lg">
              <h2 className="text-3xl font-bold mb-5">✅ Conversion Complete!</h2>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={downloadDatabase}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all"
                >
                  <Download className="w-5 h-5" />
                  Download SQLite Database
                </button>
                <button
                  onClick={resetApp}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-all"
                >
                  <RotateCcw className="w-5 h-5" />
                  Convert Another File
                </button>
              </div>
            </section>
          )}
        </main>

        {/* Footer */}
        <footer className="bg-gray-50 p-8 text-center border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="p-5 bg-white rounded-lg shadow-sm">
              <strong className="text-lg block mb-2 text-blue-600">🔒 Private</strong>
              <p className="text-gray-600 text-sm">Your data never leaves your device</p>
            </div>
            <div className="p-5 bg-white rounded-lg shadow-sm">
              <strong className="text-lg block mb-2 text-blue-600">⚡ Fast</strong>
              <p className="text-gray-600 text-sm">Streaming parser handles large files</p>
            </div>
            <div className="p-5 bg-white rounded-lg shadow-sm">
              <strong className="text-lg block mb-2 text-blue-600">💾 Free</strong>
              <p className="text-gray-600 text-sm">No server costs, runs entirely in browser</p>
            </div>
          </div>
          <p className="text-gray-600 text-sm">
            Made with ❤️ | <a href="https://github.com/andreisugu/json-to-sqlite" className="text-blue-600 font-semibold hover:underline">View on GitHub</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
