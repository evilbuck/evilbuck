# Code Sample Showcase - PRD

## Goal

Create an interactive code browser for the portfolio site that allows users to browse actual source code files from project samples. The browser should:

1. **Auto-discover** all code sample projects in `src/code-samples/`
2. **Display file trees** with expandable folders showing complete directory structures
3. **Show syntax-highlighted code** when users click on files
4. **Work with static site generation** (Astro SSG mode, no server required)
5. **Zero configuration** - just add a folder with code and it appears automatically

## What We're Trying to Accomplish

### Primary Objectives

- **Browse Real Code**: Users can click through actual implementation files from production projects
- **Zero Maintenance**: Adding a new project = create folder + add README.md, done
- **Performance**: All file contents pre-loaded at build time for instant viewing
- **Responsive Design**: Works on mobile and desktop with collapsing sidebars

### User Experience Goals

1. User lands on `/code-samples` page
2. Sees 3 project cards with overview information
3. Each card has a "Browse the Code" section with:
   - File tree navigation (left sidebar)
   - Code viewer with syntax highlighting (main area)
4. Clicking folders expands/collapses to show nested files
5. Clicking files loads code instantly (no network request)
6. Copy button on each file for easy code copying

## What We've Tried

### Iteration 1: API Endpoint Approach L
- **Attempted**: Dynamic file loading via `/api/code-file` endpoint
- **Problem**: Astro uses static output by default, API routes don't work in SSG
- **Result**: "Failed to load file" errors, query parameters not accessible

### Iteration 2: Recursive Astro Component L
- **Attempted**: Created `FileTreeNode.astro` that imports itself for nested folders
- **Problem**: Astro doesn't support recursive component imports
- **Error**: `FileTreeNode is not defined`
- **Result**: Build failures, component couldn't reference itself

### Iteration 3: Client-Side Rendering  (Current)
- **Approach**: Pre-load all file contents at build time, render tree with JavaScript
- **How it works**:
  1. Build time: `discoverCodeSamples()` scans directories and loads all files
  2. Store tree structure + file contents as JSON in script tags
  3. Client-side JavaScript recursively renders HTML tree from JSON
  4. File clicks load from pre-loaded JSON data (no network)
- **Result**: Working, but still has runtime errors (see Current State)

## Current State

###  What's Working

- **Build completes** without errors
- **Auto-discovery** finds all projects in `src/code-samples/`
- **File tree renders** on page load
- **Pre-loaded data** available in JSON script tags
- **Basic UI structure** displays correctly

### L Known Issues

**User Reports**:
1. **Folders not expanding** - Clicking folders doesn't show nested contents
2. **Files not loading** - Clicking files shows "Failed to load file..." error

**Suspected Issues** (for next agent to investigate):
1. Event listeners might not be attaching correctly
2. JavaScript recursion might have bugs
3. File path mapping between tree data and content data might be mismatched
4. Script execution timing issues (DOM ready vs data availability)

### File Tree Structure

The discovery system creates this structure:
```javascript
{
  type: 'folder' | 'file',
  name: 'filename.js',
  path: 'relative/path/to/file.js',
  extension: 'js',
  children: [ /* nested nodes */ ]
}
```

File contents stored separately:
```javascript
{
  'relative/path/to/file.js': {
    content: '// actual code...',
    extension: 'js',
    name: 'file.js'
  }
}
```

## Files Involved

### Core Implementation

**Discovery & Data Loading**:
- `src/utils/discoverCodeSamples.js` - Scans directories, builds file trees, reads files
  - `discoverCodeSamples()` - Returns array of projects with file trees
  - `readCodeFile(projectId, filePath)` - Reads file contents safely

**Components**:
- `src/components/CodeBrowser.astro` - Main container, pre-loads all file data
- `src/components/FileTree.astro` - File navigation sidebar, client-side tree rendering
- `src/components/CodeViewer.astro` - Syntax-highlighted code display
- `src/components/CodeSamples.astro` - Page integration, maps projects to browsers

**Deleted** (didn't work):
- `src/components/FileTreeNode.astro` - Attempted recursive component (Astro limitation)
- `src/pages/api/code-file.ts` - API endpoint (not needed in SSG, can be deleted)

### Data Files

**Sample Projects** (these work correctly):
- `src/code-samples/overhub-api/` - 13 files, deeply nested structure
- `src/code-samples/admin/` - 1 file in `src/components/`
- `src/code-samples/portable-cart/` - 2 files in `src/`

**Metadata**:
- `src/data/codeSamples.ts` - Display metadata (title, summary, metrics)
- `src/code-samples/CONTRIBUTING.md` - Convention guide for adding projects

### Page & Layout

- `src/pages/code-samples.astro` - Main page route
- `src/layouts/Layout.astro` - Base layout with navigation

## Technical Constraints

### Astro-Specific

1. **No Recursive Components**: Astro components can't import themselves
2. **No API Routes in SSG**: Default static output doesn't support server endpoints
3. **Build-Time Only**: Server-side code runs during build, not runtime
4. **Client Scripts**: Use `<script>` tags for runtime JavaScript

### Design Decisions

1. **Pre-load Everything**: Load all file contents at build time (better for static sites)
2. **Client-Side Tree**: Render tree with JavaScript recursion (Astro limitation)
3. **JSON Data Passing**: Use script tags to pass data from server to client
4. **Global Styles**: Use `:global()` for dynamically created elements

## Debug Checklist for Next Agent

### Investigate File Tree Rendering

1. **Check browser console** for JavaScript errors during tree render
2. **Verify JSON data** is correctly embedded in page:
   ```javascript
   document.getElementById('tree-data-{projectId}')
   ```
3. **Test recursive renderNode()** function in FileTree.astro script
4. **Confirm event listeners** attach to dynamically created elements

### Investigate File Loading

1. **Verify file contents** are in pre-loaded JSON:
   ```javascript
   document.getElementById('files-{projectId}')
   ```
2. **Check file path matching** between tree.path and file contents keys
3. **Test file-selected event** dispatch and handling
4. **Confirm escapeHtml()** isn't breaking code display

### Quick Tests

```bash
# Start dev server
npm run dev

# Visit page
open http://localhost:4322/code-samples

# Browser console checks
console.log(document.getElementById('tree-data-overhub-api').textContent)
console.log(document.getElementById('files-overhub-api').textContent)

# Check for errors
# Look for failed event listeners, undefined variables, path mismatches
```

## Expected Behavior

### User Flow

1. Page loads ’ File tree renders from JSON
2. User clicks folder ’ Details element toggles open/closed
3. User clicks file ’ `file-selected` event fires
4. Event handler reads from pre-loaded JSON
5. New code viewer renders with syntax highlighting
6. Copy button works for clipboard

### Data Flow

```
Build Time:
discoverCodeSamples()
  ’ scans src/code-samples/
  ’ builds file trees
  ’ reads all file contents
  ’ returns project objects

Astro Component:
CodeBrowser.astro
  ’ receives project with fileTree
  ’ calls readCodeFile() for all files
  ’ stores in allFileContents object
  ’ embeds as JSON in page

Runtime:
FileTree script
  ’ reads tree JSON
  ’ renders HTML recursively
  ’ attaches click handlers

CodeBrowser script
  ’ listens for file-selected event
  ’ reads file from pre-loaded JSON
  ’ updates code viewer
```

## Success Criteria

- [ ] Folders expand/collapse showing all nested files
- [ ] Files load and display with syntax highlighting
- [ ] Copy button works
- [ ] No console errors
- [ ] Mobile responsive (sidebar collapses)
- [ ] Build completes without errors
- [ ] Works in production build (npm run build && npm run preview)

## Convention for Future Projects

To add a new code sample project:

1. Create folder: `src/code-samples/my-project/`
2. Add README.md with project description
3. Copy code files (any structure)
4. Optional: Add `metadata.json` for custom display
5. System auto-discovers and displays it

**That's it!** Zero code changes needed.
