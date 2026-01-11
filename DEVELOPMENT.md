# Development Guide

## Local Development

When developing locally, the application works best with the Next.js development server:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to see the application with hot-reload.

## Building for Production

The application is configured to build static files for GitHub Pages deployment:

```bash
npm run build
```

This creates an `out/` directory with static files ready for deployment.

## Testing Locally After Build

The built application uses a `basePath` of `/json-to-sqlite/` for GitHub Pages. To test locally:

1. Serve the `out` directory
2. Navigate to the root URL (styling won't work perfectly due to basePath)
3. Or use `npm run dev` for full local testing

## GitHub Actions Deployment

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that:

1. Runs on every push to `main`
2. Installs dependencies
3. Builds the Next.js application
4. Deploys to GitHub Pages automatically

## Technology Stack

- **Next.js 14**: React framework with App Router
- **TypeScript**: For type safety
- **Tailwind CSS**: Utility-first CSS framework
- **SQL.js**: SQLite in WebAssembly
- **Web Workers**: For background processing

## Project Structure

```
.
├── app/
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Main page component
│   └── globals.css     # Global styles with Tailwind
├── public/
│   ├── workers/
│   │   └── db-worker.js # Web Worker for SQLite operations
│   └── .nojekyll       # GitHub Pages config
├── .github/
│   └── workflows/
│       └── deploy.yml  # GitHub Actions workflow
├── next.config.js      # Next.js configuration
├── tailwind.config.js  # Tailwind configuration
├── tsconfig.json       # TypeScript configuration
└── package.json        # Dependencies and scripts
```

## Key Features

### Streaming JSON Parser

The application uses a custom streaming parser in the Web Worker that:
- Reads files in 64KB chunks
- Parses JSON objects incrementally
- Prevents memory overflow on large files

### Schema Detection

Automatically detects schema from the first N objects:
- Identifies column names (flattens nested objects)
- Detects data types (INTEGER, REAL, TEXT)
- Handles type conflicts gracefully

### Batched Inserts

Uses SQLite transactions with batched inserts:
- Default batch size: 1000 rows
- Configurable per conversion
- Optimizes performance significantly

### Progress Tracking

Real-time progress updates:
- File reading progress (0-50%)
- Processing progress (50-100%)
- Row count and elapsed time
- Detailed logs

## Configuration Options

Users can configure:

1. **Table Name**: Name for the SQLite table
2. **Schema Sample Size**: Number of objects to scan for schema (default: 100)
3. **Batch Size**: Rows per transaction (default: 1000)

## Browser Compatibility

Requires modern browsers with:
- Web Workers
- File API
- WebAssembly
- ES6+ support

Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance Notes

Typical performance on modern hardware:
- 10MB file: 5-10 seconds
- 100MB file: 30-60 seconds
- 500MB file: 2-5 minutes
- 1GB file: 5-10 minutes

Memory limit: ~1-2GB (browser dependent)
