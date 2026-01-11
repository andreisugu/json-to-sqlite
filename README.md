# JSON to SQLite Converter 🚀

A powerful browser-based tool to convert large JSON files to SQLite databases entirely client-side. Perfect for GitHub Pages deployment!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- **🔒 100% Private**: Your data never leaves your device - everything runs in the browser
- **⚡ Streaming Architecture**: Handles large JSON files (1GB+) without memory crashes
- **🚀 Fast Processing**: Batched inserts with transactions for optimal performance
- **🎯 Smart Schema Detection**: Automatically detects columns and types from your data
- **🔧 Customizable**: Configure table name, batch size, and schema sample size
- **📊 Real-time Progress**: Live progress tracking with detailed statistics
- **💾 Zero Cost**: No server required - perfect for GitHub Pages
- **🎨 Beautiful UI**: Modern, responsive interface with smooth animations

## 🏗️ Architecture

This tool implements a "Bucket Brigade" architecture:

1. **Reader (Main Thread)**: Streams the file in chunks using the File API
2. **Parser (Web Worker)**: Parses JSON objects from chunks and builds schema
3. **Writer (Web Worker)**: Handles SQL.js database operations with batched inserts
4. **Exporter**: Downloads the resulting SQLite database

### Technology Stack

- **Next.js 14**: React framework with static export for GitHub Pages
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Modern, responsive styling
- **SQL.js**: SQLite compiled to WebAssembly for browser execution
- **Web Workers**: Prevents UI freezing during processing
- **File API**: Reads local files without uploading
- **Streaming Parser**: Custom chunk-based JSON parser for memory efficiency

## 🚀 Quick Start

### GitHub Pages Deployment

This repository is configured for automatic deployment to GitHub Pages:

1. Fork this repository
2. Go to Settings → Pages
3. Set Source to "GitHub Actions"
4. Push to the `main` branch - the site will deploy automatically
5. Visit `https://yourusername.github.io/json-to-sqlite/`

The deployment workflow runs automatically on every push to the main branch.

### Local Development

```bash
# Clone the repository
git clone https://github.com/andreisugu/json-to-sqlite.git
cd json-to-sqlite

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Open browser to http://localhost:3000
```

## 📖 Usage

1. **Select JSON File**: Click "Choose JSON File" and select your JSON file
2. **Configure Options**:
   - **Table Name**: Name for your SQLite table (default: "data")
   - **Schema Sample Size**: Number of objects to scan for schema (default: 100)
   - **Batch Size**: Rows per transaction for performance (default: 1000)
3. **Start Conversion**: Click "Start Conversion" and wait for processing
4. **Download**: Once complete, download your SQLite database

## 📝 Supported JSON Formats

The tool works with JSON arrays of objects:

```json
[
  {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "active": true
  },
  {
    "id": 2,
    "name": "Jane Smith",
    "email": "jane@example.com",
    "age": 25,
    "active": false
  }
]
```

### Nested Objects

Nested objects are automatically flattened:

```json
{
  "user": {
    "name": "John",
    "address": {
      "city": "New York",
      "zip": "10001"
    }
  }
}
```

Becomes columns: `user_name`, `user_address_city`, `user_address_zip`

### Arrays

Arrays are stored as JSON strings in the database.

## ⚙️ Configuration

### Batch Size

- **Small files (<10MB)**: 500-1000 rows
- **Medium files (10-100MB)**: 1000-2000 rows
- **Large files (>100MB)**: 2000-5000 rows

Larger batch sizes = faster processing but more memory usage.

### Schema Sample Size

- **Consistent data**: 50-100 objects
- **Variable data**: 200-500 objects
- **Highly variable**: 500-1000 objects

More samples = better schema detection but slower startup.

## 🔧 Technical Details

### Memory Management

The tool uses several techniques to handle large files:

1. **Chunked Reading**: Files are read in 64KB chunks
2. **Streaming Parsing**: Objects are parsed incrementally
3. **Batched Inserts**: Rows are inserted in configurable batches
4. **Worker Threads**: Heavy processing runs off the main thread
5. **Buffer Management**: Efficient string buffer for incomplete objects

### Schema Detection

The tool scans the first N objects to determine:

- Column names (flattened from nested structure)
- Data types (INTEGER, REAL, TEXT)
- Nullable columns

Type conflicts are resolved by choosing TEXT as the fallback.

### Performance

Typical performance (on modern hardware):

- **10MB file**: 5-10 seconds
- **100MB file**: 30-60 seconds
- **500MB file**: 2-5 minutes
- **1GB file**: 5-10 minutes

## ⚠️ Limitations

### Browser Memory

- **Maximum file size**: ~1-2GB (depends on available browser memory)
- **Resulting database**: Must fit in memory (~1-2GB)
- Larger files may crash the browser tab

### Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ❌ Internet Explorer (not supported)

Requires:
- Web Workers
- File API
- WebAssembly
- ES6 modules

## 🐛 Troubleshooting

### "Out of Memory" Error

- Reduce batch size
- Try a smaller file
- Close other tabs
- Use a browser with more available memory

### Slow Processing

- Increase batch size
- Reduce schema sample size
- Ensure no other heavy processes are running

### Invalid JSON

- Ensure your JSON is valid (use a validator)
- Check for unescaped special characters
- Verify the JSON is an array of objects

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [SQL.js](https://github.com/sql-js/sql.js/) - SQLite compiled to WebAssembly
- Inspired by the need for privacy-focused data processing tools

## 📧 Contact

Andrei Șugubete - [@andreisugu](https://github.com/andreisugu)

Project Link: [https://github.com/andreisugu/json-to-sqlite](https://github.com/andreisugu/json-to-sqlite)

---

**Made with ❤️ for the privacy-conscious developer community**
